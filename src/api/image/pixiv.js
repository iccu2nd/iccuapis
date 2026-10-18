'use strict';

const axios = require('axios');
const cache = require('../../cache');

const API = 'https://api.lolicon.app/setu/v2';
const CACHE_TTL_MS = 60000;
const PREFETCH_SIZE = 5;

let _cache = null;
let _cacheTime = 0;

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/image/pixiv',
    group: 'image',
    name: 'Pixiv Random Image',
    description: 'Ambil gambar random dari Pixiv. Default SFW (aman).',
    params: [
      {
        key: 'mode',
        required: false,
        hint: 'Pilih mode gambar (default: sfw)',
        example: 'sfw',
        options: ['sfw', 'nsfw']
      },
      {
        key: 'q',
        required: false,
        hint: 'Kata kunci (opsional)',
        example: 'anime'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { mode = 'sfw', q = '' } = req.query;

    let r18 = 0;
    if (mode.toLowerCase().includes('nsfw') || mode.toLowerCase() === 'nsfw') {
      r18 = 1;
    }

    try {
      let item;

      if (q && q.trim()) {
        const body = {
          r18,
          num: 1,
          excludeAI: true,
          size: ['original', 'regular'],
          keyword: q.trim()
        };

        const response = await axios.post(API, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 15000
        });

        item = response.data?.data?.[0];
      } else {
        item = await getItem(r18);
      }

      if (!item) {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: `Tidak ada hasil${q ? ` untuk "${q}"` : ''}`
          }
        });
      }

      const url = item.urls?.original || item.urls?.regular;
      if (!url) {
        return res.status(502).json({
          ok: false,
          error: {
            code: 'INVALID_RESPONSE',
            message: 'URL gambar tidak ditemukan'
          }
        });
      }

      const tags = (item.tags || [])
        .filter(t => !['R-18', 'R-18G'].includes(t))
        .slice(0, 10);

      res.json({
        result: {
          id: item.pid,
          title: item.title || 'Untitled',
          author: item.author || 'Unknown',
          url: url,
          thumbnail: item.urls?.regular || url,
          tags: tags,
          mode: r18 === 1 ? 'NSFW' : 'SFW',
          source: `https://pixiv.net/artworks/${item.pid}`,
          width: item.width || 0,
          height: item.height || 0
        }
      });

    } catch (err) {
      console.error('[pixiv] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mengambil gambar dari Pixiv'
        }
      });
    }
  });
};

async function prefetch(r18) {
  const body = {
    r18,
    num: PREFETCH_SIZE,
    excludeAI: true,
    size: ['original', 'regular']
  };

  const response = await axios.post(API, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });

  return response.data?.data || [];
}

async function getItem(r18) {
  const now = Date.now();

  if (_cache?.r18 === r18 && _cache.items.length && now - _cacheTime < CACHE_TTL_MS) {
    const item = _cache.items.shift();

    if (_cache.items.length < 2) {
      prefetch(r18).then(items => {
        if (items.length) {
          _cache = { r18, items };
          _cacheTime = Date.now();
        }
      }).catch(() => {});
    }

    return item;
  }

  const items = await prefetch(r18);
  const item = items.shift();
  _cache = { r18, items };
  _cacheTime = Date.now();

  return item;
}