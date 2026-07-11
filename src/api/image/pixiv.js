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
    description: 'Ambil gambar random dari Pixiv (SFW atau R18). Bisa juga cari berdasarkan keyword.',
    params: [
      { 
        key: 'mode', 
        required: false, 
        hint: 'Pilih mode gambar', 
        example: 'sfw',
        options: ['sfw', 'r18']
      },
      { 
        key: 'keyword', 
        required: false, 
        hint: 'Kata kunci pencarian (opsional)', 
        example: 'anime girl' 
      },
      { 
        key: 'category', 
        required: false, 
        hint: 'Filter kategori', 
        example: 'general',
        options: ['general', 'sfw', 'nsfw', 'all']
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { mode = 'r18', keyword = '', category = 'general' } = req.query;

    let r18 = 1;
    if (mode.toLowerCase() === 'sfw') r18 = 0;
    else if (mode.toLowerCase() === 'r18') r18 = 1;
    else {
      return res.status(400).json({
        ok: false,
        error: { 
          code: 'INVALID_MODE', 
          message: 'Mode harus "sfw" atau "r18"' 
        }
      });
    }

    try {
      let item;

      if (keyword && keyword.trim()) {
        const body = { 
          r18, 
          num: 1, 
          excludeAI: true, 
          size: ['original', 'regular'], 
          keyword: keyword.trim() 
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
            message: `Tidak ada hasil${keyword ? ` untuk "${keyword}"` : ''}` 
          }
        });
      }

      const url = item.urls?.original || item.urls?.regular;
      if (!url) {
        return res.status(502).json({
          ok: false,
          error: { 
            code: 'INVALID_RESPONSE', 
            message: 'URL gambar tidak ditemukan dari API' 
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
          r18: r18 === 1,
          mode: r18 === 1 ? 'r18' : 'sfw',
          category: category.toLowerCase() || 'general',
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

  app.post(route.path, async (req, res) => {
    const { mode = 'r18', keyword = '', num = 1, tags = [] } = req.body;

    let r18 = 1;
    if (mode.toLowerCase() === 'sfw') r18 = 0;
    else if (mode.toLowerCase() === 'r18') r18 = 1;
    else {
      return res.status(400).json({
        ok: false,
        error: { 
          code: 'INVALID_MODE', 
          message: 'Mode harus "sfw" atau "r18"' 
        }
      });
    }

    const limit = Math.min(Math.max(1, Number(num) || 1), 20);

    try {
      const body = {
        r18,
        num: limit,
        excludeAI: true,
        size: ['original', 'regular'],
        ...(keyword && keyword.trim() ? { keyword: keyword.trim() } : {}),
        ...(tags && tags.length ? { tag: tags } : {})
      };

      const response = await axios.post(API, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      });

      const items = response.data?.data || [];

      if (!items.length) {
        return res.status(404).json({
          ok: false,
          error: { 
            code: 'NOT_FOUND', 
            message: 'Tidak ada hasil ditemukan' 
          }
        });
      }

      const results = items.map(item => ({
        id: item.pid,
        title: item.title || 'Untitled',
        author: item.author || 'Unknown',
        url: item.urls?.original || item.urls?.regular,
        thumbnail: item.urls?.regular,
        tags: (item.tags || []).filter(t => !['R-18', 'R-18G'].includes(t)).slice(0, 10),
        r18: r18 === 1,
        mode: r18 === 1 ? 'r18' : 'sfw',
        source: `https://pixiv.net/artworks/${item.pid}`,
        width: item.width || 0,
        height: item.height || 0
      }));

      res.json({ 
        result: {
          total: results.length,
          items: results,
          mode: r18 === 1 ? 'r18' : 'sfw'
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