'use strict';

const axios = require('axios');
const crypto = require('crypto');
const cache = require('../../cache');

const BASE_URL = 'https://www.tikwm.com';
const CACHE_TTL_MS = 5 * 60 * 1000;

function fullUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return BASE_URL + url;
}

async function searchVideo({ keywords, count = 12, cursor = 0, hd = 1 }) {
  const body = new URLSearchParams({
    keywords,
    count: String(count),
    cursor: String(cursor),
    web: '1',
    hd: String(hd)
  });

  const { data } = await axios.post(`${BASE_URL}/api/feed/search`, body.toString(), {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:152.0) Gecko/20100101 Firefox/152.0',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`
    },
    timeout: 15000
  });

  if (!data || data.code !== 0) throw new Error(data?.msg || 'Gagal ambil data TikTok');

  const items = Array.isArray(data.data?.videos) ? data.data.videos : [];

  return {
    type: 'video',
    total: items.length,
    cursor: data.data?.cursor ?? null,
    hasMore: data.data?.hasMore ?? false,
    items: items.map((item) => ({
      id: item.video_id || item.id || null,
      title: item.title || null,
      author: item.author?.nickname || item.author?.unique_id || null,
      duration: item.duration || 0,
      video: fullUrl(item.play),
      wm_video: fullUrl(item.wmplay),
      audio: fullUrl(item.music),
      cover: fullUrl(item.cover),
      stats: {
        play: item.play_count || 0,
        like: item.digg_count || 0,
        comment: item.comment_count || 0,
        share: item.share_count || 0,
        download: item.download_count || 0
      }
    }))
  };
}

async function searchPhoto({ keywords, count = 12, cursor = 0, hd = 1 }) {
  const params = new URLSearchParams({
    unique_id: `user_${crypto.randomBytes(6).toString('hex')}`,
    count: String(count),
    cursor: String(cursor),
    web: '1',
    hd: String(hd),
    keywords,
    url: ''
  });

  const { data } = await axios.post(`${BASE_URL}/api/photo/search`, params.toString(), {
    headers: {
      Accept: 'application/json, text/javascript, */*; q=0.01',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Mobile Safari/537.36',
      'X-Requested-With': 'XMLHttpRequest',
      Origin: BASE_URL,
      Referer: `${BASE_URL}/`
    },
    timeout: 15000
  });

  if (!data || data.code !== 0) throw new Error(data?.msg || 'Gagal ambil data TikTok');

  const items = Array.isArray(data.data?.videos) ? data.data.videos : [];

  return {
    type: 'photo',
    total: items.length,
    cursor: data.data?.cursor ?? null,
    hasMore: data.data?.hasMore ?? false,
    items: items.map((item) => ({
      id: item.video_id || item.id || null,
      title: item.title || null,
      author: item.author?.nickname || item.author?.unique_id || null,
      images: Array.isArray(item.images) ? item.images : [],
      cover: fullUrl(item.cover),
      audio: fullUrl(item.music),
      stats: {
        play: item.play_count || 0,
        like: item.digg_count || 0,
        comment: item.comment_count || 0,
        share: item.share_count || 0
      }
    }))
  };
}

async function searchAll({ keywords, count = 12, cursor = 0, hd = 1 }) {
  const [videoResult, photoResult] = await Promise.all([
    searchVideo({ keywords, count, cursor, hd }),
    searchPhoto({ keywords, count, cursor, hd })
  ]);

  return {
    type: 'all',
    total: videoResult.total + photoResult.total,
    video: videoResult,
    photo: photoResult
  };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/tiktok',
    group: 'search',
    name: 'TikTok Search',
    description: 'Cari konten TikTok (video, photo, atau semuanya)',
    params: [
      {
        key: 'q',
        required: true,
        hint: 'Kata kunci pencarian',
        example: 'kucing lucu'
      },
      {
        key: 'type',
        required: false,
        hint: 'video, photo, atau all (default: all)',
        example: 'all',
        options: ['video', 'photo', 'all']
      },
      {
        key: 'limit',
        required: false,
        hint: 'Jumlah hasil per kategori (1-30, default: 12)',
        example: '10'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { q, type = 'all', limit = 12 } = req.query;

    if (!q || !q.trim()) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'MISSING_PARAM',
          message: 'Parameter "q" wajib diisi.'
        }
      });
    }

    const count = Math.min(Math.max(parseInt(limit) || 12, 1), 30);
    const mode = type === 'photo' ? 'photo' : type === 'video' ? 'video' : 'all';

    try {
      const cacheKey = `tiktok:${mode}:${q.trim().toLowerCase()}:${count}`;
      const result = await cache.wrap(cacheKey, CACHE_TTL_MS, async () => {
        if (mode === 'video') {
          return await searchVideo({ keywords: q.trim(), count });
        } else if (mode === 'photo') {
          return await searchPhoto({ keywords: q.trim(), count });
        } else {
          return await searchAll({ keywords: q.trim(), count });
        }
      });

      res.json({ result });
    } catch (err) {
      console.error('[tiktok-search] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mencari konten TikTok'
        }
      });
    }
  });
};