(() => {
  'use strict';

  let ctx;

  function getCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function playClick() {
    const audioCtx = getCtx();
    if (!audioCtx) return;
    const now = audioCtx.currentTime;

    function noiseBurst(startTime, duration, filterType, filterFreq, peakGain, q) {
      const bufferSize = Math.max(1, Math.floor(audioCtx.sampleRate * duration));
      const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i += 1) {
        data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
      }
      const src = audioCtx.createBufferSource();
      src.buffer = buffer;
      const filter = audioCtx.createBiquadFilter();
      filter.type = filterType;
      filter.frequency.value = filterFreq;
      if (q) filter.Q.value = q;
      const gain = audioCtx.createGain();
      gain.gain.setValueAtTime(peakGain, startTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
      src.connect(filter).connect(gain).connect(audioCtx.destination);
      src.start(startTime);
      src.stop(startTime + duration);
    }

    noiseBurst(now, 0.012, 'bandpass', 4200, 0.55, 1.1);
    noiseBurst(now + 0.001, 0.02, 'highpass', 6500, 0.22, 0.9);

    const thud = audioCtx.createOscillator();
    const thudGain = audioCtx.createGain();
    thud.type = 'square';
    thud.frequency.setValueAtTime(150, now);
    thudGain.gain.setValueAtTime(0.1, now);
    thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    thud.connect(thudGain).connect(audioCtx.destination);
    thud.start(now);
    thud.stop(now + 0.02);
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
