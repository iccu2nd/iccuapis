'use strict';

const axios = require('axios');
const bycfPkg = require('bycf');

const bycf = bycfPkg.shannz || bycfPkg.shz || bycfPkg.default || bycfPkg;

const IZEN = 'https://izen.lol/api/bypass';
const SITEKEY = '0x4AAAAAADNEi_2N24gpQqY0';

async function bypassIzenLol(url) {
  const token = await bycf.turnstileMin('https://izen.lol', SITEKEY);
  if (!token) throw new Error('Gagal solve captcha turnstile');

  const response = await axios.post(
    IZEN,
    { url, captchaToken: token },
    {
      headers: {
        'Content-Type': 'application/json',
        Referer: 'https://izen.lol/',
        Origin: 'https://izen.lol',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
        'Cache-Control': 'no-cache'
      },
      timeout: 120000,
      validateStatus: () => true
    }
  );

  if (response.status !== 200 || !response.data) {
    throw new Error(response.data?.message || 'Gagal bypass link');
  }

  return response.data;
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/skiplink',
    group: 'tools',
    name: 'Bypass Link',
    description: 'Bongkar shortlink jadi link asli via izen.lol.',
    params: [
      {
        key: 'url',
        required: true,
        hint: 'URL shortlink yang ingin di-bypass',
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
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'INVALID_URL', message: 'URL tidak valid, harus diawali http:// atau https://' }
      });
    }

    try {
      const data = await bypassIzenLol(trimmed);

      res.json({
        result: {
          finalUrl: data.url || data.destination || (typeof data.result === 'string' ? data.result : null),
          raw: data.result && typeof data.result === 'object' ? data.result : null,
          message: data.message || null
        }
      });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: err.response?.data?.message || err.message || 'Gagal bypass link.'
        }
      });
    }
  });
};
