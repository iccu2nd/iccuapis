'use strict';

const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { spawn } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const TMP_DIR = path.join(PROJECT_ROOT, '.scraper-test-tmp');
const RUN_TIMEOUT_MS = 20000;
const MAX_OUTPUT_CHARS = 200000;
const MAX_CODE_LENGTH = 60000;

async function ensureTmpDir() {
  await fs.mkdir(TMP_DIR, { recursive: true });
}

function getConfiguredKey() {
  return process.env.SCRAPER_TEST_KEY || '';
}

function keyMatches(provided) {
  const expected = getConfiguredKey();
  if (!expected) return false;
  if (typeof provided !== 'string' || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function getProvidedKey(req) {
  return req.headers['x-scraper-key'] || (req.body && req.body.key) || '';
}

async function runCode(code, input) {
  await ensureTmpDir();
  const fileName = `run-${Date.now()}-${crypto.randomBytes(6).toString('hex')}.js`;
  const filePath = path.join(TMP_DIR, fileName);
  await fs.writeFile(filePath, code, 'utf8');

  const startedAt = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const finish = async (payload) => {
      if (settled) return;
      settled = true;
      await fs.unlink(filePath).catch(() => {});
      resolve(payload);
    };

    let child;
    try {
      child = spawn(process.execPath, [filePath, input || ''], {
        cwd: PROJECT_ROOT,
        env: { ...process.env, NODE_ENV: 'production' },
        timeout: RUN_TIMEOUT_MS
      });
    } catch (err) {
      finish({ stdout: '', stderr: err.message, exitCode: -1, timedOut: false, tookMs: 0 });
      return;
    }

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      if (stdout.length < MAX_OUTPUT_CHARS) stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      if (stderr.length < MAX_OUTPUT_CHARS) stderr += chunk.toString();
    });

    child.on('close', (exitCode, signal) => {
      const tookMs = Date.now() - startedAt;
      finish({
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode,
        timedOut: signal === 'SIGTERM' && tookMs >= RUN_TIMEOUT_MS - 500,
        tookMs
      });
    });

    child.on('error', (err) => {
      finish({
        stdout: stdout.trim(),
        stderr: (stderr + '\n' + err.message).trim(),
        exitCode: -1,
        timedOut: false,
        tookMs: Date.now() - startedAt
      });
    });
  });
}

module.exports = function registerScraperTest(app) {
  app.post('/api/scraper-test/auth', (req, res) => {
    if (!getConfiguredKey()) {
      return res.status(500).json({
        ok: false,
        error: { code: 'NOT_CONFIGURED', message: 'SCRAPER_TEST_KEY belum diatur di environment server.' }
      });
    }
    const provided = req.body && req.body.key;
    if (!keyMatches(provided)) {
      return res.status(401).json({
        ok: false,
        error: { code: 'INVALID_KEY', message: 'Key salah atau kosong.' }
      });
    }
    res.json({ result: { verified: true } });
  });

  app.post('/api/scraper-test/run', async (req, res) => {
    if (!keyMatches(getProvidedKey(req))) {
      return res.status(401).json({
        ok: false,
        error: { code: 'UNAUTHORIZED', message: 'Key tidak valid. Verifikasi ulang key kamu.' }
      });
    }

    const { code, input } = req.body || {};
    if (!code || typeof code !== 'string' || !code.trim()) {
      return res.status(400).json({
        ok: false,
        error: { code: 'MISSING_CODE', message: 'Kode scraping masih kosong.' }
      });
    }
    if (code.length > MAX_CODE_LENGTH) {
      return res.status(400).json({
        ok: false,
        error: { code: 'CODE_TOO_LONG', message: `Kode maksimal ${MAX_CODE_LENGTH} karakter.` }
      });
    }

    try {
      const result = await runCode(code, typeof input === 'string' ? input : '');
      res.json({ result });
    } catch (err) {
      res.status(500).json({
        ok: false,
        error: { code: 'RUN_FAILED', message: err.message || 'Gagal menjalankan kode.' }
      });
    }
  });
};
