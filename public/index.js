(() => {
  'use strict';

  const el = (id) => document.getElementById(id);
  const ui = window.RezoraUI || {};

  const splashReady = ui.setupBootSplash
    ? ui.setupBootSplash(1800)
    : Promise.resolve();

  /* ---------- Stats ---------- */
  (function setupStats() {
    const visitorEl = el('statApiVisitor');
    const todayEl = el('statApiToday');
    const totalEl = el('statApiTotal');
    const refreshBtn = el('statApiRefreshBtn');
    const logListEl = el('statApiLogList');
    const ipEl = el('statApiIp');
    if (!visitorEl && !todayEl && !totalEl && !logListEl && !ipEl) return;

    function setText(node, value) {
      if (!node) return;
      node.textContent = value;
      node.classList.remove('is-loading');
    }

    function truncatePath(path, max) {
      if (!path) return '';
      max = max || 46;
      return path.length > max ? path.slice(0, max - 1) + '…' : path;
    }

    function timeAgo(iso) {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '—';
      const sec = Math.max(0, Math.floor((Date.now() - then) / 1000));
      if (sec < 5) return 'baru saja';
      if (sec < 60) return sec + 'd lalu';
      const min = Math.floor(sec / 60);
      if (min < 60) return min + 'm lalu';
      const hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'j lalu';
      return Math.floor(hr / 24) + 'h lalu';
    }

    async function loadSummary() {
      try {
        const res = await fetch('/api/stats');
        const data = res.ok ? await res.json() : null;
        const r = data && data.result;
        setText(visitorEl, r && typeof r.uniqueVisitors === 'number'
          ? r.uniqueVisitors.toLocaleString('id-ID') : '—');
        setText(todayEl, r && r.today && typeof r.today.totalRequests === 'number'
          ? r.today.totalRequests.toLocaleString('id-ID') : '—');
        setText(totalEl, r && r.allTime && typeof r.allTime.totalRequests === 'number'
          ? r.allTime.totalRequests.toLocaleString('id-ID') : '—');
      } catch (_) {
        setText(visitorEl, '—');
        setText(todayEl, '—');
        setText(totalEl, '—');
      }
    }

    async function loadLogList() {
      if (!logListEl) return;
      try {
        const res = await fetch('/api/logs?limit=6');
        const data = res.ok ? await res.json() : null;
        const entries = (data && data.result) || [];
        if (!entries.length) {
          logListEl.innerHTML = '<div class="stat-api-log-empty">Belum ada request hari ini.</div>';
          return;
        }
        logListEl.innerHTML = entries.map((entry) => {
          const ok = entry.status >= 200 && entry.status < 400;
          return '<div class="stat-api-log-row' + (ok ? '' : ' is-err') + '">' +
            '<span class="stat-api-log-status' + (ok ? '' : ' err') + '">' + entry.status + '</span>' +
            '<span class="stat-api-log-method">' + entry.method + '</span>' +
            '<span class="stat-api-log-path" title="' + entry.path + '">' + truncatePath(entry.path) + '</span>' +
            '<span class="stat-api-log-ms">' + entry.ms + 'ms</span>' +
            '<span class="stat-api-log-time">' + timeAgo(entry.at) + '</span></div>';
        }).join('');
      } catch (_) {
        logListEl.innerHTML = '<div class="stat-api-log-empty">Gagal memuat aktivitas.</div>';
      }
    }

    async function loadIp() {
      if (!ipEl) return;
      try {
        const res = await fetch('/api/myip');
        const data = res.ok ? await res.json() : null;
        setText(ipEl, (data && data.result && data.result.ip) || '—');
      } catch (_) {
        setText(ipEl, '—');
      }
    }

    function refreshLive() {
      return Promise.all([loadSummary(), loadLogList()]);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('is-spinning');
        refreshLive().finally(() => {
          setTimeout(() => refreshBtn.classList.remove('is-spinning'), 400);
        });
      });
    }

    splashReady.then(() => {
      Promise.all([refreshLive(), loadIp()]);
      if (ui.visibleInterval) ui.visibleInterval(refreshLive, 90_000);
      else setInterval(refreshLive, 90_000);
    });
  })();

  /* ---------- Code tabs ---------- */
  (function setupCodeTabs() {
    const buttons = document.querySelectorAll('.code-tab-btn');
    const blocks = document.querySelectorAll('.code-block');
    if (!buttons.length) return;
    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const lang = btn.dataset.lang;
        buttons.forEach((b) => b.classList.toggle('is-active', b === btn));
        blocks.forEach((b) => { b.hidden = b.dataset.lang !== lang; });
      });
    });
    const origin = window.location.origin;
    document.querySelectorAll('.code-base-url').forEach((n) => { n.textContent = origin; });
  })();
})();
