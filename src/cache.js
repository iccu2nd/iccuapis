'use strict';

const store = new Map();
const MAX_ENTRIES = 500;
const SWEEP_INTERVAL_MS = 60_000;

function get(key) {
  const entry = store.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    store.delete(key);
    return null;
  }
  return entry.data;
}

function set(key, data, ttlMs) {
  if (store.size >= MAX_ENTRIES && !store.has(key)) {
    // Evict oldest expired first, otherwise first key
    const now = Date.now();
    let evicted = false;
    for (const [k, v] of store) {
      if (now > v.expiresAt) {
        store.delete(k);
        evicted = true;
        break;
      }
    }
    if (!evicted && store.size >= MAX_ENTRIES) {
      const first = store.keys().next().value;
      if (first !== undefined) store.delete(first);
    }
  }
  store.set(key, { data, expiresAt: Date.now() + ttlMs });
}

function wrap(key, ttlMs, fn) {
  const cached = get(key);
  if (cached !== null) return Promise.resolve(cached);
  return Promise.resolve(fn()).then((data) => {
    set(key, data, ttlMs);
    return data;
  });
}

function size() {
  return store.size;
}

function sweep() {
  const now = Date.now();
  for (const [k, v] of store) {
    if (now > v.expiresAt) store.delete(k);
  }
}

const sweepTimer = setInterval(sweep, SWEEP_INTERVAL_MS);
if (sweepTimer.unref) sweepTimer.unref();

module.exports = { get, set, wrap, size };
