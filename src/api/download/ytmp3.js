'use strict';

const axios = require('axios');
const CryptoJS = require('crypto-js');
const yts = require('yt-search');
const cache = require('../../cache');

const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes
const TIMEOUT = 20000;
const CRYPTO_KEY = 'C5D58EF67A7584E4A29F6C35BBC4EB12';

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/ytmp3',
    group: 'download',
    name: 'YouTube to MP3',
    description: 'Download audio dari video YouTube. Bisa pakai URL langsung atau kata kunci pencarian.',
    params: [
      { key: 'url', required: false, hint: 'URL video YouTube (opsional jika pakai query)', example: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' },
      { key: 'query', required: false, hint: 'Kata kunci pencarian (dipakai jika url kosong)', example: 'Semenjana - Soegi Bornean' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { url, query } = req.query;

    if ((!url || !url.trim()) && (!query || !query.trim())) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Isi salah satu: parameter "url" atau "query".' }
      });
    }

    try {
      let video;

      if (url && url.trim()) {
        const videoId = extractVideoId(url);
        if (!videoId) {
          return res.status(400).json({
            ok: false,
            error: { code: 'INVALID_URL', message: 'URL YouTube tidak valid.' }
          });
        }
        video = { id: videoId, url: `https://www.youtube.com/watch?v=${videoId}` };
      } else {
        const { videos } = await yts(query.trim());
        if (!videos || !videos.length) {
          return res.status(404).json({
            ok: false,
            error: { code: 'NOT_FOUND', message: `Tidak ada hasil untuk "${query}".` }
          });
        }
        const top = videos[0];
        video = {
          id: top.videoId,
          url: top.url,
          title: top.title,
          author: top.author?.name,
          duration: top.duration?.timestamp,
          thumbnail: top.thumbnail
        };
      }

      const cacheKey = `ytmp3:${video.id}`;
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json({ result: { ...cached, cache: true } });
      }

      const backends = [
        { name: 'savetube', fn: () => savetube(video.url) },
        { name: 'ytmp3ing', fn: () => ytmp3ing(video.url) }
      ];

      const errors = [];
      for (const backend of backends) {
        try {
          const dl = await backend.fn();
          const result = {
            title: dl.title || video.title || 'Unknown Title',
            author: video.author,
            duration: dl.duration || video.duration,
            thumbnail: dl.thumbnail || video.thumbnail,
            backend: backend.name,
            url: dl.downloadUrl,
            filename: `${(dl.title || video.title || video.id).replace(/[^a-zA-Z0-9]/g, '_')}.mp3`
          };
          if (!result.url) throw new Error('Backend tidak mengembalikan link download');

          cache.set(cacheKey, result, CACHE_TTL_MS);
          return res.json({ result: { ...result, cache: false } });
        } catch (err) {
          errors.push(`${backend.name}: ${err.message}`);
        }
      }

      const combinedError = errors.join(' | ');
      console.error(`[ytmp3] all backends failed for videoId=${video.id}: ${combinedError}`);

      res.status(502).json({
        ok: false,
        error: {
          code: 'DOWNLOAD_FAILED',
          message: 'Semua backend gagal memproses link ini.',
          detail: combinedError
        }
      });
    } catch (err) {
      console.error('[ytmp3] unexpected error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses permintaan.' }
      });
    }
  });
};

async function getSavetubeCdn() {
  const { data } = await axios.get('https://media.savetube.vip/api/random-cdn', { timeout: TIMEOUT });
  return data.cdn;
}

function decryptSavetube(base64) {
  const raw = Buffer.from(base64, 'base64');
  const iv = raw.slice(0, 16);
  const encrypted = raw.slice(16);
  const key = CryptoJS.enc.Hex.parse(CRYPTO_KEY);
  const decrypted = CryptoJS.AES.decrypt(
    { ciphertext: CryptoJS.lib.WordArray.create(encrypted) },
    key,
    { iv: CryptoJS.lib.WordArray.create(iv), mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7 }
  );
  return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
}

async function savetube(videoUrl, quality = '128') {
  const cdn = await getSavetubeCdn();
  const { data } = await axios.post(`https://${cdn}/v2/info`, { url: videoUrl }, { timeout: TIMEOUT });
  if (!data.status) throw new Error(data.message || 'Gagal ambil info video');

  const info = decryptSavetube(data.data);
  const { data: dl } = await axios.post(
    `https://${cdn}/download`,
    { downloadType: 'audio', quality, key: info.key },
    { timeout: TIMEOUT }
  );

  return {
    title: info.title,
    thumbnail: info.thumbnail,
    duration: info.durationLabel,
    downloadUrl: dl.data?.downloadUrl || ''
  };
}

async function ytmp3ing(videoUrl) {
  const res = await axios.get('https://ytmp3.ing/', { timeout: TIMEOUT });
  const cookie = res.headers['set-cookie']?.join('; ') || '';
  const csrf = res.data.match(/value="([^"]+)"/)?.[1];
  if (!csrf) throw new Error('Gagal dapat CSRF token ytmp3.ing');

  const boundary = '----WebKitFormBoundaryAzbry';
  const body = `${boundary}\r\nContent-Disposition: form-data; name="url"\r\n\r\n${videoUrl}\r\n${boundary}--\r\n`;

  const response = await axios.post('https://ytmp3.ing/audio', body, {
    headers: {
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'x-csrftoken': csrf,
      cookie
    },
    timeout: TIMEOUT
  });

  const encryptedUrl = response.data.url;
  if (!encryptedUrl) throw new Error('Gagal ambil link download');
  const downloadUrl = Buffer.from(encryptedUrl, 'base64').toString('utf-8');

  return {
    title: response.data.filename || 'Unknown',
    downloadUrl
  };
}

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
