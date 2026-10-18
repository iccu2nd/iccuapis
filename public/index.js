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
    const todayEl = el('statApiToday');
    const totalEl = el('statApiTotal');
    const refreshBtn = el('statApiRefreshBtn');
    const logListEl = el('statApiLogList');
    const ipEl = el('statApiIp');
    if (!visitorEl && !todayEl && !totalEl && !logListEl && !ipEl) return;

    function charPool(ch) {
      if (/[0-9]/.test(ch)) return '0123456789';
      return null;
    }

    function scrambleInto(target, finalText) {
      if (!target) return;
      const flickerMs = 45;
      const staggerMs = 55;
      const holdMs = 200;
      const chars = String(finalText).split('');
      target.textContent = '';
      target.classList.add('is-scrambling');
      const spans = chars.map(() => {
        const span = document.createElement('span');
        span.className = 'slot-char';
        target.appendChild(span);
        return span;
      });
      const settleAt = chars.map((_, i) => holdMs + i * staggerMs);
      const start = performance.now();
      let lastFlicker = -Infinity;

      function frame(now) {
        const elapsed = now - start;
        const doneAll = chars.every((_, i) => elapsed >= settleAt[i]);
        if (elapsed - lastFlicker >= flickerMs || doneAll) {
          lastFlicker = elapsed;
          chars.forEach((ch, i) => {
            const span = spans[i];
            if (elapsed >= settleAt[i]) {
              if (span.textContent !== ch) {
                span.textContent = ch;
                span.classList.add('slot-settled');
                setTimeout(() => span.classList.remove('slot-settled'), 280);
              }
            } else {
              const pool = charPool(ch);
              span.textContent = pool ? pool[(Math.random() * pool.length) | 0] : ch;
            }
          });
        }
        if (!doneAll) {
          requestAnimationFrame(frame);
        } else {
          target.classList.remove('is-scrambling');
        }
      }
      requestAnimationFrame(frame);
    }

    function truncatePath(path, max = 46) {
      if (!path) return '';
      return path.length > max ? `${path.slice(0, max - 1)}…` : path;
    }

    function timeAgo(iso) {
      const then = new Date(iso).getTime();
      if (Number.isNaN(then)) return '—';
      const diffSec = Math.max(0, Math.floor((Date.now() - then) / 1000));
      if (diffSec < 5) return 'baru saja';
      if (diffSec < 60) return `${diffSec}d lalu`;
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m lalu`;
      const diffHour = Math.floor(diffMin / 60);
      if (diffHour < 24) return `${diffHour}j lalu`;
      const diffDay = Math.floor(diffHour / 24);
      return `${diffDay}h lalu`;
    }

    async function loadSummary() {
      if (!visitorEl && !todayEl && !totalEl) return;
      try {
        const res = await fetch('/api/stats', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const result = data && data.result;
        if (visitorEl) {
          const count = result ? result.uniqueVisitors : null;
          scrambleInto(visitorEl, typeof count === 'number' ? count.toLocaleString('id-ID') : '—');
        }
        if (todayEl) {
          const today = result && result.today ? result.today.totalRequests : null;
          scrambleInto(todayEl, typeof today === 'number' ? today.toLocaleString('id-ID') : '—');
        }
        if (totalEl) {
          const total = result && result.allTime ? result.allTime.totalRequests : null;
          scrambleInto(totalEl, typeof total === 'number' ? total.toLocaleString('id-ID') : '—');
        }
      } catch (err) {
        if (visitorEl) visitorEl.textContent = '—';
        if (todayEl) todayEl.textContent = '—';
        if (totalEl) totalEl.textContent = '—';
      }
      if (visitorEl) visitorEl.classList.remove('is-loading');
      if (todayEl) todayEl.classList.remove('is-loading');
      if (totalEl) totalEl.classList.remove('is-loading');
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
        logListEl.innerHTML = entries.map((entry) => {
          const ok = entry.status >= 200 && entry.status < 400;
          return `
            <div class="stat-api-log-row${ok ? '' : ' is-err'}">
              <span class="stat-api-log-status${ok ? '' : ' err'}">${entry.status}</span>
              <span class="stat-api-log-method">${entry.method}</span>
              <span class="stat-api-log-path" title="${entry.path}">${truncatePath(entry.path)}</span>
              <span class="stat-api-log-ms">${entry.ms}ms</span>
              <span class="stat-api-log-time">${timeAgo(entry.at)}</span>
            </div>
          `;
        }).join('');
      } catch (err) {
        logListEl.innerHTML = '<div class="stat-api-log-empty">Gagal memuat aktivitas.</div>';
      }
    }

    async function loadIp() {
      if (!ipEl) return;
      try {
        const res = await fetch('/api/myip', { cache: 'no-store' });
        const data = res.ok ? await res.json() : null;
        const ip = data && data.result && data.result.ip;
        scrambleInto(ipEl, ip || '—');
      } catch (err) {
        ipEl.textContent = '—';
      }
      ipEl.classList.remove('is-loading');
    }

    function refreshLive() {
      return Promise.all([loadSummary(), loadLogList()]);
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
      loadIp();
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
