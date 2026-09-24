(() => {
  'use strict';

  const DISMISS_KEY = 'literacyArcadeWhatsNewCustomListsDismissedV1';

  function isDismissed() {
    try { return localStorage.getItem(DISMISS_KEY) === '1'; }
    catch (error) { return false; }
  }

  function rememberDismissal() {
    try { localStorage.setItem(DISMISS_KEY, '1'); }
    catch (error) { /* Storage can be unavailable in privacy modes. */ }
  }

  function mountBanner() {
    if (isDismissed() || document.querySelector('.la-whats-new')) return;
    const header = document.querySelector('body > header');
    if (!header) return;

    const banner = document.createElement('aside');
    banner.className = 'la-whats-new';
    banner.setAttribute('aria-label', "What's new at Literacy Arcade");
    banner.innerHTML = `
      <div class="la-whats-new__inner">
        <p><strong>New:</strong> Add your own spelling lists to
          <a href="robot-word-builder.html">Robot Word Builder</a> and
          <a href="phoneme-counter.html">Letterbox Lesson</a> — with editable word mapping and syllable division.
        </p>
        <button class="la-whats-new__dismiss" type="button" aria-label="Dismiss what's new banner">&times;</button>
      </div>`;

    banner.querySelector('.la-whats-new__dismiss').addEventListener('click', () => {
      rememberDismissal();
      banner.remove();
    });
    header.insertAdjacentElement('afterend', banner);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mountBanner, { once: true });
  } else {
    mountBanner();
  }
})();
