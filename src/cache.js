'use strict';

const store = new Map();

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

module.exports = { get, set, wrap, size };
