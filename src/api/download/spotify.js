'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const qs = require('qs');
const cache = require('../../cache');

const CACHE_TTL_MS = 15 * 60 * 1000;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const BASE_URL = 'https://spotidown.app';

async function getSession() {
  const response = await axios.get(`${BASE_URL}/en3`, {
    headers: {
      'User-Agent': USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.9'
    }
  });

  const cookies = response.headers['set-cookie'] || [];
  const sessionCookie = cookies.map((c) => c.split(';')[0]).join('; ');

  const $ = cheerio.load(response.data);
  const form = $('form[name="spotifyurl"]');
  if (!form.length) {
    throw new Error('Form pencarian Spotify tidak ditemukan di halaman sumber.');
  }

  let dynamicName = '';
  let dynamicValue = '';
  form.find('input[type="hidden"]').each((i, elem) => {
    const name = $(elem).attr('name');
    const val = $(elem).attr('value');
    if (name && name !== 'g-recaptcha-response') {
      dynamicName = name;
      dynamicValue = val;
    }
  });

  return { sessionCookie, dynamicName, dynamicValue };
}

async function search(queryOrUrl) {
  const { sessionCookie, dynamicName, dynamicValue } = await getSession();

  const payload = { url: queryOrUrl, 'g-recaptcha-response': '' };
  if (dynamicName) payload[dynamicName] = dynamicValue;

  const response = await axios.post(`${BASE_URL}/action`, qs.stringify(payload), {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/en3`,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': sessionCookie
    }
  });

  if (response.data.error) {
    throw new Error(response.data.message || 'Gagal mencari track.');
  }

  const $ = cheerio.load(response.data.data);
  const tracks = [];

  $('form[name="submitspurl"]').each((i, formElem) => {
    const form = $(formElem);
    const data = form.find('input[name="data"]').val();
    const base = form.find('input[name="base"]').val();
    const token = form.find('input[name="token"]').val();

    if (data && base && token) {
      let metadata = {};
      try {
        metadata = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
      } catch (e) {
        metadata = {};
      }
      tracks.push({ metadata, form: { data, base, token } });
    }
  });

  return { tracks, sessionCookie };
}

async function getDownloadLinks(form, sessionCookie) {
  const response = await axios.post(`${BASE_URL}/action/track`, qs.stringify(form), {
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'Origin': BASE_URL,
      'Referer': `${BASE_URL}/en3`,
      'X-Requested-With': 'XMLHttpRequest',
      'Cookie': sessionCookie
    }
  });

  if (response.data.error) {
    throw new Error(response.data.message || 'Gagal mengambil link download.');
  }

  const $ = cheerio.load(response.data.data);
  const links = { mp3: null, cover: null };

  $('a').each((i, elem) => {
    const href = $(elem).attr('href');
    const text = $(elem).text().trim().replace(/\s+/g, ' ').toLowerCase();
    if (!href) return;
    if (text.includes('download mp3')) links.mp3 = href;
    else if (text.includes('download cover')) links.cover = href;
  });

  return links;
}

function extractTrackId(url) {
  const match = String(url).match(/track\/([a-zA-Z0-9]+)/);
  return match ? match[1] : null;
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/spotify',
    group: 'api',
    name: 'Spotify Downloader',
    description: 'Download audio dari track Spotify.',
    params: [
      { key: 'url', required: true, hint: 'URL track Spotify', example: 'https://open.spotify.com/track/4DpNNXFMMxQEKl7r0ykkWA' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { url } = req.query;

    if (!url || !url.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "url" wajib diisi.' }
      });
    }

    const trackId = extractTrackId(url);
    const cacheKey = trackId ? `spotify:${trackId}` : null;

    if (cacheKey) {
      const cached = cache.get(cacheKey);
      if (cached) {
        return res.json({ result: { ...cached, cache: true } });
      }
    }

    try {
      const { tracks, sessionCookie } = await search(url);

      if (!tracks.length) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Track tidak ditemukan untuk URL ini.' }
        });
      }

      const track = tracks[0];
      const links = await getDownloadLinks(track.form, sessionCookie);

      if (!links.mp3) {
        return res.status(502).json({
          ok: false,
          error: { code: 'NO_DOWNLOAD_LINK', message: 'Link download tidak ditemukan, sumber mungkin berubah.' }
        });
      }

      const result = {
        name: track.metadata.name,
        artist: track.metadata.artist,
        album: track.metadata.album,
        cover: track.metadata.cover,
        duration: track.metadata.duration,
        date: track.metadata.date,
        spotifyUrl: track.metadata.tid ? `https://open.spotify.com/track/${track.metadata.tid}` : url,
        mp3: links.mp3,
        coverDownload: links.cover
      };

      if (cacheKey) cache.set(cacheKey, result, CACHE_TTL_MS);
      res.json({ result: { ...result, cache: false } });
    } catch (err) {
      console.error('[spotify] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses permintaan.' }
      });
    }
  });
};