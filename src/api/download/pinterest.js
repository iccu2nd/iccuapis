'use strict';

const axios = require('axios');
const FormData = require('form-data');
const cache = require('../../cache');

const CACHE_TTL_MS = 15 * 60 * 1000;

function generateRandomIP() {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `${r()}.${r()}.${r()}.${r()}`;
}

async function fetchPinterestMedia(pinUrl) {
  const apiUrl = 'https://pintsave.net/api/fetch-media';
  const randomIp = generateRandomIP();
  const form = new FormData();
  form.append('url', pinUrl);

  const response = await axios.post(apiUrl, form, {
    headers: {
      ...form.getHeaders(),
      'Host': 'pintsave.net',
      'Origin': 'https://pintsave.net',
      'Referer': 'https://pintsave.net/id/download',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36',
      'X-Client-Ipv4': randomIp,
      'X-Forwarded-For': randomIp
    },
    timeout: 15000
  });

  const resData = response.data;
  if (!resData || !resData.media) {
    throw new Error('Gagal mendapatkan data media. Pastikan URL Pinterest benar.');
  }

  return {
    title: resData.title || null,
    description: resData.description || null,
    creator: resData.creator_username || null,
    statistics: {
      likes: resData.reaction_counts?.likes || 0,
      comments: resData.reaction_counts?.comments || 0
    },
    media: resData.media.map((item) => ({
      url: item.url,
      type: item.type,
      quality: item.quality,
      thumbnail: item.thumbnail || null
    }))
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/download/pinterest',
    group: 'download',
    name: 'Pinterest Downloader',
    description: 'Download foto/video dari pin Pinterest.',
    params: [
      { key: 'url', required: true, hint: 'URL pin Pinterest', example: 'https://pin.it/36HzdYnFx' }
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

    const cacheKey = `pinterest:${url.trim()}`;
    const cached = cache.get(cacheKey);
    if (cached) {
      return res.json({ result: { ...cached, cache: true } });
    }

    try {
      const result = await fetchPinterestMedia(url.trim());
      cache.set(cacheKey, result, CACHE_TTL_MS);
      res.json({ result: { ...result, cache: false } });
    } catch (err) {
      console.error('[pinterest] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal memproses permintaan.' }
      });
    }
  });
};