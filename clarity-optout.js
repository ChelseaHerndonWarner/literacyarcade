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
})();
