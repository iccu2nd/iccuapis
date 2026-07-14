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
