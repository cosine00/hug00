(function () {
  'use strict';

  if (window.__posterReviewReady) return;
  window.__posterReviewReady = true;

  var tooltip;
  var activePoster;
  var hideTimer;

  function ensureTooltip() {
    if (tooltip) return tooltip;
    tooltip = document.createElement('div');
    tooltip.className = 'poster-review-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    document.body.appendChild(tooltip);
    return tooltip;
  }

  function placeTooltip(poster) {
    var tip = ensureTooltip();
    var rect = poster.getBoundingClientRect();
    var gap = 12;
    var edge = 12;
    tip.style.width = 'max-content';
    tip.style.maxWidth = Math.min(360, window.innerWidth - edge * 2) + 'px';
    tip.style.left = '0px';
    tip.style.top = '0px';

    var width = tip.offsetWidth;
    var height = tip.offsetHeight;
    var above = rect.top >= height + gap + edge;
    var top = above ? rect.top - height - gap : rect.bottom + gap;
    var left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(edge, Math.min(left, window.innerWidth - width - edge));
    var arrowX = Math.max(18, Math.min(rect.left + rect.width / 2 - left, width - 18));

    tip.classList.toggle('is-above', above);
    tip.classList.toggle('is-below', !above);
    tip.style.left = Math.round(left) + 'px';
    tip.style.top = Math.round(top) + 'px';
    tip.style.setProperty('--review-arrow-x', Math.round(arrowX) + 'px');
  }

  function show(poster) {
    var review = (poster.getAttribute('data-review') || '').trim();
    if (!review || !window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    window.clearTimeout(hideTimer);
    if (activePoster && activePoster !== poster) activePoster.classList.remove('is-review-active');
    activePoster = poster;
    activePoster.classList.add('is-review-active');
    var tip = ensureTooltip();
    tip.textContent = review;
    placeTooltip(poster);
    requestAnimationFrame(function () { tip.classList.add('is-visible'); });
  }

  function hide() {
    window.clearTimeout(hideTimer);
    hideTimer = window.setTimeout(function () {
      if (tooltip) tooltip.classList.remove('is-visible');
      if (activePoster) activePoster.classList.remove('is-review-active');
      activePoster = null;
    }, 70);
  }

  document.addEventListener('pointerover', function (event) {
    var poster = event.target.closest('.HPRth[data-review]:not([data-review=""])');
    if (poster && !poster.contains(event.relatedTarget)) show(poster);
  });

  document.addEventListener('pointerout', function (event) {
    var poster = event.target.closest('.HPRth[data-review]:not([data-review=""])');
    if (poster && !poster.contains(event.relatedTarget)) hide();
  });

  window.addEventListener('scroll', hide, { passive: true });
  window.addEventListener('resize', hide, { passive: true });
}());
