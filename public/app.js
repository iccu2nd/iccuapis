(() => {
  'use strict';

  const el = (id) => document.getElementById(id);

  (function setupNotifBell() {
    try {
      const notifBtn = el('notifBtn');
      const notifPanel = el('notifPanel');
      const notifDot = el('notifDot');
      const notifList = el('notifList');
      const notifClearBtn = el('notifClearBtn');
      if (!notifBtn || !notifPanel || !notifDot || !notifList || !notifClearBtn) {
        console.error('[notif] one or more notification elements are missing from the DOM');
        return;
      }

      const NOTIF_SEEN_KEY = 'iccu_notif_last_seen_at';
      const NOTIF_POLL_MS = 20000;
      let latestNotifAt = null;

      function formatNotifTime(iso) {
        const d = new Date(iso);
        if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
        const date = d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
        const time = d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        return { date, time };
      }

      function getLastSeenAt() {
        try { return localStorage.getItem(NOTIF_SEEN_KEY); } catch (err) { return null; }
      }

      function setLastSeenAt(iso) {
        try { localStorage.setItem(NOTIF_SEEN_KEY, iso); } catch (err) { /* ignore */ }
      }

      function updateNotifDot() {
        const lastSeen = getLastSeenAt();
        const hasUnread = latestNotifAt && (!lastSeen || new Date(latestNotifAt) > new Date(lastSeen));
        notifDot.hidden = !hasUnread;
      }

      function renderNotifList(items) {
        notifList.innerHTML = '';
        if (!items || !items.length) {
          notifList.innerHTML = '<div class="notif-empty">Belum ada aktivitas.</div>';
          return;
        }
        items.forEach((item) => {
          const { date, time } = formatNotifTime(item.at);
          const row = document.createElement('div');
          row.className = 'notif-item';
          const text = String(item.text || '').replace(/^\s*info\s*[:\-]?\s*/i, '');
          row.innerHTML = `
            <span class="notif-item-path">${text}</span>
            <div class="notif-item-meta">
              <span>${date}</span>
              <span>${time}</span>
            </div>
          `;
          notifList.appendChild(row);
        });
      }

      async function loadNotifications() {
        try {
          const res = await fetch('/api/notifications?limit=30', { cache: 'no-store' });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const items = (data && data.result) || [];
          if (items.length) {
            latestNotifAt = items[0].at;
          }
          renderNotifList(items);
          if (notifPanel.classList.contains('is-open') && latestNotifAt) {
            setLastSeenAt(latestNotifAt);
          }
          updateNotifDot();
        } catch (err) {
          notifList.innerHTML = '<div class="notif-empty">Gagal memuat notifikasi.</div>';
        }
      }

      function openNotifPanel() {
        notifPanel.classList.add('is-open');
        notifBtn.setAttribute('aria-expanded', 'true');
        loadNotifications();
        if (latestNotifAt) setLastSeenAt(latestNotifAt);
        updateNotifDot();
      }

      function closeNotifPanel() {
        notifPanel.classList.remove('is-open');
        notifBtn.setAttribute('aria-expanded', 'false');
      }

      notifBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (notifPanel.classList.contains('is-open')) {
          closeNotifPanel();
        } else {
          openNotifPanel();
        }
      });

      notifClearBtn.addEventListener('click', () => {
        if (latestNotifAt) setLastSeenAt(latestNotifAt);
        updateNotifDot();
      });

      document.addEventListener('click', (e) => {
        if (notifPanel.classList.contains('is-open') && !notifPanel.contains(e.target) && e.target !== notifBtn) {
          closeNotifPanel();
        }
      });

      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && notifPanel.classList.contains('is-open')) {
          closeNotifPanel();
        }
      });

      loadNotifications();
      setInterval(loadNotifications, NOTIF_POLL_MS);
    } catch (err) {
      console.error('[notif] failed to set up notification bell:', err);
    }
  })();

  const rowTemplate = el('routeRowTemplate');
  const logEl = el('log');
  const bootLoader = el('bootLoader');
  const contentStack = el('contentStack');
  const filterInput = el('filterInput');
  const copyBaseBtn = el('copyBaseBtn');

  let manifest = null;
  let routes = [];
  let firstRender = true;
  const openGroups = new Set();

  const CATEGORY_ICONS = {
    ai: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v3M12 18v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M3 12h3M18 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/><circle cx="12" cy="12" r="3"/></svg>',
    search: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
    image: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>',
    stalk: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg>',
    download: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 10l5 5 5-5"/><path d="M4 21h16"/></svg>',
    tools: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 005.4-5.4l-2.5 2.5-2-2 2.5-2.5z"/></svg>'
  };

  const DEFAULT_CATEGORY_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/></svg>';

  function categoryIcon(key) {
    return CATEGORY_ICONS[key] || DEFAULT_CATEGORY_ICON;
  }

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

  async function fetchJsonWithRetry(url, attempts = 3, backoffMs = 500) {
    let lastErr;
    for (let i = 0; i < attempts; i += 1) {
      try {
        const res = await fetch(url, { cache: 'no-store' });
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
    const [viewsRes, statsRes, myIpRes] = await Promise.all([
      fetchJsonWithRetry('/api/views').catch(() => null),
      fetchJsonWithRetry('/api/stats').catch(() => null),
      fetchJsonWithRetry('/api/myip').catch(() => null)
    ]);

    if (viewsRes && viewsRes.result) {
      el('viewCount').textContent = viewsRes.result.totalViews.toLocaleString('id-ID');
    } else {
      el('viewCount').textContent = '—';
    }
    el('viewCount').classList.remove('is-loading');

    if (statsRes && statsRes.result) {
      const s = statsRes.result;
      el('totalRequestCount').textContent = s.allTime.totalRequests.toLocaleString('id-ID');
      el('todayRequestCount').textContent = s.today.totalRequests.toLocaleString('id-ID');
    } else {
      el('totalRequestCount').textContent = '—';
      el('todayRequestCount').textContent = '—';
    }
    el('totalRequestCount').classList.remove('is-loading');
    el('todayRequestCount').classList.remove('is-loading');

    if (myIpRes && myIpRes.result && myIpRes.result.ip) {
      el('myIpValue').textContent = myIpRes.result.ip;
    } else {
      el('myIpValue').textContent = '—';
    }
    el('myIpValue').classList.remove('is-loading');
  }

  async function loadData() {
    const [manifestRes, routesRes] = await Promise.all([
      fetchJsonWithRetry('/manifest.json'),
      fetchJsonWithRetry('/api/routes')
    ]);

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
    const realHeight = logEl.scrollHeight;
    if (realHeight > 0) {
      contentStack.style.minHeight = `${realHeight}px`;
    }
    bootLoader.style.opacity = '0';
    contentStack.classList.remove('is-booting');
    setTimeout(() => {
      bootLoader.hidden = true;
      bootLoader.style.opacity = '';
      contentStack.style.minHeight = '';
    }, 300);
  }

  async function boot() {
    bootLoader.hidden = false;
    bootLoader.style.opacity = '';
    contentStack.classList.add('is-booting');
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
    const toggleBtn = el('searchToggleBtn');
    const searchRow = el('searchRow');
    if (toggleBtn && searchRow) {
      toggleBtn.hidden = true;
      searchRow.hidden = false;
    }
    renderLog();
  }

  function renderLog() {
    logEl.hidden = false;
    const term = filterInput.value.trim().toLowerCase();
    logEl.innerHTML = '';

    const groups = [...new Set(routes.map((r) => r.group))].sort(
      (a, b) => groupOrder(a) - groupOrder(b)
    );

    groups.forEach((g) => {
      const items = routes.filter((r) => {
        if (r.group !== g) return false;
        if (term && !(r.name.toLowerCase().includes(term) || r.path.toLowerCase().includes(term))) {
          return false;
        }
        return true;
      });

      if (!items.length) return;

      const isOpen = term ? true : openGroups.has(g);

      const folder = document.createElement('div');
      folder.className = 'folder' + (isOpen ? ' is-open' : '');

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'folder-head';
      head.setAttribute('aria-expanded', String(isOpen));
      head.innerHTML = `
        <span class="folder-icon">${categoryIcon(g)}</span>
        <span class="folder-label">${groupLabel(g)}</span>
        <span class="folder-count">(${items.length})</span>
        <span class="folder-chev" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
      `;
      head.addEventListener('click', () => {
        if (openGroups.has(g)) {
          openGroups.delete(g);
        } else {
          openGroups.add(g);
        }
        renderLog();
      });

      const body = document.createElement('div');
      body.className = 'folder-body';
      body.hidden = !isOpen;

      items.forEach((route, i) => {
        const row = buildRow(route);
        row.style.animationDelay = `${Math.min(i, 10) * 0.05}s`;
        body.appendChild(row);
      });

      folder.appendChild(head);
      folder.appendChild(body);
      logEl.appendChild(folder);
    });

    if (!logEl.children.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-state';
      empty.textContent = 'Tidak ada endpoint yang cocok dengan pencarian itu.';
      logEl.appendChild(empty);
    }

    if (firstRender) {
      requestAnimationFrame(() => logEl.classList.add('is-visible'));
      firstRender = false;
    }
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
    const resultIcon = node.querySelector('.icon-copy-result');
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

        if (!param.required) {
          const emptyOpt = document.createElement('option');
          emptyOpt.value = '';
          emptyOpt.textContent = param.hint || 'Pilih...';
          input.appendChild(emptyOpt);
        }

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

  (function setupSearchToggle() {
    const toggleBtn = el('searchToggleBtn');
    const searchRow = el('searchRow');
    const closeBtn = el('searchCloseBtn');
    if (!toggleBtn || !searchRow || !closeBtn) return;

    function openSearch() {
      toggleBtn.hidden = true;
      searchRow.hidden = false;
      filterInput.focus();
    }

    function closeSearch() {
      searchRow.hidden = true;
      toggleBtn.hidden = false;
      if (filterInput.value) {
        filterInput.value = '';
        renderLog();
      }
    }

    toggleBtn.addEventListener('click', openSearch);
    closeBtn.addEventListener('click', closeSearch);

    document.addEventListener('keydown', (e) => {
      const activeTag = document.activeElement && document.activeElement.tagName;
      const isTypingElsewhere = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
      if (e.key === '/' && !isTypingElsewhere && searchRow.hidden) {
        e.preventDefault();
        openSearch();
      }
      if (e.key === 'Escape' && !searchRow.hidden && document.activeElement === filterInput) {
        closeSearch();
      }
    });
  })();

  filterInput.addEventListener('input', renderLog);

  copyBaseBtn.addEventListener('click', () => {
    copyText(window.location.origin, copyBaseBtn);
  });

  const hamburgerBtn = el('hamburgerBtn');
  const hamburgerMenu = el('hamburgerMenu');
  const menuOverlay = el('menuOverlay');

  function openMenu() {
    hamburgerBtn.classList.add('is-open');
    hamburgerBtn.setAttribute('aria-expanded', 'true');
    hamburgerMenu.classList.add('is-open');
    menuOverlay.classList.add('is-open');
    document.body.style.overflow = 'hidden';
  }

  function closeMenu() {
    hamburgerBtn.classList.remove('is-open');
    hamburgerBtn.setAttribute('aria-expanded', 'false');
    hamburgerMenu.classList.remove('is-open');
    menuOverlay.classList.remove('is-open');
    document.body.style.overflow = '';
  }

  hamburgerBtn.addEventListener('click', () => {
    if (hamburgerMenu.classList.contains('is-open')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  menuOverlay.addEventListener('click', closeMenu);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && hamburgerMenu.classList.contains('is-open')) {
      closeMenu();
    }
  });

  document.addEventListener('keydown', (e) => {
    const activeTag = document.activeElement && document.activeElement.tagName;
    const isTypingElsewhere = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || activeTag === 'SELECT' || (document.activeElement && document.activeElement.isContentEditable);
    if (e.key === '/' && !isTypingElsewhere) {
      e.preventDefault();
      filterInput.focus();
    }
  });

  loadStats();
  setInterval(loadStats, 60000);
  boot();
})();