/* Browser-specific Microsoft Clarity opt-out.
   Visit any page with ?disableClarity=1 to stop Clarity on this browser,
   or ?disableClarity=0 to turn it back on. Must load before the Clarity snippet. */
(function () {
  var KEY = 'la_disable_clarity';
  window.__laNoClarity = false;
  try {
    var flag = new URLSearchParams(window.location.search).get('disableClarity');
    if (flag === '1') localStorage.setItem(KEY, '1');
    else if (flag === '0') localStorage.removeItem(KEY);
    window.__laNoClarity = localStorage.getItem(KEY) === '1';
  } catch (e) {}

  // Central, privacy-safe custom-event bridge. Clarity already records the
  // current page URL, so callers send only a stable event name—never user,
  // student, activity-content, or account identifiers.
  window.LiteracyArcadeAnalytics = window.LiteracyArcadeAnalytics || {
    track: function (eventName, context) {
      if (window.__laNoClarity || !/^[a-z][a-z0-9_]*$/.test(String(eventName || ''))) return;
      if (typeof window.clarity !== 'function') return;
      if (context && typeof context === 'object') {
        Object.keys(context).forEach(function (key) {
          var value = String(context[key] || '');
          if (/^[a-z][a-z0-9_]*$/.test(key) && /^[a-z0-9_-]{1,48}$/.test(value)) {
            window.clarity('set', key, value);
          }
        });
      }
      window.clarity('event', eventName);
    }
  };

  // Promotional destinations opt in with a data attribute. Delegation keeps
  // the listener centralized and guarantees one event per actual click.
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest
      ? event.target.closest('[data-clarity-promo]')
      : null;
    if (link) window.LiteracyArcadeAnalytics.track('promo_callout_click', {
      promo_destination: link.getAttribute('data-clarity-promo')
    });
  });
})();
