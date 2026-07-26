'use strict';

const axios = require('axios');
const cache = require('../../cache');

const CACHE_TTL_MS = 10 * 60 * 1000;
const AUTH_KEY = '20250901majwlqo';
const DOMAIN = 'api-ak.vidssave.com';

async function downloadAll(url) {
  const payload = new URLSearchParams({
    auth: AUTH_KEY,
    domain: DOMAIN,
    origin: 'source',
    link: url
  }).toString();

  const { data } = await axios.post('https://api.vidssave.com/api/contentsite_api/media/parse', payload, {
    headers: {
      accept: '*/*',
      'accept-language': 'id-ID',
      'cache-control': 'no-cache',
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://vidssave.com',
      pragma: 'no-cache',
      referer: 'https://vidssave.com/',
      'user-agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Mobile Safari/537.36'
    },
    timeout: 20000
  });

  const result = data?.data || data;
  if (!result) {
    throw new Error('Gagal mendapatkan data media. Pastikan URL benar dan didukung.');
  }
  return result;
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/all',
    group: 'download',
    name: 'All-in-One Downloader',
    description: 'Download media dari berbagai platform (TikTok, Instagram, YouTube, Facebook, dan lainnya) lewat satu endpoint.',
    params: [
      { key: 'url', required: true, hint: 'URL konten yang mau didownload', example: 'https://vt.tiktok.com/xxxxxxx' }
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

    const cacheKey = `all-dl:${url.trim()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ result: { ...cached, cache: true } });
    }

    try {
      const result = await downloadAll(url.trim());
      cache.set(cacheKey, result, CACHE_TTL_MS);
      res.json({ result: { ...result, cache: false } });
    } catch (err) {
      console.error('[download/all] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses permintaan.' }
      });
    }
  });
};
