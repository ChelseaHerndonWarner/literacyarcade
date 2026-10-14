/* West Virginia Hope Scholarship cart — WV-only, sessionStorage-backed.
   Shared by west-virginia-hope-scholarship.html and west-virginia-cart.html.
   One quantity per product. Storage access is always wrapped in try/catch;
   if storage is blocked the cart falls back to in-memory for the page view. */
(function () {
  'use strict';

  var KEY = 'la_wv_cart_v1';
  var PRODUCTS = {
    plus: {
      name: 'Literacy Arcade Plus Annual',
      detail: 'One full year of Literacy Arcade Plus for one parent or educator account. One-time purchase — does not renew automatically.',
      price: 79,
      url: 'https://buy.stripe.com/5kQ8wI4Ex7M1eFsgCm8EM02'
    },
    letterbox: {
      name: 'The Letter Box',
      detail: 'Physical, hands-on literacy resource: a ready-to-use lowercase letter tile set with heart markers and a divided carrying case.',
      price: 42,
      url: 'https://buy.stripe.com/28EeV6gnfgixgNAcm68EM01'
    }
  };
  var ORDER = ['plus', 'letterbox'];
  /* Combined WV Stripe Payment Link (Plus Annual + The Letter Box, $121).
     Leave empty until the link exists — the cart page shows a waiting state.
     Required Stripe setup for this link:
       - Line items: Literacy Arcade Plus Annual $79 + The Letter Box $42
         (total $121), one-time payment, quantity fixed at 1 each
       - No customer-adjustable quantities
       - Collect U.S. shipping address; free U.S. shipping
       - Required custom field: "Hope Scholarship recipient/family name"
       - Required custom field: "Email for Literacy Arcade account setup"
       - No promotion codes
       - No saved-payment-method requirement
     Paste the resulting https://buy.stripe.com/... URL between the quotes. */
  var COMBINED_URL = 'https://buy.stripe.com/8x26oA5IB5DTbtgfyi8EM03';

  var memory = { plus: false, letterbox: false };

  function read() {
    var items = { plus: false, letterbox: false };
    try {
      var raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          ORDER.forEach(function (id) { items[id] = parsed.items.indexOf(id) !== -1; });
          return items;
        }
      }
    } catch (e) { /* storage blocked or corrupt — fall through */ }
    return { plus: memory.plus, letterbox: memory.letterbox };
  }

  function write(items) {
    memory = { plus: !!items.plus, letterbox: !!items.letterbox };
    try {
      window.sessionStorage.setItem(KEY, JSON.stringify({
        items: ORDER.filter(function (id) { return items[id]; })
      }));
    } catch (e) { /* ignore */ }
    document.dispatchEvent(new CustomEvent('wvcart:change'));
  }

  function ids() {
    var items = read();
    return ORDER.filter(function (id) { return items[id]; });
  }

  window.WVCart = {
    products: PRODUCTS,
    has: function (id) { return !!read()[id]; },
    ids: ids,
    count: function () { return ids().length; },
    total: function () {
      return ids().reduce(function (sum, id) { return sum + PRODUCTS[id].price; }, 0);
    },
    add: function (id) {
      if (!PRODUCTS[id]) return;
      var items = read(); items[id] = true; write(items);
    },
    remove: function (id) {
      if (!PRODUCTS[id]) return;
      var items = read(); items[id] = false; write(items);
    },
    /* Returns {state:'empty'|'ready'|'waiting', url?} */
    checkout: function () {
      var list = ids();
      if (!list.length) return { state: 'empty' };
      if (list.length === 1) return { state: 'ready', url: PRODUCTS[list[0]].url };
      if (COMBINED_URL) return { state: 'ready', url: COMBINED_URL };
      return { state: 'waiting' };
    }
  };

  /* Keep tabs consistent when the page is restored from bfcache. */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) document.dispatchEvent(new CustomEvent('wvcart:change'));
  });
})();
