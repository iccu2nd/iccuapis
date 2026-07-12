'use strict';

const https = require('https');
const { URL } = require('url');
const axios = require('axios');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

const emailCache = new Map();

const rateLimit = {
  windowMs: 60000,
  maxRequests: 3,
  requests: [],
  resetTimer: null
};

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - rateLimit.windowMs;
  
  rateLimit.requests = rateLimit.requests.filter(r => r.timestamp > windowStart);
  
  const ipRequests = rateLimit.requests.filter(r => r.ip === ip);
  
  if (ipRequests.length >= rateLimit.maxRequests) {
    const oldest = ipRequests[0]?.timestamp || now;
    const waitTime = rateLimit.windowMs - (now - oldest);
    return {
      allowed: false,
      waitTime: Math.ceil(waitTime / 1000),
      message: `Rate limit tercapai. Tunggu ${Math.ceil(waitTime / 1000)} detik lagi.`
    };
  }
  
  rateLimit.requests.push({ ip, timestamp: now });
  return { allowed: true };
}

module.exports = function register(app, registry) {
  const route = {
    method: 'GET',
    path: '/tools/alightmotion',
    group: 'tools',
    name: 'AlightMotion Premium Generator',
    description: 'Buat akun premium AlightMotion otomatis. Maks 3 request per menit per IP.',
    params: []
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: {
          code: 'RATE_LIMITED',
          message: rateCheck.message,
          waitTime: rateCheck.waitTime
        }
      });
    }

    try {
      const alight = new AlightMotion();
      const result = await alight.processSingleAccount();

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: {
            code: 'GENERATE_FAILED',
            message: result.error || 'Gagal membuat akun'
          }
        });
      }

      res.json({
        result: {
          email: result.data.email,
          verify_link: result.data.verify_link,
          timestamp: result.data.timestamp
        }
      });
    } catch (err) {
      console.error('[alightmotion] error:', err.message);
      res.status(502).json({
        ok: false,
        error: {
          code: 'API_ERROR',
          message: err.message || 'Gagal membuat akun AlightMotion'
        }
      });
    }
  });
};

class AlightMotion {
  constructor() {
    this.uaIndex = Math.floor(Math.random() * USER_AGENTS.length);
    this.tempmail = new TempmailV2();
  }

  _generateRandomIP() {
    const ranges = [
      [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
      [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
      [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
    ];
    const range = ranges[Math.floor(Math.random() * ranges.length)];
    return [
      range[0],
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256),
      Math.floor(Math.random() * 256)
    ].join('.');
  }

  async _request(targetUrlStr) {
    const spoofedIp = this._generateRandomIP();
    const targetUrl = new URL(targetUrlStr);

    return new Promise((resolve, reject) => {
      const options = {
        hostname: targetUrl.hostname,
        path: targetUrl.pathname + targetUrl.search,
        method: 'GET',
        headers: {
          'User-Agent': USER_AGENTS[this.uaIndex],
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
          try {
            resolve(JSON.parse(raw));
          } catch (e) {
            resolve(raw);
          }
        });
      });

      req.on('error', reject);
      req.end();
    });
  }

  async _waitForInboxLink(emailAddress) {
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      attempts++;
      let res;
      try {
        res = await this.tempmail.inbox(emailAddress);
      } catch (e) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      if (res && res.success === false) {
        await new Promise(r => setTimeout(r, 2000));
        continue;
      }

      const messages = Array.isArray(res) ? res : (res.emails || []);
      for (const msg of messages) {
        let textToSearch = '';
        if (msg.body_text) {
          textToSearch = msg.body_text;
        } else if (msg.body_html) {
          textToSearch = msg.body_html;
        } else {
          textToSearch = typeof msg === 'string' ? msg : JSON.stringify(msg);
        }

        textToSearch = textToSearch.replace(/&amp;/g, '&');

        const match = textToSearch.match(/(https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>\\]+)/);
        if (match) {
          return match[1];
        }
      }

      await new Promise(r => setTimeout(r, 3000));
    }

    throw new Error('Timeout menunggu link verifikasi');
  }

  async processSingleAccount() {
    try {
      const tempResponse = await this.tempmail.generate(525600);
      if (!tempResponse || tempResponse.success !== true || !tempResponse.email || !tempResponse.email.address) {
        throw new Error('Gagal generate email temporary');
      }
      const emailAddress = tempResponse.email.address;

      const sendUrl = `https://am-prem.vxz.my.id/api/send?email=${encodeURIComponent(emailAddress)}&apikey=dkf_a027b3ff`;
      const sendResponse = await this._request(sendUrl);

      if (!sendResponse || sendResponse.success !== true) {
        throw new Error('Gagal mengirim verifikasi email');
      }

      const link = await this._waitForInboxLink(emailAddress);

      const verifyUrl = `https://am-prem.vxz.my.id/api/verify?email=${encodeURIComponent(emailAddress)}&link=${encodeURIComponent(link)}&apply=true&apikey=dkf_a027b3ff`;
      const verifyResponse = await this._request(verifyUrl);

      if (!verifyResponse || verifyResponse.success !== true) {
        throw new Error('Gagal verifikasi akun');
      }

      emailCache.set(emailAddress, {
        email: emailAddress,
        verify_link: link,
        timestamp: new Date().toISOString()
      });

      return {
        ok: true,
        data: {
          email: emailAddress,
          verify_link: link,
          timestamp: new Date().toISOString()
        }
      };
    } catch (e) {
      return { ok: false, error: e.message || 'ERR' };
    }
  }
}

class TempmailV2 {
  async generate(duration) {
    try {
      const response = await axios.post('https://api.tempmail.v2/generate', {
        duration: duration || 525600
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000
      });
      return response.data;
    } catch (err) {
      throw new Error('Gagal generate email: ' + err.message);
    }
  }

  async inbox(email) {
    try {
      const response = await axios.get(`https://api.tempmail.v2/inbox/${encodeURIComponent(email)}`, {
        timeout: 10000
      });
      return response.data;
    } catch (err) {
      throw new Error('Gagal cek inbox: ' + err.message);
    }
  }
}