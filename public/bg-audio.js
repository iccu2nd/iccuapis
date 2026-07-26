(() => {
  'use strict';

  const AUDIO_SRC = 'https://u.pone.rs/qbpakthg.mpeg';
  const STORAGE_KEY = 'bgAudioMuted';

  const audio = new Audio(AUDIO_SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.55;

  function isMuted() {
    return localStorage.getItem(STORAGE_KEY) === '1';
  }

  function setMuted(muted) {
    localStorage.setItem(STORAGE_KEY, muted ? '1' : '0');
    updateButtons();
    if (muted) {
      audio.pause();
    } else {
      attemptPlay();
    }
  }

  function attemptPlay() {
    if (isMuted()) return;
    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(() => {
        // Autoplay blocked until user interacts — start on first gesture.
        const resume = () => {
          if (!isMuted()) audio.play().catch(() => {});
        };
        document.addEventListener('pointerdown', resume, { once: true });
        document.addEventListener('keydown', resume, { once: true });
      });
    }
  }

  function updateButtons() {
    const muted = isMuted();
    document.querySelectorAll('.menu-music-toggle').forEach((btn) => {
      btn.classList.toggle('is-muted', muted);
      btn.setAttribute('aria-pressed', String(!muted));
      btn.setAttribute('aria-label', muted ? 'Nyalakan musik' : 'Matikan musik');
    });
  }

  function bindButtons() {
    document.querySelectorAll('.menu-music-toggle').forEach((btn) => {
      if (btn.dataset.bound) return;
      btn.dataset.bound = '1';
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        setMuted(!isMuted());
      });
    });
    updateButtons();
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindButtons();
    attemptPlay();
  });
})();
