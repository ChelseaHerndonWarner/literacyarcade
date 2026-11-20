/* Announces "Build Your Own Word Wizard Quest" (word-wizard-custom.html).
   data-la-wwq="home"      → homepage: signed-out visitors get a one-time popup (reusing the Plus popup's
                             styles); signed-in teachers get a dismissible banner.
   data-la-wwq="dashboard" → Teacher Dashboard: dismissible banner (the page already requires sign-in).
   Both banners share one localStorage dismissal key, so closing it on either page hides it on both.
   Popup coordination: waits out the international welcome modal, never opens over the Plus popup, and
   tells the Plus popup to skip the rest of this page view (window.laPromoPopupShownThisView). */
(function () {
  'use strict';

  var TARGET = 'word-wizard-custom.html';
  var BANNER_DISMISS_KEY = 'laWordWizardCustomBannerDismissedV1';
  var POPUP_SHOWN_KEY = 'laWordWizardCustomPopupShownV1';
  var POPUP_DELAY_MS = 5000; // after the international welcome lookup (≤ ~4.4s) has had its chance
  var AUTH_TIMEOUT_MS = 4000;

  var script = document.currentScript;
  var mode = script && script.getAttribute('data-la-wwq');

  function safeGet(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); return window.localStorage.getItem(key) === value; }
    catch (e) { return false; }
  }
  function track(name) { if (typeof window.gtag === 'function') window.gtag('event', name, {}); }

  /* ── Banner (signed-in teachers) ── */
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

  /* ── Popup (signed-out homepage visitors, once per browser) ── */
  function openPopup() {
    if (safeGet(POPUP_SHOWN_KEY)) return;
    // Never stack on another popup; try again on a later visit (nothing is recorded).
    if (document.getElementById('laInternationalWelcome')) return;
    var plus = document.getElementById('plusPopupBackdrop');
    if (plus && plus.classList.contains('is-open')) return;
    // If we can't remember that we showed it, don't show it: it must be at most once per browser.
    if (!safeSet(POPUP_SHOWN_KEY, '1')) return;
    window.laPromoPopupShownThisView = true;

    var backdrop = document.createElement('div');
    backdrop.className = 'plus-popup-backdrop';
    backdrop.id = 'laWwqPopupBackdrop';
    backdrop.innerHTML =
      '<div class="plus-popup" role="dialog" aria-modal="true" aria-labelledby="laWwqPopupHeading" tabindex="-1">' +
        '<button type="button" class="plus-popup-close" aria-label="Close popup">&times;</button>' +
        '<h2 class="plus-popup-heading" id="laWwqPopupHeading">Your Words. Your Quest.</h2>' +
        '<p class="plus-popup-body">Build your own Word Wizard Quest using spelling or phonics words you’re teaching! ' +
        'Customize the challenge, practice spelling and decoding, and collect rewards along the way.</p>' +
        '<p class="plus-popup-support">Free to create and play. Sign up to save and share your games.</p>' +
        '<div class="plus-popup-actions"><a class="btn btn-primary" href="' + TARGET + '">Try Word Wizard Quest</a></div>' +
      '</div>';
    document.body.appendChild(backdrop);

    var dialog = backdrop.querySelector('.plus-popup');
    var closeBtn = backdrop.querySelector('.plus-popup-close');
    var cta = backdrop.querySelector('.btn');
    var previous = document.activeElement;
    var inertTargets = ['header', 'main', 'footer'].map(function (s) { return document.querySelector(s); }).filter(Boolean);

    function setInert(on) {
      inertTargets.forEach(function (el) {
        if ('inert' in HTMLElement.prototype) el.inert = on;
        if (on) { el.setAttribute('aria-hidden', 'true'); el.classList.add('plus-popup-inert-fallback'); }
        else { el.removeAttribute('aria-hidden'); el.classList.remove('plus-popup-inert-fallback'); }
      });
    }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); close('escape'); return; }
      if (e.key === 'Tab') {
        var first = closeBtn, last = cta;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    function close(reason) {
      document.removeEventListener('keydown', onKey, true);
      backdrop.classList.remove('is-open');
      setInert(false);
      track('wwq_popup_close_' + reason);
      window.setTimeout(function () {
        backdrop.remove();
        if (previous && typeof previous.focus === 'function') previous.focus();
      }, 250);
    }

    closeBtn.addEventListener('click', function () { close('button'); });
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) close('backdrop'); });
    cta.addEventListener('click', function () { track('wwq_popup_click'); });
    document.addEventListener('keydown', onKey, true);

    void backdrop.offsetHeight; // let the fade-in transition run
    backdrop.classList.add('is-open');
    setInert(true);
    dialog.focus();
    track('wwq_popup_view');
  }

  /* ── Who is viewing? (homepage only) ── */
  // Resolves to the signed-in user, null (signed out) or undefined (unknown → show nothing).
  // Uses the same firebase-config.js module the Plus popup loads, so Firebase is initialised once.
  function getUser() {
    return new Promise(function (resolve) {
      var done = false;
      function finish(value) { if (!done) { done = true; resolve(value); } }
      window.setTimeout(function () { finish(undefined); }, AUTH_TIMEOUT_MS);
      Promise.all([
        import('./firebase-config.js'),
        import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js')
      ]).then(function (mods) {
        var unsubscribe = mods[1].onAuthStateChanged(mods[0].auth, function (user) {
          if (typeof unsubscribe === 'function') unsubscribe();
          finish(user || null);
        }, function () { finish(undefined); });
      }).catch(function () { finish(undefined); });
    });
  }

  function start() {
    if (mode === 'dashboard') { mountBanner(); return; }
    if (mode !== 'home') return;
    getUser().then(function (user) {
      if (user) { mountBanner(); return; }
      if (user === null && !safeGet(POPUP_SHOWN_KEY)) window.setTimeout(openPopup, POPUP_DELAY_MS);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();
