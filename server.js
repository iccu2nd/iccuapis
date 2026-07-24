'use strict';

const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');

const config = require('./src/config');
const monitor = require('./src/monitor');
const cache = require('./src/cache');
const { startBot, sendNotification, sendErrorAlert } = require('./src/bot');
const { getDb } = require('./src/mongoClient');

if (typeof globalThis.File === 'undefined') {
  globalThis.File = require('node:buffer').File;
}

process.on('uncaughtException', (err) => {
  console.error('[fatal] uncaughtException — server tetap jalan:', err);
  sendErrorAlert({
    endpoint: 'GLOBAL/uncaughtException',
    message: err.message || String(err),
    stack: err.stack
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('[fatal] unhandledRejection — server tetap jalan:', reason);
  const err = reason instanceof Error ? reason : new Error(String(reason));
  sendErrorAlert({
    endpoint: 'GLOBAL/unhandledRejection',
    message: err.message,
    stack: err.stack
  });
});

const app = express();
const PORT = process.env.PORT || 4000;

app.disable('x-powered-by');
app.set('json spaces', 2);
// Number of reverse proxy hops in front of this server (Cloudflare, Nginx,
// your host's own load balancer, etc). If this is wrong, req.ip will NOT be
// the real client IP and IP blocking will silently stop working. Set
// TRUST_PROXY_HOPS in your env if you're not sure — see note above isBlocked check.
app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS) || 1);

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const bootedAt = Date.now();

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    status: 'up',
    uptimeSeconds: Math.round((Date.now() - bootedAt) / 1000),
    cacheEntries: cache.size(),
    timestamp: new Date().toISOString()
  });
});

const ALWAYS_ALLOWED_PATHS = new Set([
  '/',
  '/docs',
  '/logs',
  '/health',
  '/api/health',
  '/manifest.json',
  '/api/routes',
  '/api/stats',
  '/api/logs',
  '/api/views',
  '/api/myip',
  '/api/notifications'
]);

// Populated later (line ~132) when route modules under src/api/** are loaded.
// Declared here so the block middleware below can close over it — by the time
// any real request comes in (after app.listen), this array is fully populated.
const registry = [];

// Fail-closed: only pages/assets we explicitly recognize as safe are allowed
// through for a blocked IP. Everything that actually does work (every route
// under src/api/**, plus any other /api/* path we haven't explicitly
// whitelisted) is blocked, full stop — no guessing based on file extensions.
function isExecutableEndpoint(req) {
  if (registry.some((r) => r.method === req.method && r.path === req.path)) return true;
  if (req.path.startsWith('/api/') && !ALWAYS_ALLOWED_PATHS.has(req.path)) return true;
  return false;
}

function getClientIp(req) {
  // req.ip already honors X-Forwarded-For according to the 'trust proxy'
  // setting below. If you sit behind more than one reverse proxy (e.g.
  // Cloudflare in front of your host's own proxy/load balancer), 'trust
  // proxy' MUST equal the number of proxy hops, or req.ip will resolve to
  // an intermediate proxy instead of the real client — which silently makes
  // IP blocking useless. Adjust TRUST_PROXY_HOPS via env if needed.
  return req.ip;
}

app.use((req, res, next) => {
  const ip = getClientIp(req);
  if (monitor.isBlocked(ip) && isExecutableEndpoint(req)) {
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
    if (error) res.locals.errorPayload = error;
    const envelope = {
      status: res.statusCode,
      ok,
      creator: config.identity.creator,
      ...(result !== undefined ? { result } : {}),
      path: req.originalUrl,
      ...(error !== undefined ? { error } : {}),
      ...(meta !== undefined ? { meta } : {}),
      timestamp: new Date().toISOString()
    };
    return send(envelope);
  };
  next();
});

app.get('/manifest.json', (req, res) => res.json({ result: { identity: config.identity, groups: config.groups } }));

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
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

    if (res.statusCode >= 500) {
      const errPayload = res.locals.errorPayload || {};
      const rawError = res.locals.rawError;
      const detailPart = errPayload.detail ? ` — ${errPayload.detail}` : '';
      sendErrorAlert({
        endpoint: req.path,
        message: errPayload.message || `HTTP ${res.statusCode}`,
        extra: `code=${errPayload.code || 'UNKNOWN'} status=${res.statusCode} params=${JSON.stringify(req.query)}${detailPart}`,
        stack: rawError ? rawError.stack : undefined
      });
    }
  });
  next();
});

function wrapAsyncHandler(handler) {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') {
        result.catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

const HTTP_METHODS = ['get', 'post', 'put', 'delete', 'patch', 'all', 'use'];

function makeSafeAppShim(realApp) {
  const shim = Object.create(realApp);
  HTTP_METHODS.forEach((method) => {
    shim[method] = (routePath, ...handlers) => {
      const wrapped = handlers.map((h) => (typeof h === 'function' ? wrapAsyncHandler(h) : h));
      return realApp[method](routePath, ...wrapped);
    };
  });
  return shim;
}

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
          mod(makeSafeAppShim(app), registry, { group: group.name });
          loadedCount += 1;
        } catch (err) {
          console.error(`[route-load-error] ${group.name}/${file}: ${err.message}`);
          sendErrorAlert({
            endpoint: `ROUTE_LOAD/${group.name}/${file}`,
            message: err.message,
            stack: err.stack
          });
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

app.get('/api/notifications', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  let announceItems = [];
  const db = await getDb();
  if (db) {
    const docs = await db.collection('notifications')
      .find()
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
    announceItems = docs.map((d) => ({
      type: 'announcement',
      at: d.createdAt,
      text: d.text
    }));
  }

  res.json({ result: announceItems });
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

app.get('/docs', (req, res) => {
  monitor.recordVisit(req.ip);
  res.sendFile(path.join(__dirname, 'public/docs.html'));
});

app.get('/logs', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/logs.html'));
});

app.get('/health', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/health.html'));
});

app.use((req, res) => {
  res.status(404).json({
    ok: false,
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.originalUrl}` }
  });
});

app.use((err, req, res, next) => {
  console.error('[unhandled]', err);
  res.locals.rawError = err;
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