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

  (function setupHeroStats() {
    const ipEl = el('myIpValue');
    const totalEl = el('totalRequestCount');
    const todayEl = el('todayRequestCount');
    const visitorEl = el('totalVisitorCount');
    if (!ipEl && !totalEl && !todayEl && !visitorEl) return;

    function slotRoll(elm, finalText) {
      if (!elm) return;
      const chars = String(finalText).split('');
      elm.innerHTML = '';
      elm.classList.add('slot-machine');
      const spans = chars.map((ch) => {
        const span = document.createElement('span');
        span.className = 'slot-char';
        span.textContent = /[0-9]/.test(ch) ? '0' : ch;
        elm.appendChild(span);
        return span;
      });

      const spinDuration = 160;
      const tickSpeed = 35;

      function animateDigit(i) {
        if (i >= spans.length) return;
        const span = spans[i];
        const ch = chars[i];
        if (!/[0-9]/.test(ch)) {
          animateDigit(i + 1);
          return;
        }
        let counter = 0;
        const intervalId = setInterval(() => {
          span.textContent = String(counter % 10);
          counter++;
        }, tickSpeed);
        setTimeout(() => {
          clearInterval(intervalId);
          span.textContent = ch;
          span.classList.add('slot-settled');
          animateDigit(i + 1);
        }, spinDuration);
      }

      animateDigit(0);
    }

    async function loadHeroStats() {
      const [statsRes, myIpRes, viewsRes] = await Promise.all([
        fetch('/api/stats', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/myip', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        fetch('/api/views', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
      ]);

      if (statsRes && statsRes.result) {
        const s = statsRes.result;
        slotRoll(totalEl, s.allTime.totalRequests.toLocaleString('id-ID'));
        slotRoll(todayEl, s.today.totalRequests.toLocaleString('id-ID'));
      } else {
        if (totalEl) totalEl.textContent = '—';
        if (todayEl) todayEl.textContent = '—';
      }
      if (totalEl) totalEl.classList.remove('is-loading');
      if (todayEl) todayEl.classList.remove('is-loading');

      if (myIpRes && myIpRes.result && myIpRes.result.ip) {
        slotRoll(ipEl, myIpRes.result.ip);
      } else if (ipEl) {
        ipEl.textContent = '—';
      }
      if (ipEl) ipEl.classList.remove('is-loading');

      if (viewsRes && viewsRes.result && typeof viewsRes.result.totalViews === 'number') {
        slotRoll(visitorEl, viewsRes.result.totalViews.toLocaleString('id-ID'));
      } else if (visitorEl) {
        visitorEl.textContent = '—';
      }
      if (visitorEl) visitorEl.classList.remove('is-loading');
    }

    splashGone.then(() => {
      loadHeroStats();
      setInterval(loadHeroStats, 60000);
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
