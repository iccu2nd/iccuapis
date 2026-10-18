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

const registry = [];
const registeredPaths = new Set();

function isExecutableEndpoint(req) {
  if (registeredPaths.has(req.path)) return true;
  if (req.path.startsWith('/api/') && !ALWAYS_ALLOWED_PATHS.has(req.path)) return true;
  return false;
}

function getClientIp(req) {
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

app.get('/manifest.json', (req, res) => {
  res.json({ result: { identity: config.identity, groups: autoGroups, links: config.links } });
});

app.use((req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    if (!registeredPaths.has(req.path)) return;

    const ms = Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6);
    const ip = req.ip || req.socket?.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    monitor.recordRequest({
      ip,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms
    });

    // Fire-and-forget — never block the response path
    setImmediate(() => {
      try {
        sendNotification(ip, req.method, req.path, res.statusCode, ms, userAgent, req.query);
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
      } catch (err) {
        console.error('[notify]', err.message);
      }
    });
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

const autoGroups = {};
fs.readdirSync(apiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .forEach((group, index) => {
    autoGroups[group.name] = {
      label: group.name.charAt(0).toUpperCase() + group.name.slice(1),
      order: index + 1,
      icon: group.name
    };
  });

fs.readdirSync(apiRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .forEach((group) => {
    const groupPath = path.join(apiRoot, group.name);
    fs.readdirSync(groupPath)
      .filter((file) => file.endsWith('.js'))
      .forEach((file) => {
        try {
          const before = registry.length;
          const mod = require(path.join(groupPath, file));
          mod(makeSafeAppShim(app), registry, { group: group.name });
          for (let i = before; i < registry.length; i++) {
            if (registry[i].path) registeredPaths.add(registry[i].path);
          }
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
  const limit = Math.min(Math.max(Number(req.query.limit) || 1000, 1), 1000);
  res.json({ result: monitor.recentLog(limit) });
});

app.get('/api/notifications', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);

  let announceItems = [];
  const db = await getDb();
  if (db) {
    try {
      const docs = await db.collection('notifications')
        .find({}, { projection: { text: 1, createdAt: 1 } })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
      announceItems = docs.map((d) => ({
        type: 'announcement',
        at: d.createdAt,
        text: d.text
      }));
    } catch (err) {
      console.error('[notifications]', err.message);
    }
  }

  res.json({ result: announceItems });
});

app.get('/api/views', (req, res) => {
  res.json({ result: { totalViews: monitor.uniqueVisitorCount() } });
});

app.get('/api/myip', (req, res) => {
  res.json({ result: { ip: req.ip } });
});

app.use('/', express.static(path.join(__dirname, 'public'), {
  index: false,
  etag: true,
  lastModified: true,
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
  setHeaders: (res, filePath) => {
    if (/\.(html)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else if (/\.(css|js|woff2?|png|jpg|jpeg|gif|svg|wav|ico)$/i.test(filePath)) {
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
    }
  }
}));

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