'use strict';

const axios = require('axios');
const cache = require('../../cache');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TIMEOUT = 20000;

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/ytmp3',
    group: 'download',
    name: 'YouTube to MP3',
    description: 'Download audio from a YouTube video as MP3.',
    params: [
      { key: 'url', required: true, hint: 'YouTube video URL', example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { url } = req.query;

    if (!url || !url.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'The "url" parameter is required.' }
      });
    }

    const videoId = extractVideoId(url);
    if (!videoId) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_URL', message: 'Could not extract a valid YouTube video ID from that URL.' }
      });
    }

    const cleanUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const cacheKey = `ytmp3:${videoId}`;

    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ result: { ...cached, cache: true } });
    }

    const providers = [ytdown, savefrom, y2mate];
    const errors = [];

    for (const provider of providers) {
      try {
        const data = await provider(cleanUrl);
        if (data && data.url) {
          const result = {
            title: data.title || 'Unknown Title',
            source: data.source,
            url: data.url,
            filename: data.filename || `${videoId}.mp3`
          };
          cache.set(cacheKey, result, CACHE_TTL_MS);
          return res.json({ result: { ...result, cache: false } });
        }
        errors.push(`${provider.providerName}: no result`);
      } catch (err) {
        errors.push(`${provider.providerName}: ${err.message}`);
      }
    }

    const combinedError = errors.join(' | ');
    console.error(`[ytmp3] all providers failed for videoId=${videoId}: ${combinedError}`);

    res.status(502).json({
      ok: false,
      error: { code: 'DOWNLOAD_FAILED', message: 'Semua provider gagal memproses link ini. Coba lagi nanti.' }
    });
  });
};

function generateRandomIP() {
  const ranges = [
    [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
    [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
    [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
  ];
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return [
    range[0],
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256)
  ].join('.');
}

async function ytdown(url) {
  const spoofedIp = generateRandomIP();
  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'X-Forwarded-For': spoofedIp,
    'X-Real-IP': spoofedIp,
    'Client-IP': spoofedIp,
    'True-Client-IP': spoofedIp,
    'X-Originating-IP': spoofedIp,
    'X-Cluster-Client-IP': spoofedIp,
    Forwarded: `for=${spoofedIp}`,
    Accept: '*/*',
    'X-Requested-With': 'XMLHttpRequest',
    Referer: 'https://ytdown.to/'
  };

  const { data } = await axios.post(
    'https://app.ytdown.to/proxy.php',
    `url=${encodeURIComponent(url)}`,
    { headers, timeout: TIMEOUT }
  );

  const info = data?.api;
  if (!info || info.status !== 'ok') throw new Error('Gagal mengambil info video');

  const audios = (info.mediaItems || []).filter((v) => v.type === 'Audio');
  const bestAudio = audios[0];
  if (!bestAudio) throw new Error('Format audio tidak tersedia');

  const step2 = await axios.post(
    'https://app.ytdown.to/proxy.php',
    `url=${encodeURIComponent(bestAudio.mediaUrl)}`,
    { headers, timeout: TIMEOUT }
  );

  const fileData = step2.data?.api;
  if (!fileData?.fileUrl) throw new Error('Gagal mengambil file audio final');

  return {
    source: 'YTDown.to',
    title: info.title,
    url: fileData.fileUrl,
    filename: fileData.fileName
  };
}
ytdown.providerName = 'ytdown';

async function savefrom(url) {
  const { data } = await axios.get(`https://api.savefrom.net/2/?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: TIMEOUT
  });

  if (!data || !data.url) throw new Error('Gagal mengambil data dari SaveFrom');

  const title = data.title || 'Unknown Title';
  return {
    source: 'SaveFrom',
    title,
    url: data.url,
    filename: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
  };
}
savefrom.providerName = 'savefrom';

async function y2mate(url) {
  const step1 = await axios.get(`https://y2mate.com/api/analyze?url=${encodeURIComponent(url)}`, {
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    timeout: TIMEOUT
  });

  const result = step1.data?.result;
  if (!result) throw new Error('Gagal menganalisis video');

  const title = result.title || 'Unknown Title';
  const audioFormats = (result.formats || []).filter((f) => f.type === 'mp3' || f.type === 'audio');
  const target = audioFormats[0];
  if (!target) throw new Error('Format audio tidak tersedia');

  const step2 = await axios.post(
    'https://y2mate.com/api/convert',
    { url, format: target.format, quality: target.quality || 'best' },
    { headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0' }, timeout: TIMEOUT }
  );

  const finalUrl = step2.data?.url || target.url;
  if (!finalUrl) throw new Error('Gagal mengonversi audio');

  return {
    source: 'Y2Mate',
    title,
    url: finalUrl,
    filename: `${title.replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
  };
}
y2mate.providerName = 'y2mate';

function extractVideoId(url) {
  if (!url) return null;
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
  ];
  for (const p of patterns) {
    const match = url.match(p);
    if (match) return match[1];
  }
  return null;
}
