'use strict';

const { getDb } = require('./mongoClient');

const MAX_LOG = 2000;
const FLUSH_INTERVAL_MS = 15_000;

function todayWIB() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function normalizeIp(ip) {
  if (!ip) return ip;
  let out = String(ip).trim();

  if (out.startsWith('::ffff:')) {
    out = out.slice(7);
  }

  if (out === '::1' || out === '127.0.0.1') {
    out = '127.0.0.1';
  }

  return out.toLowerCase();
}

function ipToInt(ip) {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0 || n > 255) return null;
    out = (out << 8) + n;
  }
  return out >>> 0;
}

function isCidr(value) {
  return typeof value === 'string' && value.includes('/');
}

function parseCidr(cidr) {
  const [base, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const baseInt = ipToInt(base);
  if (baseInt === null || !Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    return null;
  }
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: baseInt & mask, mask, prefix };
}

function ipMatchesCidr(ip, parsedCidr) {
  const ipInt = ipToInt(ip);
  if (ipInt === null) return false;
  return (ipInt & parsedCidr.mask) === parsedCidr.base;
}

const state = {
  blockedIps: new Set(),
  blockedSubnets: new Map(),
  log: [],
  totals: new Map(),
  perIp: new Map(),
  uniqueVisitors: new Set(),

  totalAllTime: 0,
  blockedAllTime: 0,
  day: todayWIB(),
  totalToday: 0,
  blockedToday: 0,
  errors5xxToday: 0,

  pendingTotalDelta: 0,
  pendingBlockedDelta: 0,
  pendingDayTotalDelta: 0,
  pendingDayBlockedDelta: 0,
  pendingDay5xxDelta: 0,
  pendingIpBlockHits: new Map(),
  pendingNewVisitors: new Set()
};

let ready = false;

async function init() {
  const db = await getDb();
  if (!db) {
    ready = true;
    return;
  }

  try {
    await Promise.all([
      db.collection('blocked_ips').createIndex({ ip: 1 }, { unique: true }),
      db.collection('unique_visitors').createIndex({ ip: 1 }, { unique: true }),
      db.collection('request_log').createIndex({ day: 1, at: 1 })
    ]);

    const blocked = await db.collection('blocked_ips')
      .find({ blocked: true })
      .project({ ip: 1 })
      .toArray();
    blocked.forEach((row) => {
      if (isCidr(row.ip)) {
        const parsed = parseCidr(row.ip);
        if (parsed) state.blockedSubnets.set(row.ip, parsed);
      } else {
        state.blockedIps.add(normalizeIp(row.ip));
      }
    });

    const visitors = await db.collection('unique_visitors')
      .find({})
      .project({ ip: 1 })
      .toArray();
    visitors.forEach((row) => state.uniqueVisitors.add(normalizeIp(row.ip)));

    const totalsDoc = await db.collection('stats_total').findOne({ _id: 'totals' });
    if (totalsDoc) {
      state.totalAllTime = Number(totalsDoc.total_requests) || 0;
      state.blockedAllTime = Number(totalsDoc.blocked_requests) || 0;
    }

    const day = todayWIB();
    const dayDoc = await db.collection('stats_daily').findOne({ _id: day });
    if (dayDoc) {
      state.totalToday = Number(dayDoc.total_requests) || 0;
      state.blockedToday = Number(dayDoc.blocked_requests) || 0;
      state.errors5xxToday = Number(dayDoc.errors_5xx) || 0;
    }

    const todaysEntries = await db.collection('request_log')
      .find({ day })
      .sort({ at: 1 })
      .limit(MAX_LOG)
      .project({ _id: 0 })
      .toArray();
    state.log = todaysEntries;

    await db.collection('request_log').deleteMany({ day: { $ne: day } });

    console.log(
      `[monitor] hydrated from Mongo: ${state.blockedIps.size} blocked IP(s), ` +
      `${state.uniqueVisitors.size} unique visitor(s), ${state.totalAllTime} total requests all-time, ` +
      `${state.log.length} log entrie(s) for today`
    );
  } catch (err) {
    console.error('[monitor] failed to hydrate from Mongo:', err.message);
  } finally {
    ready = true;
  }
}

function rolloverDayIfNeeded() {
  const day = todayWIB();
  if (day !== state.day) {
    const oldDay = state.day;
    flush().finally(() => {
      state.day = day;
      state.totalToday = 0;
      state.blockedToday = 0;
      state.errors5xxToday = 0;
      state.log = [];

      getDb().then((db) => {
        if (!db) return;
        db.collection('request_log').deleteMany({ day: oldDay })
          .catch((err) => console.error('[monitor] failed to purge old day log:', err.message));
      });
    });
  }
}

function recordRequest({ ip, method, path, status, ms }) {
  rolloverDayIfNeeded();
  ip = normalizeIp(ip);

  const day = state.day;
  const entry = { day, ip, method, path, status, ms, at: new Date().toISOString() };
  state.log.push(entry);
  if (state.log.length > MAX_LOG) state.log.shift();

  state.totals.set(path, (state.totals.get(path) || 0) + 1);
  state.perIp.set(ip, (state.perIp.get(ip) || 0) + 1);

  state.totalAllTime += 1;
  state.totalToday += 1;
  state.pendingTotalDelta += 1;
  state.pendingDayTotalDelta += 1;

  if (status >= 500) {
    state.errors5xxToday += 1;
    state.pendingDay5xxDelta += 1;
  }

  getDb().then((db) => {
    if (!db) return;
    db.collection('request_log').insertOne(entry)
      .catch((err) => console.error('[monitor] failed to persist log entry:', err.message));
  });
}

function recordBlockedHit(ip) {
  rolloverDayIfNeeded();
  ip = normalizeIp(ip);

  state.blockedAllTime += 1;
  state.blockedToday += 1;
  state.pendingBlockedDelta += 1;
  state.pendingDayBlockedDelta += 1;
  state.pendingIpBlockHits.set(ip, (state.pendingIpBlockHits.get(ip) || 0) + 1);
}

function recordVisit(ip) {
  ip = normalizeIp(ip);
  if (!ip || state.uniqueVisitors.has(ip)) return false;

  state.uniqueVisitors.add(ip);
  state.pendingNewVisitors.add(ip);
  return true;
}

function uniqueVisitorCount() {
  return state.uniqueVisitors.size;
}

function isBlocked(ip) {
  const normalized = normalizeIp(ip);
  if (state.blockedIps.has(normalized)) return true;
  for (const parsed of state.blockedSubnets.values()) {
    if (ipMatchesCidr(normalized, parsed)) return true;
  }
  return false;
}

async function blockIp(value) {
  const db = await getDb();

  if (isCidr(value)) {
    const parsed = parseCidr(value);
    if (!parsed) throw new Error(`Invalid CIDR: ${value}`);
    state.blockedSubnets.set(value, parsed);

    if (!db) return;
    try {
      await db.collection('blocked_ips').updateOne(
        { ip: value },
        { $set: { ip: value, blocked: true, last_blocked_at: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      console.error('[monitor] failed to persist blockIp (subnet):', err.message);
    }
    return;
  }

  const ip = normalizeIp(value);
  state.blockedIps.add(ip);

  if (!db) return;
  try {
    await db.collection('blocked_ips').updateOne(
      { ip },
      { $set: { ip, blocked: true, last_blocked_at: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error('[monitor] failed to persist blockIp:', err.message);
  }
}

async function unblockIp(value) {
  const db = await getDb();

  if (isCidr(value)) {
    const removed = state.blockedSubnets.delete(value);
    if (!db) return removed;
    try {
      await db.collection('blocked_ips').updateOne(
        { ip: value },
        { $set: { blocked: false } }
      );
    } catch (err) {
      console.error('[monitor] failed to persist unblockIp (subnet):', err.message);
    }
    return removed;
  }

  const ip = normalizeIp(value);
  const removed = state.blockedIps.delete(ip);

  if (!db) return removed;
  try {
    await db.collection('blocked_ips').updateOne(
      { ip },
      { $set: { blocked: false } }
    );
  } catch (err) {
    console.error('[monitor] failed to persist unblockIp:', err.message);
  }
  return removed;
}

function listBlocked() {
  return [...state.blockedIps, ...state.blockedSubnets.keys()];
}

function recentLog(limit = 20) {
  return state.log.slice(-limit).reverse();
}

function todaysLog() {
  return [...state.log].reverse();
}

function topEndpoints(limit = 10) {
  return [...state.totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([path, count]) => ({ path, count }));
}

function topIps(limit = 10) {
  return [...state.perIp.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ip, count]) => ({ ip, count, blocked: isBlocked(ip) }));
}

function stats() {
  return {
    ready,
    today: {
      day: state.day,
      totalRequests: state.totalToday,
      blockedRequests: state.blockedToday,
      errors5xx: state.errors5xxToday
    },
    allTime: {
      totalRequests: state.totalAllTime,
      blockedRequests: state.blockedAllTime
    },
    blockedIpCount: state.blockedIps.size + state.blockedSubnets.size,
    uniqueVisitors: state.uniqueVisitors.size
  };
}

function totalRequests() {
  return state.totalAllTime;
}

async function flush() {
  const db = await getDb();
  if (!db) return;

  const totalDelta = state.pendingTotalDelta;
  const blockedDelta = state.pendingBlockedDelta;
  const dayTotalDelta = state.pendingDayTotalDelta;
  const dayBlockedDelta = state.pendingDayBlockedDelta;
  const day5xxDelta = state.pendingDay5xxDelta;
  const ipHits = state.pendingIpBlockHits;
  const newVisitors = state.pendingNewVisitors;

  if (
    totalDelta === 0 &&
    blockedDelta === 0 &&
    dayTotalDelta === 0 &&
    dayBlockedDelta === 0 &&
    day5xxDelta === 0 &&
    ipHits.size === 0 &&
    newVisitors.size === 0
  ) {
    return;
  }

  state.pendingTotalDelta = 0;
  state.pendingBlockedDelta = 0;
  state.pendingDayTotalDelta = 0;
  state.pendingDayBlockedDelta = 0;
  state.pendingDay5xxDelta = 0;
  state.pendingIpBlockHits = new Map();
  state.pendingNewVisitors = new Set();

  try {
    if (totalDelta !== 0 || blockedDelta !== 0) {
      await db.collection('stats_total').updateOne(
        { _id: 'totals' },
        { $inc: { total_requests: totalDelta, blocked_requests: blockedDelta } },
        { upsert: true }
      );
    }

    if (dayTotalDelta !== 0 || dayBlockedDelta !== 0 || day5xxDelta !== 0) {
      await db.collection('stats_daily').updateOne(
        { _id: state.day },
        {
          $inc: {
            total_requests: dayTotalDelta,
            blocked_requests: dayBlockedDelta,
            errors_5xx: day5xxDelta
          }
        },
        { upsert: true }
      );
    }

    for (const [ip, hits] of ipHits.entries()) {
      await db.collection('blocked_ips').updateOne(
        { ip },
        { $inc: { hit_count: hits }, $set: { last_hit_at: new Date() } },
        { upsert: true }
      );
    }

    if (newVisitors.size > 0) {
      const ops = [...newVisitors].map((ip) => ({
        updateOne: {
          filter: { ip },
          update: { $setOnInsert: { ip, first_seen_at: new Date() } },
          upsert: true
        }
      }));
      await db.collection('unique_visitors').bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    console.error('[monitor] flush to Mongo failed, re-queuing deltas:', err.message);
    state.pendingTotalDelta += totalDelta;
    state.pendingBlockedDelta += blockedDelta;
    state.pendingDayTotalDelta += dayTotalDelta;
    state.pendingDayBlockedDelta += dayBlockedDelta;
    state.pendingDay5xxDelta += day5xxDelta;
    for (const [ip, hits] of ipHits.entries()) {
      state.pendingIpBlockHits.set(ip, (state.pendingIpBlockHits.get(ip) || 0) + hits);
    }
    for (const ip of newVisitors) {
      state.pendingNewVisitors.add(ip);
    }
  }
}

let flushTimer = null;
function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  flushTimer.unref();
}

init().then(startFlushLoop);

process.on('SIGTERM', () => flush().finally(() => process.exit(0)));
process.on('SIGINT', () => flush().finally(() => process.exit(0)));

module.exports = {
  init,
  recordRequest,
  recordBlockedHit,
  recordVisit,
  uniqueVisitorCount,
  isBlocked,
  blockIp,
  unblockIp,
  listBlocked,
  recentLog,
  todaysLog,
  topEndpoints,
  topIps,
  totalRequests,
  stats
};
