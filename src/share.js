'use strict';

const crypto = require('crypto');
const { getDb } = require('./mongoClient');

const memoryStore = new Map();
const MAX_CODE_BYTES = 300 * 1024;
const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const genId = () => crypto.randomBytes(6).toString('base64url');
const genToken = () => crypto.randomBytes(16).toString('base64url');

let indexEnsured = false;
async function ensureIndex(db) {
  if (indexEnsured) return;
  indexEnsured = true;
  await db.collection('shared_codes').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
}

setInterval(() => {
  const now = Date.now();
  for (const [id, doc] of memoryStore) {
    if (doc.expiresAt.getTime() <= now) memoryStore.delete(id);
  }
}, 60 * 60 * 1000);

async function saveSnippet(doc) {
  const db = await getDb();
  if (db) {
    await ensureIndex(db);
    return void await db.collection('shared_codes').insertOne(doc);
  }
  memoryStore.set(doc._id, doc);
}

async function loadSnippet(id) {
  const db = await getDb();
  if (db) return db.collection('shared_codes').findOne({ _id: id });
  return memoryStore.get(id) || null;
}

async function loadAndCountView(id) {
  const db = await getDb();
  if (db) {
    const doc = await db.collection('shared_codes').findOneAndUpdate(
      { _id: id },
      { $inc: { views: 1 } },
      { returnDocument: 'after' }
    );
    return doc?.value || doc || null;
  }
  const doc = memoryStore.get(id);
  if (!doc) return null;
  doc.views = (doc.views || 0) + 1;
  return doc;
}

async function listSnippets(limit) {
  const db = await getDb();
  if (db) {
    return db.collection('shared_codes')
      .find({}, { projection: { code: 0, deleteToken: 0 } })
      .sort({ createdAt: -1 })
      .limit(limit)
      .toArray();
  }
  return Array.from(memoryStore.values())
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(({ code, deleteToken, ...rest }) => rest);
}

async function deleteSnippet(id, token) {
  const doc = await loadSnippet(id);
  if (!doc) return { ok: false, status: 404, message: 'Kode tidak ditemukan.' };
  if (doc.deleteToken !== token) return { ok: false, status: 403, message: 'Token hapus tidak valid.' };

  const db = await getDb();
  if (db) await db.collection('shared_codes').deleteOne({ _id: id });
  else memoryStore.delete(id);

  return { ok: true };
}

module.exports = function registerShareRoutes(app) {
  app.post('/api/share', async (req, res) => {
    const { code, filename, language, description } = req.body || {};

    if (!code || !code.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_CODE', message: 'Field "code" wajib diisi.' }
      });
    }

    if (Buffer.byteLength(code, 'utf8') > MAX_CODE_BYTES) {
      return res.status(413).json({
        ok: false,
        error: { code: 'TOO_LARGE', message: `Kode maksimal ${MAX_CODE_BYTES / 1024}KB.` }
      });
    }

    const id = genId();
    const deleteToken = genToken();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + EXPIRY_MS);

    await saveSnippet({
      _id: id,
      code,
      filename: (filename || '').trim().slice(0, 120) || null,
      language: (language || '').trim().slice(0, 40) || null,
      description: (description || '').trim().slice(0, 300) || null,
      views: 0,
      deleteToken,
      createdAt,
      expiresAt
    });

    const base = `${req.protocol}://${req.get('host')}`;
    res.json({
      result: {
        id,
        viewUrl: `${base}/view/${id}`,
        rawUrl: `${base}/raw/${id}`,
        deleteToken,
        expiresAt
      }
    });
  });

  app.get('/api/share', async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 50, 100);
    const docs = await listSnippets(limit);
    res.json({
      result: docs.map((d) => ({
        id: d._id,
        filename: d.filename,
        language: d.language,
        description: d.description,
        views: d.views || 0,
        createdAt: d.createdAt,
        expiresAt: d.expiresAt
      }))
    });
  });

  app.get('/api/share/:id', async (req, res) => {
    const doc = await loadAndCountView(req.params.id);
    if (!doc) {
      return res.status(404).json({
        ok: false,
        error: { code: 'NOT_FOUND', message: 'Kode tidak ditemukan atau sudah dihapus.' }
      });
    }
    res.json({
      result: {
        id: doc._id,
        code: doc.code,
        filename: doc.filename,
        language: doc.language,
        description: doc.description,
        views: doc.views || 0,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt
      }
    });
  });

  app.delete('/api/share/:id', async (req, res) => {
    const token = req.header('x-delete-token') || req.query.token;
    if (!token) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_TOKEN', message: 'Token hapus wajib disertakan.' }
      });
    }

    const result = await deleteSnippet(req.params.id, token);
    if (!result.ok) {
      return res.status(result.status).json({
        ok: false,
        error: { code: result.status === 404 ? 'NOT_FOUND' : 'FORBIDDEN', message: result.message }
      });
    }
    res.json({ result: { deleted: true } });
  });

  app.get('/raw/:id', async (req, res) => {
    const doc = await loadSnippet(req.params.id);
    if (!doc) return res.status(404).type('text/plain; charset=utf-8').send('Not found');
    res.type('text/plain; charset=utf-8').send(doc.code);
  });
};
