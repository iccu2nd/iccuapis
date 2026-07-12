'use strict';

const https = require('https');
const { URL } = require('url');
const axios = require('axios');
const cheerio = require('cheerio');

const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
];

const rateLimit = {
  windowMs: 60000,
  maxRequests: 3,
  requests: []
};

function checkRateLimit(ip) {
  const now = Date.now();
  const windowStart = now - rateLimit.windowMs;
  rateLimit.requests = rateLimit.requests.filter(r => r.timestamp > windowStart);
  const ipRequests = rateLimit.requests.filter(r => r.ip === ip);
  if (ipRequests.length >= rateLimit.maxRequests) {
    const oldest = ipRequests[0]?.timestamp || now;
    const waitTime = rateLimit.windowMs - (now - oldest);
    return { allowed: false, waitTime: Math.ceil(waitTime / 1000) };
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
    description: 'Buat akun premium AlightMotion otomatis (email temp + verifikasi).',
    params: []
  };
  registry.push(route);

  app.get(route.path, async (req, res) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return res.status(429).json({
        ok: false,
        error: { code: 'RATE_LIMITED', message: `Tunggu ${rateCheck.waitTime} detik lagi` }
      });
    }

    try {
      const alight = new AlightMotion();
      const result = await alight.processSingleAccount();

      if (!result.ok) {
        return res.status(502).json({
          ok: false,
          error: { code: 'GENERATE_FAILED', message: result.error }
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
        error: { code: 'API_ERROR', message: err.message }
      });
    }
  });
};

class AlightMotion {
  constructor() {
    this.uaIndex = Math.floor(Math.random() * USER_AGENTS.length);
    this.tempmail = new TempMail();
  }

  _generateRandomIP() {
    const ranges = [
      [1, 1], [2, 2], [5, 5], [23, 23], [27, 27], [31, 31], [36, 36], [37, 37], [39, 39], [42, 42],
      [46, 46], [49, 49], [50, 50], [60, 60], [114, 114], [117, 117], [118, 118], [119, 119], [120, 120],
      [121, 121], [122, 122], [123, 123], [124, 124], [125, 125], [126, 126], [180, 180], [182, 182], [183, 183]
    ];
    const range = ranges[Math.floor(Math.random() * ranges.length)];
    return [range[0], Math.floor(Math.random() * 256), Math.floor(Math.random() * 256), Math.floor(Math.random() * 256)].join('.');
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
          try { resolve(JSON.parse(raw)); } catch (e) { resolve(raw); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }

  async processSingleAccount() {
    try {
      const tempResult = await this.tempmail.generate();
      if (!tempResult.success) throw new Error('Gagal generate email temp');
      const emailAddress = tempResult.result.email;

      const sendUrl = `https://am-prem.vxz.my.id/api/send?email=${encodeURIComponent(emailAddress)}&apikey=dkf_a027b3ff`;
      const sendResponse = await this._request(sendUrl);
      if (!sendResponse || sendResponse.success !== true) {
        throw new Error('Gagal kirim verifikasi');
      }

      let link = null;
      let attempts = 0;
      while (attempts < 20) {
        attempts++;
        const inbox = await this.tempmail.getInbox(emailAddress);
        if (inbox.success && inbox.result.inbox.length > 0) {
          for (const msg of inbox.result.inbox) {
            const match = msg.message?.match(/(https:\/\/alight-creative\.firebaseapp\.com\/__\/auth\/links\?link=[^\s"'>\\]+)/);
            if (match) { link = match[1]; break; }
          }
        }
        if (link) break;
        await new Promise(r => setTimeout(r, 3000));
      }

      if (!link) throw new Error('Link verifikasi tidak ditemukan');

      const verifyUrl = `https://am-prem.vxz.my.id/api/verify?email=${encodeURIComponent(emailAddress)}&link=${encodeURIComponent(link)}&apply=true&apikey=dkf_a027b3ff`;
      const verifyResponse = await this._request(verifyUrl);
      if (!verifyResponse || verifyResponse.success !== true) {
        throw new Error('Gagal verifikasi akun');
      }

      return {
        ok: true,
        data: { email: emailAddress, verify_link: link, timestamp: new Date().toISOString() }
      };
    } catch (e) {
      return { ok: false, error: e.message || 'ERR' };
    }
  }
}

class TempMail {
  constructor() {
    this.apiBase = 'https://generator.email/';
    this.apiValidate = 'check_adres_validation3.php';
    this.headers = {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7'
    };
    this._cookie = '';
  }

  async _fetch(url, options = {}) {
    try {
      const headers = { ...this.headers, ...options.headers };
      if (this._cookie) headers['Cookie'] = this._cookie;

      const response = await axios({
        url,
        method: options.method || 'GET',
        headers,
        data: options.body || null,
        timeout: 15000,
        maxRedirects: 5
      });

      const setCookie = response.headers['set-cookie'];
      if (setCookie && setCookie.length > 0) {
        const cookieStr = setCookie.join(';');
        const match = cookieStr.match(/surl=([^;]+)/);
        if (match) this._cookie = `surl=${match[1]}`;
      }

      return response.data;
    } catch (err) {
      throw new Error(err.message);
    }
  }

  async generate() {
    try {
      await this._fetch(this.apiBase, { _t: 1 });
      const html = await this._fetch(this.apiBase, { _t: 1 });

      const $ = cheerio.load(html);
      const email = $('#email_ch_text').text()?.trim();

      if (!email) {
        return { success: false, result: 'Gagal generate email' };
      }

      const [username, domain] = email.split('@');
      const params = new URLSearchParams({ usr: username, dmn: domain });
      const validation = await this._fetch(this.apiBase + this.apiValidate, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString()
      });

      return {
        success: true,
        result: {
          email,
          emailStatus: validation.status || null,
          uptime: validation.uptime || null
        }
      };
    } catch (error) {
      return { success: false, result: error.message };
    }
  }

  async getInbox(email) {
    if (!email) return { success: false, result: 'Email kosong' };

    const [username, domain] = email.split('@');
    if (!username || !domain) return { success: false, result: 'Email tidak valid' };

    const cookieValue = `surl=${domain}/${username}`;
    let html;
    try {
      html = await this._fetch(this.apiBase, {
        headers: { Cookie: cookieValue },
        _t: 1
      });
    } catch (error) {
      return { success: true, result: { email, inbox: [], error: error.message } };
    }

    const $ = cheerio.load(html);
    const messageCount = parseInt($('#mess_number').text()) || 0;
    const inbox = [];

    if (messageCount === 1) {
      const msg = this._parseMessage($);
      if (msg) inbox.push(msg);
    } else if (messageCount > 1) {
      const links = $('#email-table a').map((_, a) => $(a).attr('href')).get();
      for (const link of links) {
        const msgHtml = await this._fetch(this.apiBase + link, {
          headers: { Cookie: `surl=${link.replace('/', '')}` },
          _t: 1
        });
        const $msg = cheerio.load(msgHtml);
        const msg = this._parseMessage($msg);
        if (msg) inbox.push(msg);
      }
    }

    return { success: true, result: { email, inbox } };
  }

  _parseMessage($) {
    try {
      const spans = $('.e7m.col-md-9 span');
      const messageBody = $('.e7m.mess_bodiyy');
      return {
        from: spans.eq(3).text().replace(/\(.*?\)/, '').trim(),
        to: spans.eq(1).text(),
        created: $('.e7m.tooltip').text().replace('Created: ', ''),
        subject: $('h1').text(),
        message: messageBody.text().trim()
      };
    } catch {
      return null;
    }
  }
}