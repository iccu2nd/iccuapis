'use strict';

const { getDb } = require('./mongoClient');

const MAX_LOG = 1000;
const MAX_PER_IP = 500;
const MAX_TOTALS = 300;
const FLUSH_INTERVAL_MS = 15_000;

function todayWIB() {
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function normalizeIp(ip) {
  if (!ip) return ip;
  let out = String(ip).trim();
  if (out.startsWith('::ffff:')) out = out.slice(7);
  if (out === '::1' || out === '127.0.0.1') out = '127.0.0.1';
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

function trimMap(map, max) {
  if (map.size <= max) return;
  const excess = map.size - max;
  let i = 0;
  for (const key of map.keys()) {
    if (i++ >= excess) break;
    map.delete(key);
  }
}

const state = {
  blockedIps: new Set(),
  blockedSubnets: new Map(),
  log: [],
  totals: new Map(),
  perIp: new Map(),
  uniqueVisitors: new Set(),
  uniqueVisitorCount: 0,

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
  pendingNewVisitors: new Set(),
  pendingLogEntries: []
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
      db.collection('request_log').createIndex({ day: 1, at: -1 })
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

    // Count only — avoid loading every visitor IP into RAM
    state.uniqueVisitorCount = await db.collection('unique_visitors').countDocuments();

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
      .sort({ at: -1 })
      .limit(MAX_LOG)
      .project({ _id: 0 })
      .toArray();
    // Keep chronological order (oldest first) for push/shift ring buffer
    state.log = todaysEntries.reverse();

    // Drop old days in background — don't block init
    db.collection('request_log').deleteMany({ day: { $ne: day } })
      .catch((err) => console.error('[monitor] purge old logs:', err.message));

    console.log(
      `[monitor] hydrated from Mongo: ${state.blockedIps.size} blocked IP(s), ` +
      `${state.uniqueVisitorCount} unique visitor(s), ${state.totalAllTime} total requests all-time, ` +
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
  trimMap(state.totals, MAX_TOTALS);
  trimMap(state.perIp, MAX_PER_IP);

  state.totalAllTime += 1;
  state.totalToday += 1;
  state.pendingTotalDelta += 1;
  state.pendingDayTotalDelta += 1;

  if (status >= 500) {
    state.errors5xxToday += 1;
    state.pendingDay5xxDelta += 1;
  }

  // Batch inserts — flushed periodically instead of insertOne per request
  state.pendingLogEntries.push(entry);
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
  state.uniqueVisitorCount += 1;
  state.pendingNewVisitors.add(ip);

  // Bound session dedup set so RAM stays stable under heavy traffic
  if (state.uniqueVisitors.size > 50_000) {
    const iter = state.uniqueVisitors.values();
    for (let i = 0; i < 5_000; i++) {
      const v = iter.next().value;
      if (v === undefined) break;
      state.uniqueVisitors.delete(v);
    }
  }
  return true;
}

function uniqueVisitorCount() {
  return state.uniqueVisitorCount;
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
  const len = state.log.length;
  if (limit >= len) return state.log.slice().reverse();
  return state.log.slice(len - limit).reverse();
}

function todaysLog() {
  return state.log.slice().reverse();
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
    uniqueVisitors: state.uniqueVisitorCount
  };
}

function totalRequests() {
  return state.totalAllTime;
}

async function flush() {
  const db = await getDb();
  if (!db) {
    state.pendingLogEntries = [];
    return;
  }

  const totalDelta = state.pendingTotalDelta;
  const blockedDelta = state.pendingBlockedDelta;
  const dayTotalDelta = state.pendingDayTotalDelta;
  const dayBlockedDelta = state.pendingDayBlockedDelta;
  const day5xxDelta = state.pendingDay5xxDelta;
  const ipHits = state.pendingIpBlockHits;
  const newVisitors = state.pendingNewVisitors;
  const logEntries = state.pendingLogEntries;

  if (
    totalDelta === 0 &&
    blockedDelta === 0 &&
    dayTotalDelta === 0 &&
    dayBlockedDelta === 0 &&
    day5xxDelta === 0 &&
    ipHits.size === 0 &&
    newVisitors.size === 0 &&
    logEntries.length === 0
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
  state.pendingLogEntries = [];

  try {
    const ops = [];

    if (totalDelta !== 0 || blockedDelta !== 0) {
      ops.push(
        db.collection('stats_total').updateOne(
          { _id: 'totals' },
          { $inc: { total_requests: totalDelta, blocked_requests: blockedDelta } },
          { upsert: true }
        )
      );
    }

    if (dayTotalDelta !== 0 || dayBlockedDelta !== 0 || day5xxDelta !== 0) {
      ops.push(
        db.collection('stats_daily').updateOne(
          { _id: state.day },
          {
            $inc: {
              total_requests: dayTotalDelta,
              blocked_requests: dayBlockedDelta,
              errors_5xx: day5xxDelta
            }
          },
          { upsert: true }
        )
      );
    }

    if (logEntries.length > 0) {
      ops.push(db.collection('request_log').insertMany(logEntries, { ordered: false }));
    }

    if (newVisitors.size > 0) {
      const visitorOps = [...newVisitors].map((ip) => ({
        updateOne: {
          filter: { ip },
          update: { $setOnInsert: { ip, first_seen_at: new Date() } },
          upsert: true
        }
      }));
      ops.push(db.collection('unique_visitors').bulkWrite(visitorOps, { ordered: false }));
    }

    if (ipHits.size > 0) {
      const hitOps = [...ipHits.entries()].map(([ip, hits]) => ({
        updateOne: {
          filter: { ip },
          update: { $inc: { hit_count: hits }, $set: { last_hit_at: new Date() } },
          upsert: true
        }
      }));
      ops.push(db.collection('blocked_ips').bulkWrite(hitOps, { ordered: false }));
    }

    await Promise.all(ops);
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
    // Re-queue log entries (cap to avoid unbounded growth on prolonged outage)
    if (logEntries.length) {
      state.pendingLogEntries = logEntries.concat(state.pendingLogEntries).slice(-MAX_LOG);
    }
  }
}

let flushTimer = null;
function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(flush, FLUSH_INTERVAL_MS);
  if (flushTimer.unref) flushTimer.unref();
}

init().then(startFlushLoop);

process.on('SIGTERM', () => flush());
process.on('SIGINT', () => flush());

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
  stats,
  flush
};
