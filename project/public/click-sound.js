(() => {
  'use strict';

  const CLICK_SRC = '/assets/click.wav';

  let ctx;
  let buffer = null;
  let loadPromise = null;
  let masterGain;

  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function loadBuffer() {
    const audioCtx = getCtx();
    if (!audioCtx || loadPromise) return loadPromise;
    loadPromise = fetch(CLICK_SRC)
      .then((res) => res.arrayBuffer())
      .then((data) => audioCtx.decodeAudioData(data))
      .then((decoded) => {
        buffer = decoded;
        return decoded;
      })
      .catch(() => {
        loadPromise = null; // allow retry on next click if it failed
      });
    return loadPromise;
  }

  function playClick() {
    const audioCtx = getCtx();
    if (!audioCtx) return;

    if (!buffer) {
      // Not decoded yet (e.g. first click before load finished) — kick off
      // loading and just skip this one; playback will be instant afterwards.
      loadBuffer();
      return;
    }

    const now = audioCtx.currentTime;
    const source = audioCtx.createBufferSource();
    source.buffer = buffer;
    // slight random variation so repeated clicks don't sound identical
    source.playbackRate.value = 0.92 + Math.random() * 0.16; // ~0.92x - 1.08x

    const gain = audioCtx.createGain();
    gain.gain.value = 0.85 + Math.random() * 0.15; // consistent, audible level

    source.connect(gain).connect(masterGain);
    source.start(now);
  }

  // Start decoding as soon as possible, and also on first user interaction
  // (some browsers block AudioContext/fetch-heavy work until a gesture).
  loadBuffer();
  document.addEventListener('pointerdown', () => loadBuffer(), { once: true, capture: true });

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
