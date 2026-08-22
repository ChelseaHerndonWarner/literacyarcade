/* ============================================================================
   South Carolina ESTF offering configuration
   ----------------------------------------------------------------------------
   Loaded by south-carolina-estf.html before south-carolina-invoice-generator.js.
   Drives THREE things from one source of truth:
     1. The physical-products section on the state page (product cards)
     2. The invoice request modal's selectable items
     3. The generated PDF invoice's line item + description

   Adapted from arkansas-invoice-config.js — same schema and pattern, with
   South Carolina ESTF branding, invoice-number prefix, and
   invoice/fulfillment wording. Offering data (price, description, image,
   availability) for The Letter Box and Heart Word Flash Cards is copied
   verbatim from arkansas-invoice-config.js / shop.html — not re-derived
   from memory. Heart Word Flash Cards stays invoiceEnabled:false (sold out,
   0 inventory) until real stock exists; do not flip this on without
   confirming stock.

   FIELD REFERENCE: see new-hampshire-invoice-config.js for the base schema
   and arkansas-invoice-config.js for the statusLabel/statusNote fields
   (out-of-stock badge text, used by renderProductCards() in
   south-carolina-invoice-generator.js).

   South Carolina ESTF / ClassWallet Pay Vendor note: South Carolina uses
   ClassWallet's Pay Vendor process, which requires the parent to upload an
   invoice — there is no ambiguity here the way there was for Arkansas's
   vendor-payment-request option, so this file and the generator describe
   the parent-uploaded invoice as the one purchasing path, without hedging
   language.

   Required South Carolina Pay Vendor invoice fields (per South Carolina
   Pay Vendor guidance): provider name, provider address, student name,
   parent/guardian name, invoice date, date/service information, what the
   payment is for, and total amount due. See south-carolina-invoice-
   generator.js's buildInvoicePdf() for how each of these is rendered —
   digital plans get an access-period statement instead of a fixed date
   range, and physical products get fulfillment/shipping language instead
   of an invented service date. Do not add a literal "Date of Service"
   field to a physical-product invoice.

   No secrets belong in this file — it ships to every visitor's browser.
   ============================================================================ */
window.SouthCarolinaInvoiceConfig = {
  provider: {
    // Same verified business identity used by the Arkansas and New
    // Hampshire invoice tools — see arkansas-invoice-config.js. Do not
    // invent a different address for South Carolina.
    legalName: 'Literacy Arcade LLC',
    addressLines: ['401 Dove Creek Drive', 'Round Rock, TX 78664'],
    email: 'hello@literacyarcade.com',
    website: 'literacyarcade.com',
    logoPath: 'apple-touch-icon.png'
  },

  program: {
    label: 'South Carolina ESTF'
    // No serviceEndDate here: no verified fixed South Carolina ESTF
    // program-year cutoff exists in this repo, so digital-subscription
    // invoices describe a one-year access period beginning upon
    // activation after ESTF payment approval, instead of asserting a
    // state program-year window or a specific calendar date range.
  },

  // Prefix for generated invoice numbers, e.g. "LA-SC-2026-<unique suffix>".
  invoiceNumberPrefix: 'LA-SC-2026',

  // ── Offerings ──────────────────────────────────────────────────────────
  offerings: [
    {
      id: 'plus-annual',
      name: 'Literacy Arcade Plus Annual',
      type: 'digital-subscription',
      price: 79,
      priceLabel: '$79.00',
      billingLabel: 'One year of access',
      invoiceDescription: 'Literacy Arcade Plus Annual — one-year Literacy Arcade online educational access supporting literacy instruction for the named South Carolina ESTF student.',
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
      billingLabel: 'One year of access',
      invoiceDescription: 'Literacy Arcade Plus Family Annual — one-year Literacy Arcade online educational access for the named South Carolina ESTF student, including parent/guardian literacy guidance and monthly live group Q&A support.',
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
      // Data verified against shop.html / arkansas-invoice-config.js —
      // price, free U.S. shipping, and Buy button are documented there as
      // final, not a placeholder.
      price: 42,
      priceLabel: '$42.00',
      billingLabel: 'One-time purchase · free U.S. shipping',
      invoiceDescription: 'The Letter Box — hands-on phonics instructional kit for phoneme-grapheme mapping, word building, and reading instruction for the named South Carolina ESTF student.',
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
      invoiceDescription: 'Heart Word Flash Cards — a physical set of two-sided instructional flash cards for explicit instruction in high-frequency words with irregular spellings, for the student named on the South Carolina ESTF account.',
      // Exact visible copy from shop.html — kept verbatim so the state page
      // and shop page describe the product identically.
      educationalBlurb: 'A physical set of two-sided flash cards for explicit instruction in high-frequency words with irregular spellings. The heart side identifies the irregular part or parts, while the word side shows the same word without markings for reading practice.',
      showOnStatePage: true,
      // Inventory is 0 — kept un-selectable in the invoice form until
      // restocked and priced. This page shows a clear out-of-stock status
      // on the card itself — see statusLabel/statusNote and
      // renderProductCards() in south-carolina-invoice-generator.js.
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
