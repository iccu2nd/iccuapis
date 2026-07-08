'use strict';

const { getDb } = require('./mongoClient');

const MAX_LOG = 2000;
const FLUSH_INTERVAL_MS = 15_000; // batch-write to Mongo every 15s

function todayWIB() {
  // Asia/Jakarta has no DST, so a fixed +7h offset is safe and avoids
  // pulling in a full timezone library just for day-boundary math.
  const wib = new Date(Date.now() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10); // 'YYYY-MM-DD' in WIB
}

// Normalize IP so the same address always compares equal, regardless of
// which representation Express/Node handed us (IPv6-mapped IPv4, loopback
// variants, stray whitespace, etc). Without this, blocking "114.10.20.30"
// would never match an incoming request logged as "::ffff:114.10.20.30".
function normalizeIp(ip) {
  if (!ip) return ip;
  let out = String(ip).trim();

  // Strip the IPv6-mapped IPv4 prefix: "::ffff:1.2.3.4" -> "1.2.3.4"
  if (out.startsWith('::ffff:')) {
    out = out.slice(7);
  }

  // Normalize both IPv6 and IPv4 loopback to a single canonical form.
  if (out === '::1' || out === '127.0.0.1') {
    out = '127.0.0.1';
  }

  return out.toLowerCase();
}

// ---- in-memory state (fast path, always authoritative for "right now") ----
const state = {
  blockedIps: new Set(),
  log: [],
  totals: new Map(),   // path -> count
  perIp: new Map(),     // ip -> count
  uniqueVisitors: new Set(), // ip -> ever visited (permanent, 1 IP counted once)

  // running totals, kept in memory and periodically flushed
  totalAllTime: 0,
  blockedAllTime: 0,
  day: todayWIB(),
  totalToday: 0,
  blockedToday: 0,
  errors5xxToday: 0,

  // dirty deltas waiting to be flushed to Mongo
  pendingTotalDelta: 0,
  pendingBlockedDelta: 0,
  pendingDayTotalDelta: 0,
  pendingDayBlockedDelta: 0,
  pendingDay5xxDelta: 0,
  pendingIpBlockHits: new Map(), // ip -> count of blocked hits since last flush
  pendingNewVisitors: new Set()  // ip -> newly-seen visitors not yet persisted
};

let ready = false;

// ---- startup: hydrate memory from Mongo so restarts don't lose data ----
async function init() {
  const db = await getDb();
  if (!db) {
    ready = true;
    return;
  }

  try {
    await Promise.all([
      db.collection('blocked_ips').createIndex({ ip: 1 }, { unique: true }),
      db.collection('unique_visitors').createIndex({ ip: 1 }, { unique: true })
    ]);

    const blocked = await db.collection('blocked_ips')
      .find({ blocked: true })
      .project({ ip: 1 })
      .toArray();
    blocked.forEach((row) => state.blockedIps.add(normalizeIp(row.ip)));

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

    console.log(
      `[monitor] hydrated from Mongo: ${state.blockedIps.size} blocked IP(s), ` +
      `${state.uniqueVisitors.size} unique visitor(s), ${state.totalAllTime} total requests all-time`
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
    // flush whatever is pending for the old day before resetting
    flush().finally(() => {
      state.day = day;
      state.totalToday = 0;
      state.blockedToday = 0;
      state.errors5xxToday = 0;
      state.log = []; // request log is a same-day-only view, wiped at WIB midnight
    });
  }
}

function recordRequest({ ip, method, path, status, ms }) {
  rolloverDayIfNeeded();
  ip = normalizeIp(ip);

  const entry = { ip, method, path, status, ms, at: new Date().toISOString() };
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
}

// Called from the "blocked" middleware path — a request that never even
// reaches the normal recordRequest handler because it was rejected outright.
function recordBlockedHit(ip) {
  rolloverDayIfNeeded();
  ip = normalizeIp(ip);

  state.blockedAllTime += 1;
  state.blockedToday += 1;
  state.pendingBlockedDelta += 1;
  state.pendingDayBlockedDelta += 1;
  state.pendingIpBlockHits.set(ip, (state.pendingIpBlockHits.get(ip) || 0) + 1);
}

// Called once per page load (from GET / only, not from every API hit).
// Returns true if this IP is being counted for the first time ever.
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
  return state.blockedIps.has(normalizeIp(ip));
}

async function blockIp(ip) {
  ip = normalizeIp(ip);
  state.blockedIps.add(ip);

  const db = await getDb();
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

async function unblockIp(ip) {
  ip = normalizeIp(ip);
  const removed = state.blockedIps.delete(ip);

  const db = await getDb();
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
  return [...state.blockedIps];
}

function recentLog(limit = 20) {
  return state.log.slice(-limit).reverse();
}

// Full same-day log for the Request Log page — newest first, capped at
// MAX_LOG entries (older entries are already dropped from state.log).
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

// Real-time snapshot — always served from memory, never blocks on a DB call.
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
    blockedIpCount: state.blockedIps.size,
    uniqueVisitors: state.uniqueVisitors.size
  };
}

function totalRequests() {
  return state.totalAllTime;
}

// ---- periodic flush: push accumulated deltas to Mongo in batches ----
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
    return; // nothing to do, skip the round trip
  }

  // reset pending counters immediately so new requests accumulate fresh deltas
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
      // setOnInsert + upsert: if two instances raced and both saw the same
      // IP as "new" before either flushed, the second upsert just matches
      // the existing doc and no-ops instead of erroring, so the permanent
      // 1-IP-forever count holds.
      await db.collection('unique_visitors').bulkWrite(ops, { ordered: false });
    }
  } catch (err) {
    console.error('[monitor] flush to Mongo failed, re-queuing deltas:', err.message);
    // put the deltas back so we retry on the next tick instead of losing them
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
  flushTimer.unref(); // don't keep the process alive just for this
}

// kick things off
init().then(startFlushLoop);

// best-effort flush on shutdown so the last few seconds aren't lost
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
