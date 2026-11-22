/* Announces "Build Your Own Word Wizard Quest" (word-wizard-custom.html).
   data-la-wwq="home"      → homepage: dismissible banner for every visitor, signed in or out.
   data-la-wwq="dashboard" → Teacher Dashboard: dismissible banner (the page already requires sign-in).
   Both banners share one localStorage dismissal key, so closing it on either page hides it on both. */
(function () {
  'use strict';

  var TARGET = 'word-wizard-custom.html';
  var BANNER_DISMISS_KEY = 'laWordWizardCustomBannerDismissedV1';

  var script = document.currentScript;
  var mode = script && script.getAttribute('data-la-wwq');

  function safeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); return window.localStorage.getItem(key) === value; }
    catch (e) { return false; }
  }
  function track(name) { if (typeof window.gtag === 'function') window.gtag('event', name, {}); }

  /* ── Banner (every visitor) ── */
  function mountBanner() {
    if (safeGet(BANNER_DISMISS_KEY) === '1' || document.querySelector('.la-wwq-banner')) return;

    var banner = document.createElement('aside');
    banner.className = 'la-wwq-banner' + (mode === 'dashboard' ? ' la-wwq-banner--card' : '');
    banner.setAttribute('aria-label', 'New: Build Your Own Word Wizard Quest');
    banner.innerHTML =
      '<div class="la-wwq-banner__inner">' +
        '<p class="la-wwq-banner__text"><strong>New! Build Your Own Word Wizard Quest</strong> ' +
        'Turn your spelling and phonics word lists into a customizable word-guessing game with collectible rewards.</p>' +
        '<a class="la-wwq-banner__cta" href="' + TARGET + '">Try Word Wizard Quest</a>' +
        '<button class="la-wwq-banner__dismiss" type="button" aria-label="Dismiss announcement">&times;</button>' +
      '</div>';

    banner.querySelector('.la-wwq-banner__cta').addEventListener('click', function () { track('wwq_banner_click'); });
    banner.querySelector('.la-wwq-banner__dismiss').addEventListener('click', function () {
      safeSet(BANNER_DISMISS_KEY, '1');
      banner.remove();
    });

    if (mode === 'dashboard') {
      var main = document.querySelector('main');
      if (!main) return;
      main.insertBefore(banner, main.firstChild);
    } else {
      var header = document.querySelector('body > header');
      if (!header) return;
      header.insertAdjacentElement('afterend', banner);
    }
    track('wwq_banner_view');
  }

  function start() {
    if (mode !== 'dashboard' && mode !== 'home') return;
    mountBanner();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
