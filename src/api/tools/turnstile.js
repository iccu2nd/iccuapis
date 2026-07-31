'use strict';

const bycfPkg = require('bycf');

const bycf = bycfPkg.shannz || bycfPkg.shz || bycfPkg.default || bycfPkg;

async function solveTurnstile(siteUrl, sitekey) {
  const token = await bycf.turnstileMin(siteUrl, sitekey);
  if (!token) throw new Error('Gagal solve captcha turnstile');
  return token;
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/turnstile',
    group: 'tools',
    name: 'Turnstile Solver',
    description: 'Solve Cloudflare Turnstile captcha via bycf, hasilnya berupa token.',
    params: [
      {
        key: 'siteUrl',
        required: true,
        hint: 'URL situs yang punya widget Turnstile',
        example: 'https://example.com'
      },
      {
        key: 'sitekey',
        required: true,
        hint: 'Sitekey Turnstile situs target',
        example: '0x4AAAAAADNEi_2N24gpQqY0'
      }
    ]
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const { siteUrl, sitekey } = req.query;

    if (!siteUrl || !siteUrl.trim() || !sitekey || !sitekey.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_PARAM', message: 'Parameter "siteUrl" dan "sitekey" wajib diisi.' }
      });
    }

    try {
      const token = await solveTurnstile(siteUrl.trim(), sitekey.trim());
      res.json({ result: { token } });
    } catch (err) {
      res.status(502).json({
        ok: false,
        error: {
          code: 'UPSTREAM_ERROR',
          message: err.response?.data?.message || err.message || 'Gagal solve turnstile.'
        }
      });
    }
  });
};
