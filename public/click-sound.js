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

    const osc = audioCtx.createOscillator();
    const oscGain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1300, now);
    osc.frequency.exponentialRampToValueAtTime(280, now + 0.045);
    oscGain.gain.setValueAtTime(0.16, now);
    oscGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
    osc.connect(oscGain).connect(audioCtx.destination);
    osc.start(now);
    osc.stop(now + 0.06);

    const bufferSize = Math.floor(audioCtx.sampleRate * 0.02);
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i += 1) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const noise = audioCtx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 2500;
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.3, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.025);
    noise.connect(noiseFilter).connect(noiseGain).connect(audioCtx.destination);
    noise.start(now);
    noise.stop(now + 0.03);
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
