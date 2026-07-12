'use strict';

const https = require('https');
const { URL } = require('url');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

const API_KEY = 'dkf_a027b3ff';

module.exports = function register(app, registry) {
  const sendRoute = {
    method: 'GET',
    path: '/tools/alightmotion/send',
    group: 'tools',
    name: 'AlightMotion Send',
    description: 'Kirim verifikasi ke email untuk AlightMotion premium.',
    params: [
      {
        key: 'email',
        required: true,
        hint: 'Email tujuan verifikasi',
        example: 'user@email.com'
      }
    ]
  };
  registry.push(sendRoute);

  app.get(sendRoute.path, async (req, res) => {
    const { email } = req.query;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_EMAIL', message: 'Parameter email wajib diisi' }
      });
    }

    try {
      const url = `https://am-prem.vxz.my.id/api/send?email=${encodeURIComponent(email)}&apikey=${API_KEY}`;
      const result = await request(url);

      if (!result || result.success !== true) {
        return res.status(502).json({
          ok: false,
          error: { code: 'SEND_FAILED', message: result?.message || 'Gagal kirim verifikasi' }
        });
      }

      res.json({
        result: {
          email: email,
          status: 'sent',
          message: 'Verifikasi berhasil dikirim ke email'
        }
      });
    } catch (err) {
      console.error('[alightmotion-send] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'API_ERROR', message: err.message }
      });
    }
  });

  const verifyRoute = {
    method: 'GET',
    path: '/tools/alightmotion/verify',
    group: 'tools',
    name: 'AlightMotion Verify',
    description: 'Verifikasi link ke AlightMotion premium.',
    params: [
      {
        key: 'email',
        required: true,
        hint: 'Email yang diverifikasi',
        example: 'user@email.com'
      },
      {
        key: 'link',
        required: true,
        hint: 'Link verifikasi dari email',
        example: 'https://alight-creative.firebaseapp.com/...'
      }
    ]
  };
  registry.push(verifyRoute);

  app.get(verifyRoute.path, async (req, res) => {
    const { email, link } = req.query;

    if (!email || !email.includes('@')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_EMAIL', message: 'Parameter email wajib diisi' }
      });
    }

    if (!link || !link.includes('alight-creative.firebaseapp.com')) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_LINK', message: 'Parameter link verifikasi wajib diisi' }
      });
    }

    try {
      const url = `https://am-prem.vxz.my.id/api/verify?email=${encodeURIComponent(email)}&link=${encodeURIComponent(link)}&apply=true&apikey=${API_KEY}`;
      const result = await request(url);

      if (!result || result.success !== true) {
        return res.status(502).json({
          ok: false,
          error: { code: 'VERIFY_FAILED', message: result?.message || 'Gagal verifikasi akun' }
        });
      }

      res.json({
        result: {
          email: email,
          status: 'verified',
          message: 'Akun AlightMotion premium berhasil diaktifkan!'
        }
      });
    } catch (err) {
      console.error('[alightmotion-verify] error:', err.message);
      res.status(502).json({
        ok: false,
        error: { code: 'API_ERROR', message: err.message }
      });
    }
  });
};

function request(urlStr) {
  const spoofedIp = generateRandomIP();
  const targetUrl = new URL(urlStr);
  const uaIndex = Math.floor(Math.random() * USER_AGENTS.length);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: targetUrl.hostname,
      path: targetUrl.pathname + targetUrl.search,
      method: 'GET',
      headers: {
        'User-Agent': USER_AGENTS[uaIndex],
        'Accept': 'application/json, text/plain, */*',
        'X-Forwarded-For': spoofedIp,
        'X-Real-IP': spoofedIp,
        'Client-IP': spoofedIp,
        'True-Client-IP': spoofedIp,
        'X-Originating-IP': spoofedIp,
        'X-Cluster-Client-IP': spoofedIp,
        'Forwarded': `for=${spoofedIp}`
      },
      rejectUnauthorized: false
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf-8');
        try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function generateRandomIP() {
  const ranges = [
    [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
    [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
    [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
  ];
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return [range[0], Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)].join('.');
}