(() => {
  'use strict';

  const AUDIO_SRC = 'https://u.pone.rs/qbpakthg.mpeg';
  const MUTED_KEY = 'bgAudioMuted';
  const TIME_KEY = 'bgAudioTime';

  const audio = new Audio(AUDIO_SRC);
  audio.loop = true;
  audio.preload = 'auto';
  audio.volume = 0.55;

  function isMuted() {
    return localStorage.getItem(MUTED_KEY) === '1';
  }

  function saveTime() {
    if (isFinite(audio.currentTime)) {
      localStorage.setItem(TIME_KEY, String(audio.currentTime));
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

  function startPlayback() {
    const saved = parseFloat(localStorage.getItem(TIME_KEY));
    const hasSaved = !isNaN(saved) && saved > 0;

    function playFromSavedPosition() {
      if (hasSaved && isFinite(audio.duration) && saved < audio.duration) {
        audio.currentTime = saved;
      }
      attemptPlay();
    }

    if (!hasSaved || audio.readyState >= 1) {
      playFromSavedPosition();
    } else {
      audio.addEventListener('loadedmetadata', playFromSavedPosition, { once: true });
    }
  }

  function setMuted(muted) {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
    updateButtons();
    if (muted) {
      saveTime();
      audio.pause();
    } else {
      attemptPlay();
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

  // Keep the saved position fresh so navigating to another page resumes
  // close to where playback left off instead of restarting from zero.
  audio.addEventListener('timeupdate', saveTime);
  window.addEventListener('pagehide', saveTime);
  window.addEventListener('beforeunload', saveTime);

  // Script tags for this file are placed after the menu markup in the HTML,
  // so the DOM nodes we need already exist — no need to wait for
  // DOMContentLoaded, which lets playback start as early as possible.
  bindButtons();
  startPlayback();

  // Fallback in case this script ever loads before the menu markup.
  document.addEventListener('DOMContentLoaded', bindButtons);
})();
