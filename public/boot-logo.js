(function () {
  'use strict';

  var outlinePath = document.getElementById('bootOutlinePath');
  var fillPath = document.getElementById('bootFillPath');
  var fillGroup = document.getElementById('bootFillGroup');
  var glowDot = document.getElementById('bootGlowDot');
  var halo = document.getElementById('bootHalo');

  if (!outlinePath || !fillPath || !glowDot) return;

  var reduceMotion = window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) {
    fillPath.style.fillOpacity = 1;
    if (halo) { halo.classList.add('is-idle'); }
    window.dispatchEvent(new Event('bootlogo:done'));
    return;
  }

  function wait(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function cubicBezier(x1, y1, x2, y2) {
    function A(a1, a2) { return 1 - 3 * a2 + 3 * a1; }
    function B(a1, a2) { return 3 * a2 - 6 * a1; }
    function C(a1) { return 3 * a1; }
    function calc(t, a1, a2) { return ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t; }
    function slope(t, a1, a2) { return 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1); }
    function tForX(x) {
      var t = x;
      for (var i = 0; i < 6; i++) {
        var s = slope(t, x1, x2);
        if (s === 0) return t;
        t -= (calc(t, x1, x2) - x) / s;
      }
      return t;
    }
    return function (x) { return calc(tForX(x), y1, y2); };
  }
  var ease = cubicBezier(0.65, 0, 0.35, 1);

  var len = outlinePath.getTotalLength();
  outlinePath.style.strokeDasharray = len;
  outlinePath.style.strokeDashoffset = len;

  var DRAW_DURATION = 1500;

  function drawStroke() {
    return new Promise(function (resolve) {
      var start = null;
      function frame(ts) {
        if (!start) start = ts;
        var t = Math.min((ts - start) / DRAW_DURATION, 1);
        var e = ease(t);

        outlinePath.style.strokeDashoffset = len * (1 - e);

        var pt = outlinePath.getPointAtLength(len * e);
        glowDot.setAttribute('cx', pt.x);
        glowDot.setAttribute('cy', pt.y);

        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      }
      requestAnimationFrame(frame);
    });
  }

  async function play() {
    await wait(120);
    glowDot.style.transition = 'opacity .25s ease';
    glowDot.style.opacity = 1;

    await drawStroke();

    fillPath.style.transition = 'fill-opacity .6s cubic-bezier(.4,0,.2,1)';
    fillPath.style.fillOpacity = 1;
    glowDot.style.opacity = 0;

    await wait(420);

    if (halo) halo.classList.add('is-flash');
    outlinePath.classList.add('is-flash');
    if (fillGroup) fillGroup.classList.add('is-flash');

    await wait(650);

    outlinePath.classList.remove('is-flash');
    if (fillGroup) fillGroup.classList.remove('is-flash');
    if (halo) {
      halo.classList.remove('is-flash');
      halo.classList.add('is-idle');
    }

    window.dispatchEvent(new Event('bootlogo:done'));
  }

  play();
})();
