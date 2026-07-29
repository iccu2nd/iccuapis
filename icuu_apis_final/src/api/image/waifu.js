'use strict';

const axios = require('axios');

const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
};

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/image/waifu',
    group: 'image',
    name: 'Waifu Random Image',
    description: 'Ambil gambar waifu random (SFW/NSFW). Tanpa count kirim 1 file gambar langsung, count 2+ kirim JSON.',
    params: [
      { key: 'nsfw', required: false, hint: 'true untuk NSFW, false untuk SFW (default: false)', example: 'false' },
      { key: 'count', required: false, hint: 'jumlah gambar yang akan dikirim', example: '5' }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const nsfw = String(req.query.nsfw).toLowerCase() === 'true';
    const count = Math.min(Math.max(parseInt(req.query.count, 10) || 1, 1), 10);

    try {
      const params = new URLSearchParams({
        isNsfw: String(nsfw),
        orderBy: 'Random',
        page: '1',
        pageSize: String(count)
      });
      const { data } = await axios.get(`https://api.waifu.im/images?${params}`, { timeout: 15000 });
      const items = data?.items || [];
      if (!items.length) {
        return res.status(404).json({
          ok: false,
          error: { code: 'NOT_FOUND', message: 'Tidak ada gambar ditemukan.' }
        });
      }

      if (count === 1) {
        const { data: image } = await axios.get(items[0].url, { responseType: 'arraybuffer', timeout: 15000 });
        const ext = (items[0].extension || '.png').replace('.', '').toLowerCase();
        res.writeHead(200, { 'Content-Type': MIME_BY_EXT[ext] || 'image/png' });
        return res.end(Buffer.from(image));
      }

      res.json({
        result: items.map((item) => ({ url: item.url, tags: (item.tags || []).map((t) => t.name) }))
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Gagal mengambil gambar dari waifu.im.' }
      });
    }
  });
};