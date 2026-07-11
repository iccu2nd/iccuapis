'use strict';

const axios = require('axios');
const cache = require('../../cache');

const LINKS_TTL_MS = 30 * 60 * 1000; // 30 minutes — the source list rarely changes
const LINKS_CACHE_KEY = 'blue-archive:links';
const LINKS_URL = 'https://raw.githubusercontent.com/rynxzyy/blue-archive-r-img/refs/heads/main/links.json';

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/image/blue-archive',
    group: 'image',
    name: 'Blue Archive',
    description: 'Returns one random Blue Archive image as a PNG.',
    params: []
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    try {
      const links = await cache.wrap(LINKS_CACHE_KEY, LINKS_TTL_MS, async () => {
        const { data } = await axios.get(LINKS_URL, { timeout: 10000 });
        return data;
      });

      const pick = links[Math.floor(Math.random() * links.length)];
      const { data: image } = await axios.get(pick, {
        responseType: 'arraybuffer',
        timeout: 15000
      });

      const buffer = Buffer.from(image);
      res.writeHead(200, {
        'Content-Type': 'image/png',
        'Content-Length': buffer.length
      });
      res.end(buffer);
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: { code: 'UPSTREAM_ERROR', message: 'Could not fetch an image right now.' }
      });
    }
  });
};