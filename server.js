'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const monitor = require('./src/monitor');
const { startBot, sendNotification } = require('./src/bot');

if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('node:buffer').File;
}

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.set('json spaces', 2);
app.set('trust proxy', 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

// Paths that stay reachable even for a blocked IP — the website chrome
// itself (pages, static assets, manifest) plus the internal introspection
// endpoints the page uses to render itself (stats, routes list, IP display).
// Actual feature endpoints (/ai/*, /search/*, /tools/*, /download/*, etc.)
// still get rejected for a blocked IP.
const ALWAYS_ALLOWED_PATHS = new Set([
  '/',
  '/logs',
  '/manifest.json',
  '/api/routes',
  '/api/stats',
  '/api/logs',
  '/api/views',
  '/api/myip',
  '/api/notifications'
]);

function isBrowsablePage(req) {
  if (ALWAYS_ALLOWED_PATHS.has(req.path)) return true;
  // Static assets served from /public (css/js/images/fonts) — anything
  // with a file extension that isn't an API call.
  if (req.method === 'GET' && /\.[a-zA-Z0-9]+$/.test(req.path) && !req.path.startsWith('/api/')) {
    return true;
  }
  return false;
}

app.use((req, res, next) => {
  const ip = req.ip;
  if (monitor.isBlocked(ip) && !isBrowsablePage(req)) {
    monitor.recordBlockedHit(ip);
    return res.status(403).json({
      ok: false,
      error: { code: 'IP_BLOCKED', message: 'Your IP has been blocked from accessing this API.' }
    });
  }
  next();
});

app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 90,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    ok: false,
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down and try again shortly.'
    }
  }
}));

app.use((req, res, next) => {
  const send = res.json.bind(res);
  res.json = (payload = {}) => {
    const { ok = true, result, error, meta } = payload;
    const envelope = {
      ok,
      provider: config.identity.name,
      path: req.originalUrl,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
      ...(meta !== undefined ? { meta } : {}),
      timestamp: new Date().toISOString()
    };
    return send(envelope);
  };
  next();
});

app.get('/manifest.json', (req, res) => res.json({ result: { identity: config.identity } }));

// Registered up front (before the API route modules below are mounted) so
// this middleware's next() chain actually runs on every request. If it were
// mounted after app.get(route.path, ...) for each endpoint, Express would
// already have handled and ended matching requests before they ever reached
// this middleware, since app.use() only sees requests that fall through
// earlier handlers registered before it.
const registry = [];

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    // Only count requests that actually hit one of the registered API
    // endpoints (e.g. /ai/removebg) — not internal pages like manifest.json,
    // index.html, app.js, or the gateway's own /api/* introspection routes.
    const isRegisteredEndpoint = registry.some((r) => r.path === req.path);
    if (!isRegisteredEndpoint) return;

    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const ip = req.ip || req.connection.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    monitor.recordRequest({
      ip: ip,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Math.round(ms)
    });

    sendNotification(ip, req.method, req.path, res.statusCode, Math.round(ms), userAgent, req.query);
  });
  next();
});

const apiRoot = path.join(__dirname, 'src/api');
let loadedCount = 0;

fs.readdirSync(apiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .forEach((group) => {
    const groupPath = path.join(apiRoot, group.name);
    fs.readdirSync(groupPath)
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => {
        try {
          const mod = require(path.join(groupPath, file));
          mod(app, registry, { group: group.name });
          loadedCount += 1;
        } catch (err) {
          console.error(`[route-load-error] ${group.name}/${file}: ${err.message}`);
        }
      });
  });

console.log(`[gateway] ${loadedCount} route module(s) loaded`);

app.get('/api/routes', (req, res) => {
  res.json({ result: registry });
});

app.get('/api/stats', (req, res) => {
  res.json({ result: monitor.stats() });
});

app.get('/api/logs', (req, res) => {
  res.json({ result: monitor.todaysLog() });
});

app.get('/api/notifications', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  res.json({ result: monitor.recentLog(limit) });
});

app.get('/api/views', (req, res) => {
  res.json({ result: { totalViews: monitor.uniqueVisitorCount() } });
});

app.get('/api/myip', (req, res) => {
  res.json({ result: { ip: req.ip } });
});

app.use('/', express.static(path.join(__dirname, 'public'), { index: false }));

app.get('/', (req, res) => {
  monitor.recordVisit(req.ip);
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/logs.html'));
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.originalUrl}` }
  });
});

app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.status(500).json({
    ok: false,
    error: { code: 'INTERNAL_ERROR', message: 'Something failed while handling this request.' }
  });
});

monitor.init().finally(() => {
  app.listen(PORT, () => {
    console.log(`[gateway] listening on port ${PORT}`);
    startBot(config);
  });
});

module.exports = app;