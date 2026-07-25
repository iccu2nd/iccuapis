'use strict';

const vm = require('vm');
const path = require('path');
const Module = require('module');
const { execFile } = require('child_process');

const PROJECT_ROOT = path.join(__dirname, '..');
const RUN_TIMEOUT_MS = 20000;
const INSTALL_TIMEOUT_MS = 45000;

const projectRequire = Module.createRequire(path.join(PROJECT_ROOT, 'package.json'));

function extractRequiredModules(code) {
  const found = new Set();
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(code))) {
    const name = match[1];
    if (name.startsWith('.') || name.startsWith('/')) continue;
    const parts = name.split('/');
    const pkg = name.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
    found.add(pkg);
  }
  return [...found];
}

function isBuiltin(name) {
  return Module.builtinModules.includes(name) || name.startsWith('node:');
}

function isAlreadyAvailable(name) {
  try {
    projectRequire.resolve(name);
    return true;
  } catch (err) {
    return false;
  }
}

function npmInstall(names) {
  return new Promise((resolve, reject) => {
    execFile(
      'npm',
      ['install', '--no-save', '--no-audit', '--no-fund', ...names],
      { cwd: PROJECT_ROOT, timeout: INSTALL_TIMEOUT_MS },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(`Gagal install ${names.join(', ')}: ${(stderr || err.message).trim()}`));
        resolve();
      }
    );
  });
}

function npmUninstall(names) {
  return new Promise((resolve) => {
    execFile(
      'npm',
      ['uninstall', '--no-save', ...names],
      { cwd: PROJECT_ROOT, timeout: INSTALL_TIMEOUT_MS },
      (err) => {
        if (err) console.error('[scraper-test] gagal bersihin module sementara:', err.message);
        resolve();
      }
    );
  });
}

function buildSandbox() {
  const sandboxModule = { exports: {} };
  const sandbox = {
    module: sandboxModule,
    exports: sandboxModule.exports,
    require(name) {
      if (isBuiltin(name)) return require(name);
      try {
        return projectRequire(name);
      } catch (err) {
        throw new Error(`require('${name}') gagal dimuat.`);
      }
    },
    console,
    Buffer,
    fetch: globalThis.fetch,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    process: { env: {} }
  };
  vm.createContext(sandbox);
  return sandbox;
}

function pickEntryPoint(mod, fnName) {
  let target = mod;
  if (typeof target === 'function') {
    try {
      target = new target();
    } catch (err) {
      target = mod;
    }
  }

  const candidates = fnName ? [fnName] : ['downloadDirect', 'search', 'run'];
  for (const name of candidates) {
    if (target && typeof target[name] === 'function') {
      return { target, usedFn: name };
    }
  }
  return { target: null, usedFn: null };
}

async function executeTest({ code, input, fnName }) {
  const sandbox = buildSandbox();
  const script = new vm.Script(code, { filename: 'scraper-test.js' });
  script.runInContext(sandbox, { timeout: 3000 });

  const mod = sandbox.module.exports;
  const { target, usedFn } = pickEntryPoint(mod, fnName || undefined);

  if (!target || !usedFn) {
    throw new Error(
      'Tidak ketemu fungsi buat dijalankan (dicoba: downloadDirect/search/run). Isi nama fungsi manual kalau nama fungsimu beda.'
    );
  }

  const call = target[usedFn](input);
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error(`Timeout setelah ${RUN_TIMEOUT_MS / 1000}s`)), RUN_TIMEOUT_MS);
  });

  const output = await Promise.race([Promise.resolve(call), timeout]);
  return { usedFunction: usedFn, output };
}

let queue = Promise.resolve();
function runExclusive(fn) {
  const result = queue.then(fn, fn);
  queue = result.then(() => {}, () => {});
  return result;
}

async function runScraperTest({ code, input, fnName }) {
  if (typeof code !== 'string' || !code.trim()) {
    throw new Error('Kode scraper kosong.');
  }

  return runExclusive(async () => {
    const required = extractRequiredModules(code).filter((name) => !isBuiltin(name));
    const missing = required.filter((name) => !isAlreadyAvailable(name));

    if (missing.length > 0) {
      await npmInstall(missing);
    }

    try {
      const result = await executeTest({ code, input, fnName });
      return { ...result, installedModules: missing };
    } finally {
      if (missing.length > 0) {
        await npmUninstall(missing);
      }
    }
  });
}

module.exports = { runScraperTest };
