(() => {
  'use strict';

  const el = (id) => document.getElementById(id);


  const rowTemplate = el('routeRowTemplate');
  const logEl = el('log');
  const bootLoader = el('bootLoader');
  const contentStack = el('contentStack');
  const filterInput = el('filterInput');
  const groupFilterBtn = el('groupFilterBtn');
  const groupFilterPanel = el('groupFilterPanel');
  const copyBaseBtn = el('copyBaseBtn');

  const rowRevealObserver = null;

  let manifest = null;
  let routes = [];
  let selectedGroup = null;

  function groupLabel(key) {
    return manifest.groups?.[key]?.label || key;
  }

  function groupOrder(key) {
    return manifest.groups?.[key]?.order ?? 99;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function extFromMime(mime) {
    const map = {
      'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
      'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
      'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov'
    };
    return map[mime] || 'bin';
  }

  async function copyText(text, btn) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (err) {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (btn) {
      const original = btn.innerHTML;
      const labelSpan = btn.querySelector('span:not(.icon-copy)');
      btn.classList.add('copied');
      if (labelSpan) {
        labelSpan.textContent = 'Tersalin!';
      } else {
        btn.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none"><path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      }
      setTimeout(() => {
        btn.classList.remove('copied');
        btn.innerHTML = original;
      }, 1600);
    }
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function fetchJsonWithRetry(url, attempts = 2, backoffMs = 300) {
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        if (i < attempts - 1) await delay(backoffMs * (i + 1));
      }
    }
    throw lastErr;
  }

  async function loadStats() {
    const viewsRes = await fetchJsonWithRetry('/api/views').catch(() => null);

    if (viewsRes && viewsRes.result) {
      el('viewCount').textContent = viewsRes.result.totalViews.toLocaleString('id-ID');
    } else {
      el('viewCount').textContent = '—';
    }
    el('viewCount').classList.remove('is-loading');
  }

  async function loadData() {
    const CACHE_KEY = 'rezora_routes_v1';
    const CACHE_TTL = 3 * 60 * 1000;
    let manifestRes, routesRes;
    try {
      const raw = sessionStorage.getItem(CACHE_KEY);
      if (raw) {
        const c = JSON.parse(raw);
        if (c && Date.now() - c.t < CACHE_TTL && c.manifest && Array.isArray(c.routes)) {
          manifestRes = { result: c.manifest };
          routesRes = { result: c.routes };
        }
      }
    } catch (_) {}

    if (!manifestRes || !routesRes) {
      [manifestRes, routesRes] = await Promise.all([
        fetchJsonWithRetry('/manifest.json'),
        fetchJsonWithRetry('/api/routes')
      ]);
      try {
        sessionStorage.setItem(CACHE_KEY, JSON.stringify({
          t: Date.now(),
          manifest: manifestRes.result,
          routes: routesRes.result
        }));
      } catch (_) {}
    }

    manifest = manifestRes.result;
    routes = routesRes.result;

    el('tagline').textContent = manifest.identity.tagline;
    el('routeCount').textContent = routes.length;
    el('routeCount').classList.remove('is-loading');
    el('routeCountLabel').classList.remove('is-loading');
    el('baseUrl').textContent = window.location.origin;
    document.title = manifest.identity.name;

    renderLog();
  }

  function showBootError() {
    logEl.innerHTML = `
      <div class="empty-state boot-error">
        <p>Gagal memuat endpoint. Koneksi ke server mungkin lambat atau terputus.</p>
        <button type="button" class="retry-btn" id="retryBootBtn">Coba lagi</button>
      </div>`;
    logEl.hidden = false;
    filterInput.disabled = true;
    filterInput.placeholder = 'Pencarian tidak tersedia (gagal memuat data)';

    const retryBtn = el('retryBootBtn');
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        retryBtn.disabled = true;
        retryBtn.textContent = 'Memuat...';
        boot();
      });
    }
  }

  function hideSkeleton() {
    bootLoader.classList.add('is-leaving');
    setTimeout(() => {
      bootLoader.hidden = true;
      requestAnimationFrame(() => logEl.classList.add('is-visible'));
    }, 350);
  }

  async function boot() {
    bootLoader.hidden = false;
    bootLoader.classList.remove('is-leaving');
    logEl.hidden = true;
    logEl.classList.remove('is-visible');
    try {
      await loadData();
      filterInput.disabled = false;
      filterInput.placeholder = 'Cari nama atau path endpoint...';
      hideSkeleton();
      applyQueryFilter();
    } catch (err) {
      hideSkeleton();
      showBootError();
    }
  }

  function applyQueryFilter() {
    const q = new URLSearchParams(window.location.search).get('q');
    if (!q) return;
    filterInput.value = q;
    renderLog();
  }

  function renderLog() {
    logEl.hidden = false;
    if (rowRevealObserver) rowRevealObserver.disconnect();
    const term = filterInput.value.trim().toLowerCase();
    logEl.innerHTML = '';

    const groups = [...new Set(routes.map((r) => r.group))].sort(
      (a, b) => groupOrder(a) - groupOrder(b)
    );

    groups.forEach((g) => {
      if (selectedGroup && g !== selectedGroup) return;
      const items = routes.filter((r) => {
        if (r.group !== g) return false;
        if (term && !(r.name.toLowerCase().includes(term) || r.path.toLowerCase().includes(term))) {
          return false;
        }
        return true;
      });

      if (!items.length) return;

      items.forEach((route) => {
        const row = buildRow(route);
        logEl.appendChild(row);
        if (rowRevealObserver) {
          rowRevealObserver.observe(row);
        } else {
          row.classList.add('is-inview');
        }
      });
    });

    if (!logEl.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Tidak ada endpoint yang cocok dengan pencarian itu.';
      logEl.appendChild(empty);
    }

    if (groupFilterBtn) groupFilterBtn.classList.toggle('is-active', selectedGroup !== null);
  }

  function renderGroupFilterPanel() {
    if (!groupFilterPanel) return;
    const groups = [...new Set(routes.map((r) => r.group))].sort(
      (a, b) => groupOrder(a) - groupOrder(b)
    );

    groupFilterPanel.innerHTML = '';

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'group-filter-option' + (selectedGroup === null ? ' is-selected' : '');
    allBtn.innerHTML = `<span>Semua</span><span class="count">${routes.length}</span>`;
    allBtn.addEventListener('click', () => {
      selectedGroup = null;
      closeGroupFilterPanel();
      renderLog();
    });
    groupFilterPanel.appendChild(allBtn);

    groups.forEach((g) => {
      const count = routes.filter((r) => r.group === g).length;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'group-filter-option' + (selectedGroup === g ? ' is-selected' : '');
      btn.innerHTML = `<span>${groupLabel(g)}</span><span class="count">${count}</span>`;
      btn.addEventListener('click', () => {
        selectedGroup = g;
        closeGroupFilterPanel();
        renderLog();
      });
      groupFilterPanel.appendChild(btn);
    });

    groupFilterBtn.classList.toggle('is-active', selectedGroup !== null);
  }

  function closeGroupFilterPanel() {
    if (!groupFilterPanel) return;
    groupFilterPanel.hidden = true;
    groupFilterBtn.setAttribute('aria-expanded', 'false');
  }

  if (groupFilterBtn && groupFilterPanel) {
    groupFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = groupFilterPanel.hidden;
      if (willOpen) renderGroupFilterPanel();
      groupFilterPanel.hidden = !willOpen;
      groupFilterBtn.setAttribute('aria-expanded', String(willOpen));
    });
    document.addEventListener('click', (e) => {
      if (!groupFilterPanel.hidden && !groupFilterPanel.contains(e.target) && e.target !== groupFilterBtn) {
        closeGroupFilterPanel();
      }
    });
  }

  function sampleFor(param) {
    if (param.example) return param.example;
    return '';
  }

  function buildRow(route) {
    const node = rowTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.verb').textContent = route.method;
    node.querySelector('.verb').classList.add('verb-' + String(route.method || '').toLowerCase());
    node.querySelector('.path').textContent = route.path;
    node.querySelector('.name').textContent = route.name;
    node.querySelector('.desc').textContent = route.description;

    const fieldsEl = node.querySelector('.fields');
    const runBtn = node.querySelector('.run-btn');
    const clearBtn = node.querySelector('.clear-btn');
    const autofillBtn = node.querySelector('.autofill-btn');
    const endpointBox = node.querySelector('.endpoint-box');
    const builtUrl = node.querySelector('.built-url');
    const copyEndpointBtn = node.querySelector('.copy-endpoint-btn');
    const resultBox = node.querySelector('.result');
    const resultLoading = node.querySelector('.result-loading');
    const resultHead = node.querySelector('.result-head');
    const resultStatus = node.querySelector('.result-status');
    const resultTime = node.querySelector('.result-time');
    const resultSize = node.querySelector('.result-size');
    const copyResultBtn = node.querySelector('.copy-result-btn');
    const copyLabel = node.querySelector('.copy-label');
    let resultIcon = node.querySelector('.icon-copy-result');
    const resultJson = node.querySelector('.result-json');
    const resultImage = node.querySelector('.result-image');
    const resultAudio = node.querySelector('.result-audio');
    const resultVideo = node.querySelector('.result-video');

    let lastResultText = '';
    let lastResultBlob = null;
    let currentUrl = '';

    function updateBuiltUrl() {
      const inputs = [...fieldsEl.querySelectorAll('input, select')];
      const query = new URLSearchParams();
      inputs.forEach((input) => {
        const val = input.value.trim();
        if (val) query.set(input.dataset.key, val);
      });
      const qs = query.toString();
      currentUrl = `${window.location.origin}${route.path}${qs ? `?${qs}` : ''}`;
      builtUrl.textContent = currentUrl;
    }

    route.params.forEach((param) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';
      wrap.innerHTML = `<label for="p-${route.path}-${param.key}">${param.key}${param.required ? '' : ' (opsional)'}</label>`;

      let input;
      if (Array.isArray(param.options) && param.options.length) {
        input = document.createElement('select');
        input.id = `p-${route.path}-${param.key}`;
        input.dataset.key = param.key;
        input.dataset.required = param.required ? '1' : '0';

        param.options.forEach((opt) => {
          const optionEl = document.createElement('option');
          optionEl.value = opt;
          optionEl.textContent = opt;
          if (opt === param.example) optionEl.selected = true;
          input.appendChild(optionEl);
        });

        input.addEventListener('change', () => {
          input.classList.remove('invalid');
          updateBuiltUrl();
        });
      } else {
        input = document.createElement('input');
        input.type = 'text';
        input.id = `p-${route.path}-${param.key}`;
        input.placeholder = param.hint || '';
        input.dataset.key = param.key;
        input.dataset.required = param.required ? '1' : '0';

        input.addEventListener('input', () => {
          input.classList.remove('invalid');
          updateBuiltUrl();
        });
      }

      wrap.appendChild(input);
      fieldsEl.appendChild(wrap);
    });

    updateBuiltUrl();

    if (!route.params.length || !route.params.some(p => p.example)) {
      autofillBtn.style.display = 'none';
    }

    autofillBtn.addEventListener('click', () => {
      const inputs = [...fieldsEl.querySelectorAll('input, select')];
      inputs.forEach((input) => {
        const param = route.params.find((p) => p.key === input.dataset.key);
        if (param) {
          const sampleValue = sampleFor(param);
          input.value = sampleValue;
          input.classList.remove('invalid');
          input.classList.remove('autofilled');
          void input.offsetWidth;
          input.classList.add('autofilled');
          input.addEventListener('animationend', () => {
            input.classList.remove('autofilled');
          }, { once: true });
        }
      });
      updateBuiltUrl();
    });

    node.querySelector('.row-head').addEventListener('click', () => {
      node.classList.toggle('open');
    });

    copyEndpointBtn.addEventListener('click', () => {
      copyText(currentUrl, copyEndpointBtn);
    });

    copyResultBtn.addEventListener('click', () => {
      if (lastResultBlob) {
        const url = URL.createObjectURL(lastResultBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `download-${Date.now()}.${extFromMime(lastResultBlob.type)}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        copyText(lastResultText, copyResultBtn);
      }
    });

    runBtn.addEventListener('click', async () => {
      const inputs = [...fieldsEl.querySelectorAll('input, select')];
      let valid = true;

      inputs.forEach((input) => {
        const val = input.value.trim();
        if (input.dataset.required === '1' && !val) {
          valid = false;
          input.classList.add('invalid');
        } else {
          input.classList.remove('invalid');
        }
      });

      if (!valid) return;

      updateBuiltUrl();
      const url = currentUrl;

      endpointBox.hidden = false;
      resultBox.hidden = false;
      resultLoading.hidden = false;
      resultLoading.classList.remove('is-done');
      resultHead.hidden = true;
      resultJson.hidden = true;
      if (resultImage) resultImage.hidden = true;
      if (resultAudio) resultAudio.hidden = true;
      if (resultVideo) resultVideo.hidden = true;
      runBtn.disabled = true;

      const controller = new AbortController();
      const timeoutMs = 20000;
      const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);

      const startedAt = performance.now();

      try {
        const response = await fetch(url, { signal: controller.signal });
        const elapsedMs = Math.round(performance.now() - startedAt);
        const contentType = response.headers.get('Content-Type') || '';

        resultStatus.textContent = response.status;
        resultStatus.classList.toggle('err', !response.ok);
        resultTime.textContent = `${elapsedMs} ms`;

        if (contentType.startsWith('image/') || contentType.startsWith('audio/') || contentType.startsWith('video/')) {
          const blob = await response.blob();
          lastResultBlob = blob;
          resultSize.textContent = formatBytes(blob.size);
          const objectUrl = URL.createObjectURL(blob);

          if (contentType.startsWith('image/') && resultImage) {
            resultImage.src = objectUrl;
            resultImage.hidden = false;
          } else if (contentType.startsWith('audio/') && resultAudio) {
            resultAudio.src = objectUrl;
            resultAudio.hidden = false;
          } else if (contentType.startsWith('video/') && resultVideo) {
            resultVideo.src = objectUrl;
            resultVideo.hidden = false;
          } else {
            resultJson.textContent = `Media file (${contentType}) diterima, tapi player belum tersedia. Gunakan tombol download.`;
            resultJson.hidden = false;
          }

          copyLabel.textContent = 'Unduh';
          if (resultIcon) {
            resultIcon.outerHTML = '<svg class="icon-copy-result" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
            resultIcon = copyResultBtn.querySelector('.icon-copy-result');
          }
          lastResultText = url;
        } else {
          lastResultBlob = null;
          const rawText = await response.text();
          resultSize.textContent = formatBytes(new Blob([rawText]).size);
          let pretty = rawText;
          try {
            pretty = JSON.stringify(JSON.parse(rawText), null, 2);
          } catch (_) { }
          resultJson.textContent = pretty;
          resultJson.hidden = false;
          copyLabel.textContent = 'Salin';
          if (resultIcon) {
            resultIcon.outerHTML = '<svg class="icon-copy-result" width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>';
            resultIcon = copyResultBtn.querySelector('.icon-copy-result');
          }
          lastResultText = pretty;
        }

        resultHead.hidden = false;
      } catch (err) {
        const elapsedMs = Math.round(performance.now() - startedAt);

        resultHead.hidden = false;
        resultStatus.textContent = 'Gagal';
        resultStatus.classList.add('err');
        resultTime.textContent = `${elapsedMs} ms`;
        resultSize.textContent = '—';

        const message = err.name === 'AbortError'
          ? `Server tidak merespons dalam ${timeoutMs / 1000} detik. Endpoint ini mungkin lagi lambat/down, coba lagi.`
          : `Request gagal: ${err.message}`;
        resultJson.textContent = message;
        resultJson.hidden = false;
        copyLabel.textContent = 'Salin';
        if (resultIcon) {
          resultIcon.outerHTML = '<svg class="icon-copy-result" width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="9" y="9" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" stroke="currentColor" stroke-width="2"/></svg>';
          resultIcon = copyResultBtn.querySelector('.icon-copy-result');
        }
        lastResultText = message;
        lastResultBlob = null;
      } finally {
        clearTimeout(timeoutTimer);
        resultLoading.hidden = true;
        runBtn.disabled = false;
        clearBtn.hidden = false;
      }
    });

    clearBtn.addEventListener('click', () => {
      const inputs = [...fieldsEl.querySelectorAll('input, select')];
      inputs.forEach((input) => {
        input.value = '';
        input.classList.remove('invalid', 'autofilled');
      });

      updateBuiltUrl();

      endpointBox.hidden = true;
      resultBox.hidden = true;
      resultLoading.hidden = false;
      resultHead.hidden = true;
      resultJson.hidden = true;
      resultJson.textContent = '';
      if (resultImage) { resultImage.hidden = true; resultImage.src = ''; }
      if (resultAudio) { resultAudio.hidden = true; resultAudio.src = ''; }
      if (resultVideo) { resultVideo.hidden = true; resultVideo.src = ''; }

      lastResultText = '';
      lastResultBlob = null;
      clearBtn.hidden = true;
    });

    return node;
  }

  document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    const isTypingElsewhere = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
    if (e.key === '/' && !isTypingElsewhere) {
      e.preventDefault();
      filterInput.focus();
    }
    if (e.key === 'Escape' && document.activeElement === filterInput && filterInput.value) {
      filterInput.value = '';
      renderLog();
    }
  });

  filterInput.addEventListener('input', renderLog);

  copyBaseBtn.addEventListener('click', () => {
    copyText(window.location.origin, copyBaseBtn);
  });


  loadStats().catch(() => {});
  boot();

})();
