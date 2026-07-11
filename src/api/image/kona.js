'use strict';

const axios = require('axios');
const cache = require('../../cache');

const CACHE_TTL_MS = 300000;

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/image/konachan',
    group: 'image',
    name: 'Konachan Random Image',
    description: 'Ambil gambar random dari Konachan (anime/blue archive). Bisa filter dengan tags.',
    params: [
      { 
        key: 'tags', 
        required: false, 
        hint: 'Tag pencarian (opsional, pisahkan dengan spasi)', 
        example: 'blue_archive' 
      },
      { 
        key: 'limit', 
        required: false, 
        hint: 'Jumlah gambar (1-10, default: 5)', 
        example: '5' 
      },
      { 
        key: 'rating', 
        required: false, 
        hint: 'Rating gambar', 
        example: 'safe',
        options: ['safe', 'questionable', 'explicit', 'all']
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { tags = '', limit = 5, rating = 'all' } = req.query;

    const numLimit = Math.min(Math.max(1, parseInt(limit) || 5), 10);

    try {
      let page = Math.floor(Math.random() * 50) + 1;
      let apiUrl = `https://konachan.com/post.json?limit=100&page=${page}`;

      if (tags && tags.trim()) {
        let tagQuery = tags.trim().replace(/\s+/g, '+');
        if (rating !== 'all') {
          tagQuery += `+rating:${rating}`;
        }
        apiUrl = `https://konachan.com/post.json?limit=100&tags=${encodeURIComponent(tagQuery)}&page=${page}`;
      } else if (rating !== 'all') {
        apiUrl = `https://konachan.com/post.json?limit=100&tags=rating:${rating}&page=${page}`;
      }

      const response = await axios.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });

      let data = response.data;
      if (!data || data.length === 0) {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: `Tidak ada hasil untuk tags: ${tags || 'random'}`
          }
        });
      }

      data = data.sort(() => 0.5 - Math.random()).slice(0, numLimit);

      const images = data.map(post => ({
        id: post.id,
        url: post.file_url,
        preview: post.preview_url,
        sample: post.sample_url,
        width: post.width,
        height: post.height,
        tags: post.tags ? post.tags.split(' ') : [],
        rating: post.rating,
        source: `https://konachan.com/post/show/${post.id}`
      }));

      const validImages = images.filter(img => img.url);

      if (validImages.length === 0) {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gagal mengambil gambar'
          }
        });
      }

      const tagInfo = tags ? tags.trim() : 'random';
      const ratingLabel = rating === 'all' ? 'semua rating' : rating;

      res.json({
        result: {
          total: validImages.length,
          query: tagInfo,
          rating: ratingLabel,
          images: validImages,
          source: 'Konachan.com'
        }
      });

    } catch (err) {
      console.error('[konachan] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mengambil gambar dari Konachan'
        }
      });
    }
  });

  app.post(route.path, async (req, res) => {
    const { tags = '', limit = 5, rating = 'all', page = null } = req.body;

    const numLimit = Math.min(Math.max(1, parseInt(limit) || 5), 20);
    const pageNum = page || Math.floor(Math.random() * 50) + 1;

    try {
      let apiUrl = `https://konachan.com/post.json?limit=100&page=${pageNum}`;

      if (tags && tags.trim()) {
        let tagQuery = tags.trim().replace(/\s+/g, '+');
        if (rating !== 'all') {
          tagQuery += `+rating:${rating}`;
        }
        apiUrl = `https://konachan.com/post.json?limit=100&tags=${encodeURIComponent(tagQuery)}&page=${pageNum}`;
      } else if (rating !== 'all') {
        apiUrl = `https://konachan.com/post.json?limit=100&tags=rating:${rating}&page=${pageNum}`;
      }

      const response = await axios.get(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        timeout: 15000
      });

      let data = response.data;
      if (!data || data.length === 0) {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: `Tidak ada hasil untuk tags: ${tags || 'random'}`
          }
        });
      }

      data = data.sort(() => 0.5 - Math.random()).slice(0, numLimit);

      const images = data.map(post => ({
        id: post.id,
        url: post.file_url,
        preview: post.preview_url,
        sample: post.sample_url,
        width: post.width,
        height: post.height,
        tags: post.tags ? post.tags.split(' ') : [],
        rating: post.rating,
        source: `https://konachan.com/post/show/${post.id}`
      }));

      const validImages = images.filter(img => img.url);

      if (validImages.length === 0) {
        return res.status(404).json({
          ok: false,
          error: {
            code: 'NOT_FOUND',
            message: 'Gagal mengambil gambar'
          }
        });
      }

      res.json({
        result: {
          total: validImages.length,
          query: tags || 'random',
          rating: rating === 'all' ? 'semua rating' : rating,
          page: pageNum,
          images: validImages,
          source: 'Konachan.com'
        }
      });

    } catch (err) {
      console.error('[konachan] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mengambil gambar dari Konachan'
        }
      });
    }
  });
};