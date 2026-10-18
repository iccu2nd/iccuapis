(() => {
  'use strict';

  const el = (id) => document.getElementById(id);

  /* ---------- Visibility-aware interval ---------- */
  function visibleInterval(fn, ms) {
    let id = null;
    const start = () => {
      if (id != null) return;
      id = setInterval(() => {
        if (document.visibilityState === 'visible') fn();
      }, ms);
    };
    const stop = () => {
      if (id == null) return;
      clearInterval(id);
      id = null;
    };
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fn();
        start();
      } else {
        stop();
      }
    });
    if (document.visibilityState === 'visible') start();
    return { stop, start };
  }

  /* ---------- Hamburger menu ---------- */
  function setupMenu() {
    const btn = el('hamburgerBtn');
    const menu = el('hamburgerMenu');
    const overlay = el('menuOverlay');
    if (!btn || !menu || !overlay) return;

    function open() {
      btn.classList.add('is-open');
      btn.setAttribute('aria-expanded', 'true');
      menu.classList.add('is-open');
      overlay.classList.add('is-open');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      btn.classList.remove('is-open');
      btn.setAttribute('aria-expanded', 'false');
      menu.classList.remove('is-open');
      overlay.classList.remove('is-open');
      document.body.style.overflow = '';
    }

    btn.addEventListener('click', () => {
      menu.classList.contains('is-open') ? close() : open();
    });
    overlay.addEventListener('click', close);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && menu.classList.contains('is-open')) close();
    });
  }

  /* ---------- Notifications ---------- */
  function setupNotif() {
    const notifBtn = el('notifBtn');
    const notifPanel = el('notifPanel');
    const notifDot = el('notifDot');
    const notifList = el('notifList');
    const notifClearBtn = el('notifClearBtn');
    if (!notifBtn || !notifPanel || !notifDot || !notifList || !notifClearBtn) return;

    const SEEN_KEY = 'rezora_notif_seen';
    let latestAt = null;

    function getSeen() {
      try { return localStorage.getItem(SEEN_KEY); } catch (_) { return null; }
    }
    function setSeen(iso) {
      try { localStorage.setItem(SEEN_KEY, iso); } catch (_) {}
    }
    function updateDot() {
      const seen = getSeen();
      notifDot.hidden = !(latestAt && (!seen || new Date(latestAt) > new Date(seen)));
    }
    function fmt(iso) {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return { date: '—', time: '—' };
      return {
        date: d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }),
        time: d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
      };
    }
    function render(items) {
      if (!items || !items.length) {
        notifList.innerHTML = '<div class="notif-empty">Belum ada aktivitas.</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      items.forEach((item) => {
        const { date, time } = fmt(item.at);
        const row = document.createElement('div');
        row.className = 'notif-item';
        const text = String(item.text || '').replace(/^\s*info\s*[:\-]?\s*/i, '');
        row.innerHTML =
          '<span class="notif-item-path"></span><div class="notif-item-meta"><span></span><span></span></div>';
        row.querySelector('.notif-item-path').textContent = text;
        const spans = row.querySelectorAll('.notif-item-meta span');
        spans[0].textContent = date;
        spans[1].textContent = time;
        frag.appendChild(row);
      });
      notifList.innerHTML = '';
      notifList.appendChild(frag);
    }

    async function load() {
      try {
        const res = await fetch('/api/notifications?limit=20');
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        const items = (data && data.result) || [];
        if (items.length) latestAt = items[0].at;
        render(items);
        if (notifPanel.classList.contains('is-open') && latestAt) setSeen(latestAt);
        updateDot();
      } catch (_) {
        notifList.innerHTML = '<div class="notif-empty">Gagal memuat notifikasi.</div>';
      }
    }

    function openPanel() {
      notifPanel.classList.add('is-open');
      notifBtn.setAttribute('aria-expanded', 'true');
      load();
      if (latestAt) setSeen(latestAt);
      updateDot();
    }
    function closePanel() {
      notifPanel.classList.remove('is-open');
      notifBtn.setAttribute('aria-expanded', 'false');
    }

    notifBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      notifPanel.classList.contains('is-open') ? closePanel() : openPanel();
    });
    notifClearBtn.addEventListener('click', () => {
      if (latestAt) setSeen(latestAt);
      updateDot();
    });
    document.addEventListener('click', (e) => {
      if (notifPanel.classList.contains('is-open') && !notifPanel.contains(e.target) && e.target !== notifBtn) {
        closePanel();
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && notifPanel.classList.contains('is-open')) closePanel();
    });

    load();
    visibleInterval(load, 60_000);
  }

  /* ---------- Menu contact links (cached) ---------- */
  function setupContacts() {
    const wa = el('waChannelMenuItem');
    const owner = el('ownerContactMenuItem');
    if (!wa && !owner) return;

    function apply(id, url) {
      const node = el(id);
      if (!node) return;
      if (url) {
        node.href = url;
        node.hidden = false;
      } else {
        node.hidden = true;
      }
    }

    const CACHE_KEY = 'rezora_manifest_links';
    const CACHE_TTL = 5 * 60 * 1000;
    try {
      const cached = sessionStorage.getItem(CACHE_KEY);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Date.now() - parsed.t < CACHE_TTL) {
          apply('waChannelMenuItem', parsed.whatsappChannel);
          apply('ownerContactMenuItem', parsed.ownerContact);
          return;
        }
      }
    } catch (_) {}

    fetch('/manifest.json')
      .then((r) => r.json())
      .then((data) => {
        const links = (data && data.result && data.result.links) || {};
        apply('waChannelMenuItem', links.whatsappChannel);
        apply('ownerContactMenuItem', links.ownerContact);
        try {
          sessionStorage.setItem(CACHE_KEY, JSON.stringify({
            t: Date.now(),
            whatsappChannel: links.whatsappChannel || '',
            ownerContact: links.ownerContact || ''
          }));
        } catch (_) {}
      })
      .catch(() => {
        apply('waChannelMenuItem', null);
        apply('ownerContactMenuItem', null);
      });
  }

  /* ---------- Boot splash helper ---------- */
  function setupBootSplash(maxMs) {
    const boot = el('bootLoader');
    if (!boot) return Promise.resolve();
    return new Promise((resolve) => {
      let done = false;
      function hide() {
        if (done) return;
        done = true;
        boot.classList.add('is-leaving');
        setTimeout(() => { boot.hidden = true; }, 280);
        resolve();
      }
      window.addEventListener('bootlogo:done', hide, { once: true });
      if (document.readyState === 'complete') {
        setTimeout(hide, 400);
      } else {
        window.addEventListener('load', () => setTimeout(hide, 200), { once: true });
      }
      setTimeout(hide, maxMs || 2000);
    });
  }

  window.RezoraUI = { setupMenu, setupNotif, setupContacts, setupBootSplash, visibleInterval, el };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setupMenu();
      setupNotif();
      setupContacts();
    });
  } else {
    setupMenu();
    setupNotif();
    setupContacts();
  }
})();
