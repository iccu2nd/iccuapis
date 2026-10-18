'use strict';

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

async function getDb() {
  if (!uri) return null;
  if (db) return db;

  if (!connectingPromise) {
    connectingPromise = (async () => {
      try {
        const { MongoClient } = require('mongodb');
        const c = await MongoClient.connect(uri, {
          serverSelectionTimeoutMS: 5000,
          maxPoolSize: 8,
          minPoolSize: 0,
          maxIdleTimeMS: 30_000
        });
        client = c;
        db = client.db(dbName);
        console.log(`[mongo] connected to database "${dbName}"`);
        return db;
      } catch (err) {
        console.error('[mongo] connection failed:', err.message);
        connectingPromise = null;
        return null;
      }
    })();
  }

  return connectingPromise;
}

function close() {
  if (client) {
    const c = client;
    client = null;
    db = null;
    connectingPromise = null;
    return c.close().catch(() => {});
  }
  return Promise.resolve();
}

process.on('SIGTERM', () => { close(); });
process.on('SIGINT', () => { close(); });

module.exports = { getDb, close };
