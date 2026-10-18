(() => {
  'use strict';
  const KEY = 'rezora-theme'; // 'dark' | 'light'

  function isDark() {
    try {
      const v = localStorage.getItem(KEY);
      if (v === 'light') return false;
      if (v === 'dark') return true;
    } catch (_) {}
    return true; // default dark
  }

  function apply(dark) {
    document.documentElement.classList.toggle('light', !dark);
    try { localStorage.setItem(KEY, dark ? 'dark' : 'light'); } catch (_) {}
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      btn.setAttribute('aria-label', dark ? 'Mode terang' : 'Mode gelap');
      btn.title = dark ? 'Mode terang' : 'Mode gelap';
    });
  }

  // Apply ASAP to avoid flash
  apply(isDark());

  function wire() {
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        apply(!isDark());
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wire);
  } else {
    wire();
  }
})();
