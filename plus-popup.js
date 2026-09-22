/* ══ Plus promo popup logic — "Unlock more with Literacy Arcade Plus".
   Extracted verbatim from index.html's original inline <script> so existing
   timing/frequency/behavior is unchanged. Shared across every public page
   that includes the matching markup (id="plusPopupBackdrop" etc.) and
   plus-popup.css. Uses the same laPlusPopupSuppressUntil localStorage key
   everywhere, so localStorage (scoped to the site's origin, not per-page)
   naturally shares dismissal state across all pages that include this
   script — closing it on one page suppresses it on every other page too. ══ */
(function () {
  var STORAGE_KEY = 'laPlusPopupSuppressUntil';
  var SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
  var SHOW_DELAY_MS = 25000;

  // Fails safely: any localStorage access is wrapped so a blocked or
  // unavailable store (private browsing, disabled storage, etc.) never
  // breaks the page — it just means the popup can't remember state.
  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }

  function isSuppressed() {
    var raw = safeGet(STORAGE_KEY);
    if (!raw) return false;
    var until = parseInt(raw, 10);
    if (isNaN(until)) return false;
    return Date.now() < until;
  }

  function suppressForSevenDays() {
    safeSet(STORAGE_KEY, String(Date.now() + SEVEN_DAYS_MS));
  }

  function sendEvent(name, params) {
    if (typeof gtag === 'function') {
      gtag('event', name, params || {});
    }
  }

  // Best-effort Plus/Plus Family entitlement check, used to skip showing
  // this popup to users who already have a paid plan. Loaded lazily (only
  // once the popup is about to open, not on every page load) via a
  // same-origin dynamic import of firebase-config.js, so pages that don't
  // already use Firebase aren't given a new hard dependency just for this.
  // Mirrors the existing users/{uid}.plan check in plus-download-gate.js
  // and report-print-gate.js. Any failure (not signed in, offline, no
  // Firebase on this page, timeout, etc.) resolves to "not entitled" so
  // the popup still shows exactly as it always has — this only ever
  // suppresses it, never blocks it from showing.
  function isPlusEntitled() {
    function withTimeout(promise, ms) {
      return new Promise(function (resolve) {
        var done = false;
        var timer = setTimeout(function () {
          if (!done) { done = true; resolve(undefined); }
        }, ms);
        promise.then(function (value) {
          if (!done) { done = true; clearTimeout(timer); resolve(value); }
        }, function () {
          if (!done) { done = true; clearTimeout(timer); resolve(undefined); }
        });
      });
    }

    return withTimeout((async function () {
      var configMod = await import('./firebase-config.js');
      var authMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js');
      var storeMod = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');

      var user = await new Promise(function (resolve) {
        var unsubscribe = authMod.onAuthStateChanged(configMod.auth, function (u) {
          unsubscribe();
          resolve(u);
        }, function () {
          unsubscribe();
          resolve(null);
        });
      });
      if (!user) return false;

      var snap = await storeMod.getDoc(storeMod.doc(configMod.db, 'users', user.uid));
      var plan = String((snap.exists() ? snap.data().plan : '') || '').trim().toLowerCase();
      return plan === 'plus' || plan === 'family';
    })(), 4000).then(function (result) {
      return result === true;
    });
  }

  var backdrop = document.getElementById('plusPopupBackdrop');
  var popup = document.getElementById('plusPopup');
  var closeBtn = document.getElementById('plusPopupClose');
  var secondaryBtn = document.getElementById('plusPopupSecondary');
  var ctaLink = document.getElementById('plusPopupCta');

  if (!backdrop || !popup || !closeBtn || !secondaryBtn || !ctaLink) return;

  var isOpen = false;
  var viewSent = false;
  var previousActiveElement = null;

  // Background containers to make inert (unreachable to interaction and
  // screen readers) while the popup is open. The popup/backdrop itself
  // is deliberately excluded — only these siblings are affected.
  var inertTargets = [
    document.querySelector('header'),
    document.querySelector('main'),
    document.querySelector('footer')
  ].filter(Boolean);
  var supportsInert = 'inert' in HTMLElement.prototype;

  function setBackgroundInert(on) {
    inertTargets.forEach(function (el) {
      if (on) {
        if (supportsInert) el.inert = true;
        // Safe fallback for browsers without inert support (and a
        // harmless belt-and-suspenders addition where inert IS
        // supported): screen readers skip it, and pointer-events:none
        // blocks clicks/taps without needing per-element handlers.
        el.setAttribute('aria-hidden', 'true');
        el.classList.add('plus-popup-inert-fallback');
      } else {
        if (supportsInert) el.inert = false;
        el.removeAttribute('aria-hidden');
        el.classList.remove('plus-popup-inert-fallback');
      }
    });
  }

  function focusableElements() {
    return [closeBtn, ctaLink, secondaryBtn];
  }

  function trapKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePopup('escape');
      return;
    }
    if (e.key === 'Tab') {
      var items = focusableElements();
      var first = items[0];
      var last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function onBackdropClick(e) {
    if (e.target === backdrop) closePopup('backdrop');
  }

  function openPopup() {
    if (isOpen || isSuppressed()) return;
    isOpen = true;
    previousActiveElement = document.activeElement;
    backdrop.hidden = false;
    // Force layout so the transition runs, then trigger it.
    void backdrop.offsetHeight;
    backdrop.classList.add('is-open');
    setBackgroundInert(true);
    popup.focus();
    document.addEventListener('keydown', trapKeydown, true);
    backdrop.addEventListener('click', onBackdropClick);
    if (!viewSent) {
      viewSent = true;
      sendEvent('plus_popup_view');
    }
  }

  function closePopup(reason) {
    if (!isOpen) return;
    isOpen = false;
    backdrop.classList.remove('is-open');
    setBackgroundInert(false);
    document.removeEventListener('keydown', trapKeydown, true);
    backdrop.removeEventListener('click', onBackdropClick);
    suppressForSevenDays();
    if (reason) sendEvent('plus_popup_close', { close_method: reason });
    window.setTimeout(function () {
      backdrop.hidden = true;
      if (previousActiveElement && typeof previousActiveElement.focus === 'function') {
        previousActiveElement.focus();
      }
    }, 250);
  }

  closeBtn.addEventListener('click', function () { closePopup('close_button'); });
  secondaryBtn.addEventListener('click', function () { closePopup('keep_exploring'); });
  ctaLink.addEventListener('click', function () {
    sendEvent('plus_popup_click');
    suppressForSevenDays();
    // No preventDefault: the link must still navigate to
    // plus-subscriptions.html normally even if analytics is blocked.
  });

  window.addEventListener('load', function () {
    if (isSuppressed()) return;
    window.setTimeout(function () {
      if (isSuppressed()) return; // re-check: state may have changed during the delay
      isPlusEntitled().then(function (entitled) {
        if (entitled || isSuppressed()) return;
        openPopup();
      });
    }, SHOW_DELAY_MS);
  });

  // Guard against the back-forward cache restoring the page with the
  // popup mid-open: force the background back to normal and the popup
  // fully hidden so nothing stays inert after navigating back.
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) {
      setBackgroundInert(false);
      isOpen = false;
      backdrop.classList.remove('is-open');
      backdrop.hidden = true;
    }
  });
})();
