(function () {
  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme, persist) {
    document.documentElement.setAttribute('data-theme', theme);
    if (persist) {
      try { localStorage.setItem('theme', theme); } catch (e) {}
    }
    var toggles = document.querySelectorAll('.theme-toggle-input');
    for (var i = 0; i < toggles.length; i++) {
      toggles[i].checked = theme === 'dark';
    }
  }

  function init() {
    applyTheme(currentTheme(), false);

    var toggles = document.querySelectorAll('.theme-toggle-input');
    toggles.forEach(function (toggle) {
      toggle.addEventListener('change', function () {
        applyTheme(toggle.checked ? 'dark' : 'light', true);
      });
    });

    if (window.matchMedia) {
      var media = window.matchMedia('(prefers-color-scheme: dark)');
      var mediaHandler = function (e) {
        var stored;
        try { stored = localStorage.getItem('theme'); } catch (err) { stored = null; }
        if (!stored) applyTheme(e.matches ? 'dark' : 'light', false);
      };
      if (media.addEventListener) media.addEventListener('change', mediaHandler);
      else if (media.addListener) media.addListener(mediaHandler);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
