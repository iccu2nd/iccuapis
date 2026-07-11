'use strict';

const axios = require('axios');

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/skiplink',
    group: 'tools',
    name: 'Skip SFL',
    description: 'Bongkar shortlink sfl.gl / safelinkblogger jadi link asli.',
    params: [
      {
        key: 'url',
        required: true,
        hint: 'URL shortlink sfl.gl atau safelinkblogger',
        example: 'https://sfl.gl/Tv7BqUhg'
      }
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

    const trimmed = url.trim();
    const isSupported = trimmed.includes('sfl.gl') || trimmed.includes('safelinkblogger');
    if (!isSupported) {
      return res.status(400).json({
        ok: false,
        error: {
          code: 'UNSUPPORTED_URL',
          message: 'URL tidak didukung. Endpoint ini hanya mendukung sfl.gl / safelinkblogger.'
        }
      });
    }

    try {
      const { data } = await axios.get(
        `https://fgsi.dpdns.org/api/tools/skip/tutwuri?apikey=fgsiapi-2be8cfa8-6d&url=${encodeURIComponent(trimmed)}`,
        { timeout: 30000 }
      );

      if (!data.status) {
        return res.status(502).json({
          ok: false,
          error: { code: 'UPSTREAM_ERROR', message: data.message || 'Gagal bypass link.' }
        });
      }

      res.json({
        result: {
          finalUrl: data.data?.url || null,
          message: data.data?.message || null
        }
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: err.response?.data?.message || err.message || 'Gagal menghubungi layanan bypass.'
        }
      });
    }
  });
};
