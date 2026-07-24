(() => {
  'use strict';

  const CLICK_SRC = '/assets/click.wav';
  let audioPool = [];
  let poolIndex = 0;
  const POOL_SIZE = 6;

  function initPool() {
    if (audioPool.length) return;
    for (let i = 0; i < POOL_SIZE; i += 1) {
      const a = new Audio(CLICK_SRC);
      a.preload = 'auto';
      audioPool.push(a);
    }
  }

  function playClick() {
    initPool();
    const audio = audioPool[poolIndex];
    poolIndex = (poolIndex + 1) % audioPool.length;
    try {
      audio.currentTime = 0;
      // slight random variation so repeated clicks don't sound identical
      audio.playbackRate = 0.92 + Math.random() * 0.16; // ~0.92x - 1.08x
      audio.volume = 0.85 + Math.random() * 0.15; // ~0.85 - 1.0
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) {
      /* ignore playback errors (e.g. autoplay restrictions) */
    }
  }

  const CLICKABLE_SELECTOR = [
    'button',
    '.row-head',
    'a.hero-btn-primary',
    'a.hero-btn-secondary',
    'a.hero-chip',
    '.code-tab-btn'
  ].join(', ');

  document.addEventListener('click', (e) => {
    const target = e.target.closest(CLICKABLE_SELECTOR);
    if (!target || target.disabled) return;
    playClick();
  }, true);
})();
