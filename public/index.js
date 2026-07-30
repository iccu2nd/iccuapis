(() => {
  'use strict';

  const el = (id) => document.getElementById(id);

  let signalSplashGone = () => {};
  const splashGone = new Promise((resolve) => { signalSplashGone = resolve; });

  (function setupBootSplash() {
    const bootLoader = el('bootLoader');
    if (!bootLoader) { signalSplashGone(); return; }

    let hidden = false;
    function hide() {
      if (hidden) return;
      hidden = true;
      bootLoader.classList.add('is-leaving');
      signalSplashGone();
      setTimeout(() => { bootLoader.hidden = true; }, 350);
    }

    let animDone = false;
    let pageLoaded = document.readyState === 'complete';

    function tryHide() {
      if (animDone && pageLoaded) hide();
    }

    window.addEventListener('bootlogo:done', () => {
      animDone = true;
      tryHide();
    }, { once: true });

    if (pageLoaded) {
      tryHide();
    } else {
      window.addEventListener('load', () => {
        pageLoaded = true;
        tryHide();
      }, { once: true });
    }

    setTimeout(hide, 5000);
  })();

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
        try { localStorage.setItem(NOTIF_SEEN_KEY, iso); } catch (err) {}
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

  (function setupHamburgerMenu() {
    const hamburgerBtn = el('hamburgerBtn');
    const hamburgerMenu = el('hamburgerMenu');
    const menuOverlay = el('menuOverlay');
    if (!hamburgerBtn || !hamburgerMenu || !menuOverlay) return;

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
  })();

  (function setupStatApi() {
    const visitorEl = el('statApiVisitor');
    const refreshBtn = el('statApiRefreshBtn');
    const logListEl = el('statApiLogList');
    const locCityEl = el('statApiLocCity');
    const locRegionEl = el('statApiLocRegion');
    const locCoordsEl = el('statApiLocCoords');
    const mapFrame = el('statApiMap');
    const ipEl = el('statApiIp');
    const tempEl = el('statApiTemp');
    if (!visitorEl && !logListEl && !locCityEl) return;

    const geoCache = new Map();

    async function fetchGeo(ip) {
      if (!ip) return null;
      if (geoCache.has(ip)) return geoCache.get(ip);
      const promise = fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => (data && data.success !== false ? data : null))
        .catch(() => null);
      geoCache.set(ip, promise);
      return promise;
    }

    function truncatePath(path, max = 30) {
      if (!path) return '';
      return path.length > max ? `${path.slice(0, max - 1)}…` : path;
    }

    function formatLocalTime(iso, timezoneId) {
      try {
        const d = new Date(iso);
        return new Intl.DateTimeFormat('id-ID', {
          hour: '2-digit', minute: '2-digit', second: '2-digit',
          hour12: false,
          timeZone: timezoneId || 'Asia/Jakarta'
        }).format(d);
      } catch (err) {
        return '--.--.--';
      }
    }

    async function loadVisitor() {
      if (!visitorEl) return;
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const count = data && data.result ? data.result.uniqueVisitors : null;
        visitorEl.textContent = typeof count === 'number' ? count.toLocaleString('id-ID') : '—';
      } catch (err) {
        visitorEl.textContent = '—';
      }
      visitorEl.classList.remove('is-loading');
    }

    async function loadLogList() {
      if (!logListEl) return;
      try {
        const res = await fetch('/api/logs', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const entries = ((data && data.result) || []).slice(0, 6);
        if (!entries.length) {
          logListEl.innerHTML = '<div class="stat-api-log-empty">Belum ada request hari ini.</div>';
          return;
        }
        const rows = await Promise.all(entries.map(async (entry) => {
          const geo = await fetchGeo(entry.ip);
          const flag = (geo && geo.flag && geo.flag.emoji) || '🏳️';
          const tz = geo && geo.timezone && geo.timezone.id;
          const time = formatLocalTime(entry.at, tz);
          const ok = entry.status >= 200 && entry.status < 400;
          return `
            <div class="stat-api-log-row">
              <span class="stat-api-log-status ${ok ? 'ok' : 'err'}">${entry.status}</span>
              <span class="stat-api-log-method">${entry.method}</span>
              <span class="stat-api-log-path" title="${entry.path}">${truncatePath(entry.path)}</span>
              <span class="stat-api-log-ms">${entry.ms}ms</span>
              <span class="stat-api-log-flag">${flag} ${time}</span>
            </div>
          `;
        }));
        logListEl.innerHTML = rows.join('');
      } catch (err) {
        logListEl.innerHTML = '<div class="stat-api-log-empty">Gagal memuat log.</div>';
      }
    }

    async function loadLocationAndTemp() {
      try {
        const myIpRes = await fetch('/api/myip', { cache: 'no-store' });
        const myIpData = myIpRes.ok ? await myIpRes.json() : null;
        const myIp = myIpData && myIpData.result && myIpData.result.ip;

        if (ipEl) {
          ipEl.textContent = myIp || '—';
          ipEl.classList.remove('is-loading');
        }

        const geo = myIp ? await fetchGeo(myIp) : null;

        if (geo) {
          if (locCityEl) locCityEl.textContent = geo.city || '—';
          if (locRegionEl) locRegionEl.textContent = [geo.region, geo.country].filter(Boolean).join(', ') || '—';
          if (locCoordsEl && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
            locCoordsEl.textContent = `${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`;
          }
          if (mapFrame && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
            mapFrame.src = `https://www.google.com/maps?q=${geo.latitude},${geo.longitude}&z=14&output=embed`;
          }
          if (tempEl && typeof geo.latitude === 'number' && typeof geo.longitude === 'number') {
            try {
              const wRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current_weather=true`, { cache: 'no-store' });
              const wData = wRes.ok ? await wRes.json() : null;
              const t = wData && wData.current_weather && wData.current_weather.temperature;
              tempEl.textContent = typeof t === 'number' ? `${t.toFixed(1)}°C` : '—';
            } catch (err) {
              tempEl.textContent = '—';
            }
          } else if (tempEl) {
            tempEl.textContent = '—';
          }
        } else {
          if (locCityEl) locCityEl.textContent = '—';
          if (locRegionEl) locRegionEl.textContent = '—';
          if (locCoordsEl) locCoordsEl.textContent = '—, —';
          if (tempEl) tempEl.textContent = '—';
        }
      } catch (err) {
        if (ipEl) ipEl.textContent = '—';
        if (tempEl) tempEl.textContent = '—';
      }
      if (tempEl) tempEl.classList.remove('is-loading');
    }

    function refreshLive() {
      return Promise.all([loadVisitor(), loadLogList()]);
    }

    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        refreshBtn.classList.add('is-spinning');
        refreshLive().finally(() => {
          setTimeout(() => refreshBtn.classList.remove('is-spinning'), 500);
        });
      });
    }

    splashGone.then(() => {
      refreshLive();
      loadLocationAndTemp();
      setInterval(refreshLive, 60000);
    });
  })();

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
    document.querySelectorAll('.code-base-url').forEach((n) => {
      n.textContent = window.location.origin;
    });
  })();
})();
