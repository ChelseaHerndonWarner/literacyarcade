/* ============================================================================
   Arkansas EFA offering configuration
   ----------------------------------------------------------------------------
   Loaded by arkansas-efa.html before arkansas-invoice-generator.js.
   Drives THREE things from one source of truth:
     1. The physical-products section on the state page (product cards)
     2. The invoice request modal's selectable items
     3. The generated PDF invoice's line item + description

   Cloned from new-hampshire-invoice-config.js and adapted for Arkansas.
   Offering data (price, description, image, availability) for The Letter Box
   and Heart Word Flash Cards is copied verbatim from
   new-hampshire-invoice-config.js / shop.html — not re-derived from memory.
   Heart Word Flash Cards stays invoiceEnabled:false (sold out / no verified
   price) until real inventory + pricing exist; do not flip this on without
   confirming stock.

   FIELD REFERENCE: see new-hampshire-invoice-config.js for the base schema.
   Two Arkansas-only fields, used solely by renderProductCards() in
   arkansas-invoice-generator.js:
     statusLabel   short out-of-stock badge text shown on a product card
                   when inventoryStatusShown is true and invoiceEnabled is
                   false (e.g. "Temporarily Out of Stock"). Unlike the New
                   Hampshire page (which never shows stock wording because
                   it's recorded for evergreen tutorials), this Arkansas
                   page intentionally shows a clear status so a family
                   doesn't try to invoice a 0-inventory product.
     statusNote    short supporting line under statusLabel (e.g. "More
                   arriving soon.").

   ClassWallet Arkansas EFA note — VERIFIED against the 2026–27 Arkansas EFA
   Family Training: ClassWallet lets approved vendors send payment requests
   to linked families "in lieu of an invoice," but the traditional
   parent-uploaded invoice process still exists and is what the family
   training tells parents to use. Literacy Arcade's primary purchase path
   stays the parent-submitted invoice (generate here, then upload through
   ClassWallet) — the invoiceDescription/footer text in
   arkansas-invoice-generator.js reflects that. Do not revert to vague
   "check ClassWallet for current options" wording.

   No secrets belong in this file — it ships to every visitor's browser.
   ============================================================================ */
window.ArkansasInvoiceConfig = {
  provider: {
    legalName: 'Literacy Arcade LLC',
    addressLines: ['401 Dove Creek Drive', 'Round Rock, TX 78664'],
    email: 'hello@literacyarcade.com',
    website: 'literacyarcade.com',
    logoPath: 'apple-touch-icon.png'
  },

  program: {
    label: 'Arkansas EFA'
    // No serviceEndDate here: no verified fixed Arkansas EFA program-year
    // cutoff exists in this repo, so digital-subscription invoices describe
    // a one-year subscription term starting on the invoice date instead of
    // asserting a state program-year window.
  },

  // Prefix for generated invoice numbers, e.g. "LA-AR-2026-<unique suffix>".
  invoiceNumberPrefix: 'LA-AR-2026',

  // ── Offerings ──────────────────────────────────────────────────────────
  offerings: [
    {
      id: 'plus-annual',
      name: 'Literacy Arcade Plus Annual',
      type: 'digital-subscription',
      price: 79,
      priceLabel: '$79.00',
      billingLabel: 'One-year digital subscription',
      invoiceDescription: 'Literacy Arcade Plus Annual — one-year educational software subscription supporting literacy instruction for the named Arkansas EFA student.',
      showOnStatePage: false,
      invoiceEnabled: true,
      inventoryStatusShown: false,
      quantityEnabled: false,
      shippingRequired: false,
      imagePath: null,
      productPageUrl: 'plus-subscriptions.html#plus-plans',
      displayOrder: 1,
      active: true
    },
    {
      id: 'plus-family-annual',
      name: 'Literacy Arcade Plus Family Annual',
      type: 'digital-subscription',
      price: 99,
      priceLabel: '$99.00',
      billingLabel: 'One-year digital subscription',
      invoiceDescription: 'Literacy Arcade Plus Family Annual — one-year educational software subscription for the named Arkansas EFA student, including parent/guardian literacy guidance and monthly live group Q&A support.',
      showOnStatePage: false,
      invoiceEnabled: true,
      inventoryStatusShown: false,
      quantityEnabled: false,
      shippingRequired: false,
      imagePath: null,
      productPageUrl: 'plus-subscriptions.html#plus-plans',
      displayOrder: 2,
      active: true
    },
    {
      id: 'letter-box',
      name: 'The Letter Box',
      type: 'physical-product',
      // Data verified against shop.html / new-hampshire-invoice-config.js —
      // price, free U.S. shipping, and Buy button are documented there as
      // final, not a placeholder.
      price: 42,
      priceLabel: '$42.00',
      billingLabel: 'One-time purchase · free U.S. shipping',
      invoiceDescription: 'The Letter Box — hands-on phonics instructional kit for phoneme-grapheme mapping, word building, and reading instruction for the named Arkansas EFA student.',
      educationalBlurb: 'Hands-on phonics instructional materials for phoneme-grapheme mapping, word building, and reading instruction.',
      showOnStatePage: true,
      invoiceEnabled: true,
      inventoryStatusShown: false,
      shippingRequired: false,
      imagePath: 'images/letter-box-product-infographic.png',
      productPageUrl: 'shop.html',
      displayOrder: 1,
      active: true
    },
    {
      id: 'heart-word-flash-cards',
      name: 'Heart Word Flash Cards',
      type: 'physical-product',
      // No verified price exists — shop.html currently shows this item sold
      // out with no price and 0 available inventory. Do not invent a price;
      // leave null until real stock/pricing is confirmed, at which point
      // invoiceEnabled can be flipped on.
      price: null,
      priceLabel: null,
      billingLabel: null,
      invoiceDescription: 'Heart Word Flash Cards — a physical set of two-sided instructional flash cards for explicit instruction in high-frequency words with irregular spellings, for the student named on the Arkansas EFA account.',
      // Exact visible copy from shop.html — kept verbatim so the state page
      // and shop page describe the product identically.
      educationalBlurb: 'A physical set of two-sided flash cards for explicit instruction in high-frequency words with irregular spellings. The heart side identifies the irregular part or parts, while the word side shows the same word without markings for reading practice.',
      showOnStatePage: true,
      // Inventory is 0 — kept un-selectable in the invoice form until
      // restocked and priced. Unlike the New Hampshire page (which never
      // shows stock wording), this page DOES show a clear out-of-stock
      // status on the card itself — see inventoryStatusShown/statusLabel/
      // statusNote below and renderProductCards() in
      // arkansas-invoice-generator.js.
      invoiceEnabled: false,
      inventoryStatusShown: true,
      statusLabel: 'Temporarily Out of Stock',
      statusNote: 'More arriving soon.',
      quantityEnabled: false,
      shippingRequired: false,
      imagePath: 'images/heart-word-flash-cards-product.png',
      productPageUrl: 'shop.html',
      displayOrder: 2,
      active: true
    }
  ]
};
