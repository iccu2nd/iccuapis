'use strict';

const axios = require('axios');
const crypto = require('crypto');
const cache = require('../../cache');

const BASE_URL = 'https://www.tikwm.com';
const TTL_MS = 5 * 60 * 1000;

function fullUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return BASE_URL + url;
}

async function searchPhoto({ keywords, url, count, cursor, hd }) {
  const params = new URLSearchParams({
    unique_id: `user_${crypto.randomBytes(6).toString('hex')}`,
    count: String(count),
    cursor: String(cursor),
    web: '1',
    hd: String(hd),
    keywords,
    url
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

  if (!data || data.code !== 0) throw new Error(data?.msg || 'tikwm mengembalikan respons gagal.');
  const items = Array.isArray(data.data?.videos) ? data.data.videos : [];

  return {
    total: items.length,
    cursor: data.data?.cursor ?? null,
    hasMore: data.data?.hasMore ?? false,
    items: items.map((item) => ({
      id: item.video_id || item.id || null,
      title: item.title || null,
      author: item.author?.nickname || item.author?.unique_id || null,
      cover: fullUrl(item.cover),
      music: fullUrl(item.music),
      imagesTotal: Array.isArray(item.images) ? item.images.length : 0,
      images: Array.isArray(item.images) ? item.images : [],
      stats: {
        play: item.play_count || 0,
        like: item.digg_count || 0,
        comment: item.comment_count || 0,
        share: item.share_count || 0
      }
    }))
  };
}

async function searchVideo({ keywords, count, cursor, hd }) {
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

  if (!data || data.code !== 0) throw new Error(data?.msg || 'tikwm mengembalikan respons gagal.');
  const items = Array.isArray(data.data?.videos) ? data.data.videos : [];

  return {
    total: items.length,
    cursor: data.data?.cursor ?? null,
    hasMore: data.data?.hasMore ?? false,
    items: items.map((item) => ({
      id: item.video_id || item.id || null,
      title: item.title || null,
      author: item.author?.nickname || item.author?.unique_id || null,
      duration: item.duration || 0,
      play: fullUrl(item.play),
      wmplay: fullUrl(item.wmplay),
      music: fullUrl(item.music),
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

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/search/tiktok',
    group: 'search',
    name: 'TikTok Search',
    description: 'Cari konten TikTok berdasarkan keyword. Bisa pilih tipe video atau photo mode.',
    params: [
      { key: 'type', required: false, hint: 'pilih video atau photo (default: video)', example: 'video', options: ['video', 'photo'] },
      { key: 'keywords', required: true, hint: 'kata kunci pencarian', example: 'lamborghini' },
      { key: 'url', required: false, hint: 'wajib diisi kalau type=photo, URL post TikTok sebagai referensi', example: 'https://vt.tiktok.com/ZSQfMfpET/' },
      { key: 'count', required: false, hint: 'jumlah hasil, 1-30 (default: 12)', example: '12' },
      { key: 'cursor', required: false, hint: 'offset paginasi (default: 0)', example: '0' },
      { key: 'hd', required: false, hint: '1 untuk HD, 0 untuk normal (default: 1)', example: '1', options: ['1', '0'] }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const type = String(req.query.type).toLowerCase() === 'photo' ? 'photo' : 'video';
    const { keywords, url } = req.query;

    if (!keywords || !keywords.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "keywords" wajib diisi.' }
      });
    }
    if (type === 'photo' && (!url || !url.trim())) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "url" wajib diisi kalau type=photo.' }
      });
    }

    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 12, 1), 30);
    const cursor = Math.max(parseInt(req.query.cursor, 10) || 0, 0);
    const hd = String(req.query.hd) === '0' ? 0 : 1;

    try {
      const cacheKey = `tiktok-${type}:${keywords.trim().toLowerCase()}:${url?.trim() || ''}:${count}:${cursor}:${hd}`;
      const result = await cache.wrap(cacheKey, TTL_MS, () => (
        type === 'photo'
          ? searchPhoto({ keywords: keywords.trim(), url: url.trim(), count, cursor, hd })
          : searchVideo({ keywords: keywords.trim(), count, cursor, hd })
      ));
      res.json({ result: { type, ...result } });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: err.message || 'Gagal mengambil hasil pencarian.' }
      });
    }
  });
};
