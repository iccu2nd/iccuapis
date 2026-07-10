'use strict';

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'mydb';

let client = null;
let db = null;
let connectingPromise = null;

if (!uri) {
  console.warn(
    '[mongo] MONGODB_URI not set — stats, blocklist, and unique visitors ' +
    'will run in-memory only and will NOT survive a redeploy.'
  );
}

// Lazily connect on first use and reuse the same connection/db handle
// afterwards. Returns null if MONGODB_URI isn't configured, or if the
// connection attempt fails (callers already treat a null db as "in-memory
// only" the same way they treated a missing Supabase client).
async function getDb() {
  if (!uri) return null;
  if (db) return db;

  if (!connectingPromise) {
    connectingPromise = MongoClient.connect(uri, {
      serverSelectionTimeoutMS: 8000
    })
      .then((c) => {
        client = c;
        db = client.db(dbName);
        console.log(`[mongo] connected to database "${dbName}"`);
        return db;
      })
      .catch((err) => {
        console.error('[mongo] connection failed:', err.message);
        connectingPromise = null; // allow a retry on the next call
        return null;
      });
  }

  return connectingPromise;
}

process.on('SIGTERM', () => client && client.close());
process.on('SIGINT', () => client && client.close());

module.exports = { getDb };
