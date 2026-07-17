(function () {
  'use strict';

  const DISMISSAL_KEY = 'literacyArcadeInternationalWelcomeDismissedAt';
  const DISMISSAL_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
  const LOOKUP_URL = 'https://get.geojs.io/v1/ip/country';
  const LOOKUP_TIMEOUT_MS = 3500;
  const SHOW_DELAY_MS = 900;
  const TEST_PARAMETER = 'testInternationalWelcome';
  const MODAL_ID = 'laInternationalWelcome';

  const COUNTRIES = Object.freeze({
    PH: { name: 'Philippines', phrase: 'the Philippines' },
    SG: { name: 'Singapore', phrase: 'Singapore' },
    GB: { name: 'United Kingdom', phrase: 'the United Kingdom' },
    AU: { name: 'Australia', phrase: 'Australia' },
    NZ: { name: 'New Zealand', phrase: 'New Zealand' },
    CA: { name: 'Canada', phrase: 'Canada' }
  });

  const TEST_VALUES = new Set([...Object.keys(COUNTRIES), 'OTHER']);

  let previousActiveElement = null;
  let keydownHandler = null;

  function getTestCountry() {
    try {
      const value = new URLSearchParams(window.location.search).get(TEST_PARAMETER);
      const normalized = String(value || '').trim().toUpperCase();
      return TEST_VALUES.has(normalized) ? normalized : '';
    } catch (_error) {
      return '';
    }
  }

  function wasDismissedRecently() {
    try {
      const dismissedAt = Number(window.localStorage.getItem(DISMISSAL_KEY));
      return Number.isFinite(dismissedAt)
        && dismissedAt > 0
        && Date.now() - dismissedAt < DISMISSAL_WINDOW_MS;
    } catch (_error) {
      return false;
    }
  }

  function saveDismissal() {
    try {
      window.localStorage.setItem(DISMISSAL_KEY, String(Date.now()));
    } catch (_error) {
      // Storage can be unavailable in privacy modes; closing still succeeds.
    }
  }

  async function detectCountryCode() {
    if (typeof window.fetch !== 'function' || typeof window.AbortController !== 'function') {
      return '';
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);

    try {
      const response = await window.fetch(LOOKUP_URL, {
        method: 'GET',
        headers: { Accept: 'text/plain' },
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        cache: 'no-store',
        signal: controller.signal
      });

      if (!response.ok) return '';

      const countryCode = String(await response.text()).trim().toUpperCase();
      return /^[A-Z]{2}$/.test(countryCode) ? countryCode : '';
    } catch (_error) {
      return '';
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function getCopy(countryCode) {
    const country = COUNTRIES[countryCode];

    if (country) {
      return {
        eyebrow: `International access · ${country.name}`,
        heading: `Literacy Arcade is available in ${country.phrase}`,
        body: `Literacy Arcade welcomes families, tutors, and educators in ${country.phrase}. Explore literacy games, assessments, fluency practice, and teaching tools for beginning and developing readers.`
      };
    }

    return {
      eyebrow: 'International access',
      heading: 'Literacy Arcade is available internationally',
      body: 'Literacy Arcade welcomes families, tutors, and educators around the world. Explore literacy games, assessments, fluency practice, and teaching tools for beginning and developing readers.'
    };
  }

  function getFocusableElements(dialog) {
    return Array.from(dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(element => !element.hidden && element.getClientRects().length > 0);
  }

  function closeModal({ restoreFocus = true } = {}) {
    const backdrop = document.getElementById(MODAL_ID);
    if (!backdrop) return;

    saveDismissal();
    document.removeEventListener('keydown', keydownHandler, true);
    keydownHandler = null;
    document.documentElement.classList.remove('la-international-welcome-open');
    document.body.classList.remove('la-international-welcome-open');
    backdrop.remove();

    if (restoreFocus && previousActiveElement && typeof previousActiveElement.focus === 'function') {
      previousActiveElement.focus();
    }
    previousActiveElement = null;
  }

  function handleModalKeydown(event, dialog) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
      return;
    }

    if (event.key !== 'Tab') return;

    const focusable = getFocusableElements(dialog);
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function openModal(countryCode) {
    if (document.getElementById(MODAL_ID)) return;

    const copy = getCopy(countryCode);
    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ID;
    backdrop.className = 'la-international-welcome';
    backdrop.innerHTML = `
      <div class="la-international-welcome__dialog" role="dialog" aria-modal="true" aria-labelledby="laInternationalWelcomeTitle" aria-describedby="laInternationalWelcomeBody laInternationalWelcomeReassurance" tabindex="-1">
        <button class="la-international-welcome__close" type="button" aria-label="Close international welcome dialog">&times;</button>
        <div class="la-international-welcome__content">
          <p class="la-international-welcome__eyebrow"><span class="la-international-welcome__globe" aria-hidden="true">🌎</span>${copy.eyebrow}</p>
          <h2 class="la-international-welcome__title" id="laInternationalWelcomeTitle">${copy.heading}</h2>
          <p class="la-international-welcome__body" id="laInternationalWelcomeBody">${copy.body}</p>
          <p class="la-international-welcome__reassurance" id="laInternationalWelcomeReassurance">Your subscription is fully digital, with immediate access. Stripe will display available local pricing at checkout.</p>
          <div class="la-international-welcome__actions">
            <a class="la-international-welcome__primary" href="plus-subscriptions.html">View Subscription Plans</a>
            <button class="la-international-welcome__secondary" type="button">Continue Exploring</button>
          </div>
        </div>
      </div>`;

    const dialog = backdrop.querySelector('.la-international-welcome__dialog');
    const closeButton = backdrop.querySelector('.la-international-welcome__close');
    const continueButton = backdrop.querySelector('.la-international-welcome__secondary');
    const plansLink = backdrop.querySelector('.la-international-welcome__primary');

    previousActiveElement = document.activeElement;
    document.body.appendChild(backdrop);
    document.documentElement.classList.add('la-international-welcome-open');
    document.body.classList.add('la-international-welcome-open');

    closeButton.addEventListener('click', () => closeModal());
    continueButton.addEventListener('click', () => closeModal());
    plansLink.addEventListener('click', () => closeModal({ restoreFocus: false }));
    backdrop.addEventListener('click', event => {
      if (event.target === backdrop) closeModal();
    });

    keydownHandler = event => handleModalKeydown(event, dialog);
    document.addEventListener('keydown', keydownHandler, true);

    backdrop.classList.add('is-visible');
    closeButton.focus();
  }

  async function initialize() {
    const testCountry = getTestCountry();
    if (!testCountry && wasDismissedRecently()) return;

    const readyAt = window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
    const countryCode = testCountry || await detectCountryCode();

    if (!countryCode || countryCode === 'US') return;

    const now = window.performance && typeof window.performance.now === 'function'
      ? window.performance.now()
      : Date.now();
    const remainingDelay = Math.max(0, SHOW_DELAY_MS - (now - readyAt));
    window.setTimeout(() => openModal(countryCode), remainingDelay);
  }

  function startInitialization() {
    initialize().catch(() => {
      // International welcome failures must never affect the host page.
    });
  }

  if (document.readyState === 'complete') {
    startInitialization();
  } else {
    window.addEventListener('load', startInitialization, { once: true });
  }
}());
