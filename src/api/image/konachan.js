'use strict';

const axios = require('axios');

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

    try {
      const page = Math.floor(Math.random() * 50) + 1;
      let apiUrl = `https://konachan.com/post.json?limit=100&page=${page}`;

      if (q && q.trim()) {
        const tagQuery = q.trim().replace(/\s+/g, '+');
        apiUrl = `https://konachan.com/post.json?limit=100&tags=${encodeURIComponent(tagQuery)}&page=${page}`;
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
            message: `Tidak ada hasil untuk: ${q || 'random'}`
          }
        });
      }

      data = data.sort(() => 0.5 - Math.random()).slice(0, numLimit);

      const images = data.map(post => ({
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

    } catch (err) {
      console.error('[konachan] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal mengambil gambar'
        }
      });
    }
  });
};