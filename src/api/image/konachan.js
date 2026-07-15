'use strict';

const axios = require('axios');
const cache = require('../../cache');

// konachan.com sering nyodorin Cloudflare challenge dan balikin 403 kalau
// request-nya kelihatan kayak bot. Kita coba beberapa mirror + header yang
// lebih mirip browser asli, dan cache hasil listing-nya biar gak nembak
// upstream tiap request (ngurangin kemungkinan kena challenge lagi).
const MIRRORS = ['https://konachan.com', 'https://konachan.net'];
const LIST_TTL_MS = 5 * 60 * 1000; // 5 menit

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://konachan.com/post'
};

async function fetchFromMirror(base, q, page) {
  let apiUrl = `${base}/post.json?limit=100&page=${page}`;
  if (q && q.trim()) {
    const tagQuery = q.trim().replace(/\s+/g, '+');
    apiUrl = `${base}/post.json?limit=100&tags=${encodeURIComponent(tagQuery)}&page=${page}`;
  }

  const response = await axios.get(apiUrl, {
    headers: BROWSER_HEADERS,
    timeout: 15000
  });

  return response.data;
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/image/konachan',
    group: 'image',
    name: 'Konachan Random Image',
    description: 'Ambil gambar random dari Konachan.',
    params: [
      {
        key: 'q',
        required: false,
        hint: 'tags (opsional)',
        example: 'uncensored'
      },
      {
        key: 'limit',
        required: false,
        hint: 'Jumlah gambar (1-10)',
        example: '5'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q = '', limit = 5 } = req.query;
    const numLimit = Math.min(Math.max(1, parseInt(limit) || 5), 10);
    const page = Math.floor(Math.random() * 50) + 1;
    const cacheKey = `konachan:${q || 'random'}:${page}`;

    const errors = [];
    let data = null;

    try {
      data = await cache.wrap(cacheKey, LIST_TTL_MS, async () => {
        for (const mirror of MIRRORS) {
          try {
            const result = await fetchFromMirror(mirror, q, page);
            if (result && result.length) return result;
          } catch (err) {
            const status = err.response?.status;
            const blocked = status === 403 || /cloudflare/i.test(err.response?.data?.toString?.() || '');
            errors.push(`${mirror}: ${blocked ? 'diblokir Cloudflare (403)' : (err.message || status)}`);
          }
        }
        throw new Error(errors.join(' | ') || 'Semua mirror gagal diakses');
      });
    } catch (err) {
      console.error('[konachan] error:', err.message);
      return res.status(502).json({
        ok: false,
        error: {
          code: 'UPSTREAM_BLOCKED',
          message: 'Konachan lagi nolak request server (Cloudflare protection). Coba lagi beberapa saat lagi.',
          detail: err.message
        }
      });
    }

    if (!data || data.length === 0) {
      return res.status(404).json({
        ok: false,
        error: {
          code: 'NOT_FOUND',
          message: `Tidak ada hasil untuk: ${q || 'random'}`
        }
      });
    }

    const picked = [...data].sort(() => 0.5 - Math.random()).slice(0, numLimit);

    const images = picked.map(post => ({
      url: post.file_url,
      preview: post.preview_url,
      tags: post.tags ? post.tags.split(' ') : [],
      rating: post.rating,
      source: `https://konachan.com/post/show/${post.id}`
    }));

    res.json({
      result: {
        total: images.length,
        keyword: q || 'random',
        images: images
      }
    });
  });
};
