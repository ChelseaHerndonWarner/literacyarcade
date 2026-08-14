/* ============================================================================
   New Hampshire EFA offering configuration
   ----------------------------------------------------------------------------
   Loaded by new-hampshire-efa.html before new-hampshire-invoice-generator.js.
   Drives THREE things from one source of truth:
     1. The physical-products section on the state page (product cards)
     2. The invoice request modal's selectable items
     3. The generated PDF invoice's line item + description

   This is a flexible OFFERING list, not a hardcoded two-plan list — new
   digital subscriptions or physical products (The Letter Box, Heart Word
   Flash Cards, and anything added later) are added here as one more entry.
   The generator and state-page renderer loop over this array; neither
   contains offering-specific conditional code (no `if id === "letter-box"`)
   so a future product should need a config entry, its own image, and
   (usually) nothing else.

   This file is intentionally separate from alabama-invoice-config.js — New
   Hampshire EFA funds are assigned to an individual student (not a
   household purchase), New Hampshire has no verified fixed program-year
   end date the way Alabama's CHOOSE Act does, and this page additionally
   supports physical products, which Alabama's invoice tool does not. Do
   not change alabama-invoice-config.js to support New Hampshire, and do
   not add New Hampshire-only fields to it.

   FIELD REFERENCE (per offering):
     id                 stable slug, used as the <input value> and in
                         generated invoice line items
     name                display name (state page, modal, PDF)
     type                'digital-subscription' | 'physical-product'
     price               number, or null if no verified price exists yet
                         (never invent a price — see Heart Word Flash Cards)
     priceLabel          formatted string for display, or null to match price
     billingLabel        short subscription/fulfillment label
     invoiceDescription  exact wording printed on the PDF line item
     educationalBlurb    state-page-only description of what the item is for
                         (kept separate from invoiceDescription so page copy
                         can read naturally while the PDF stays formal)
     showOnStatePage     whether this offering's card appears in the
                         "Physical literacy products" section. Only applies
                         to physical-product entries — the two digital plans
                         are shown in their own hand-built pricing cards
                         instead (see new-hampshire-efa.html #plans-compare)
                         for visual parity with the Alabama page, so
                         showOnStatePage is not used to build those cards.
     invoiceEnabled      whether this offering can be selected in the
                         invoice request modal right now. An offering can be
                         showOnStatePage:true and invoiceEnabled:false at the
                         same time (visible, not currently purchasable) —
                         this is how Heart Word Flash Cards is configured
                         while it's unavailable. Flipping availability back
                         on is a one-line config change, not a page rewrite.
     inventoryStatusShown
                         whether an inventory/availability badge ("Sold
                         out", stock counts, etc.) is rendered for this
                         offering. Always false on this page by design — the
                         New Hampshire page is recorded for tutorials and
                         stays evergreen, unlike shop.html which does show
                         live inventory status. The field exists so the
                         renderer never hardcodes that choice per-offering.
     quantityEnabled     whether the invoice line item exposes a quantity
                         selector. False for every current offering (V1 is
                         one offering per invoice — see the generator's
                         header comment on why multi-item / quantity
                         selection was deferred). Kept as a field so a
                         future offering can opt in without a schema change.
     shippingRequired    whether this offering needs its own itemized
                         shipping charge on the invoice. False for every
                         current physical offering: The Letter Box ships
                         free within the U.S. (verified on shop.html) so no
                         separate charge applies, and Heart Word Flash Cards
                         isn't purchasable at all right now. If a future
                         product needs real itemized shipping, that pricing
                         must be verified before this flag is turned on —
                         see the generator's shipping note.
     imagePath           product image, reused as-is from shop.html
     productPageUrl       link to the full product listing for more detail
     displayOrder        sort order within the physical-products grid
     active               master on/off switch for an offering existing at
                         all (state page + invoice). Distinct from
                         invoiceEnabled/showOnStatePage so a retired
                         offering can be hidden everywhere with one flag.

   No secrets belong in this file — it ships to every visitor's browser.
   ============================================================================ */
window.NewHampshireInvoiceConfig = {
  provider: {
    // Formal registered business name — printed on the invoice instead of
    // the shorter "Literacy Arcade" brand name used elsewhere on the site.
    legalName: 'Literacy Arcade LLC',

    // Verified business mailing address (confirmed 2026-08-13, same as used
    // on the Alabama invoice). One printed line per array entry.
    addressLines: ['401 Dove Creek Drive', 'Round Rock, TX 78664'],

    email: 'hello@literacyarcade.com',
    website: 'literacyarcade.com',

    // Logo used in the site header/nav (state-program.css .nav-logo-icon)
    // and as the site favicon/apple-touch-icon — the same square "LA" mark
    // used on the Alabama invoice. No separate full wordmark logo exists in
    // this repo.
    logoPath: 'apple-touch-icon.png'
  },

  program: {
    label: 'New Hampshire EFA'
    // No serviceEndDate here: unlike Alabama's fixed program-year cutoff,
    // New Hampshire EFA funds can roll over while a student remains
    // eligible, and eligibility timing is student-specific. No sufficiently
    // verified universal New Hampshire program-year boundary exists in this
    // repo, so digital-subscription invoices describe a one-year
    // subscription term starting on the invoice date instead of asserting
    // a state program-year window.
  },

  // Prefix for generated invoice numbers, e.g. "LA-NH-2026-<unique suffix>".
  // Update the year portion for future years.
  invoiceNumberPrefix: 'LA-NH-2026',

  // ── Offerings ──────────────────────────────────────────────────────────
  // Source of truth for both digital plans (prices verified against
  // plus-subscriptions.html) and physical products (verified against
  // shop.html, confirmed 2026-08-13). Flag any discrepancy with the live
  // site rather than editing prices silently.
  offerings: [
    {
      id: 'plus-annual',
      name: 'Literacy Arcade Plus Annual',
      type: 'digital-subscription',
      price: 79,
      priceLabel: '$79.00',
      billingLabel: 'One-year digital subscription',
      invoiceDescription: 'Literacy Arcade Plus Annual — one-year educational software subscription supporting literacy instruction for the named EFA student.',
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
      invoiceDescription: 'Literacy Arcade Plus Family Annual — one-year educational software subscription for the named EFA student, including parent/guardian literacy guidance and monthly live group Q&A support.',
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
      // Verified 2026-08-13 against shop.html — price, free U.S. shipping,
      // and Buy button are documented there as final, not a placeholder.
      price: 42,
      priceLabel: '$42.00',
      billingLabel: 'One-time purchase · free U.S. shipping',
      invoiceDescription: 'The Letter Box — hands-on phonics instructional kit for phoneme-grapheme mapping, word building, and reading instruction for the named EFA student.',
      educationalBlurb: 'Hands-on phonics instructional materials for phoneme-grapheme mapping, word building, and reading instruction.',
      showOnStatePage: true,
      invoiceEnabled: true,
      inventoryStatusShown: false,
      quantityEnabled: false,
      // Free U.S. shipping is already folded into the listed price on
      // shop.html — there is no separate itemized shipping charge to
      // represent here.
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
      // No verified price exists — shop.html currently shows this item as
      // sold out with no price. Do not invent one; leave null until a real
      // price is confirmed, at which point invoiceEnabled can be flipped on.
      price: null,
      priceLabel: null,
      billingLabel: null,
      invoiceDescription: 'Heart Word Flash Cards — a physical set of two-sided instructional flash cards for explicit instruction in high-frequency words with irregular spellings, for the student named on the EFA account.',
      // Exact visible copy from shop.html (confirmed 2026-08-13) — kept
      // verbatim so the state page and shop page describe the product
      // identically.
      educationalBlurb: 'A physical set of two-sided flash cards for explicit instruction in high-frequency words with irregular spellings. The heart side identifies the irregular part or parts, while the word side shows the same word without markings for reading practice.',
      showOnStatePage: true,
      // Currently unavailable on shop.html (sold out, no price) — kept
      // un-selectable in the invoice form until that changes. This page
      // itself never displays "Sold out" or similar wording (see
      // inventoryStatusShown); the product is simply not offered as an
      // invoice option and its card links out to the shop for details.
      invoiceEnabled: false,
      inventoryStatusShown: false,
      quantityEnabled: false,
      // Not currently sold, so its shipping treatment isn't verified —
      // left false rather than guessed. Revisit when the product is
      // restocked and priced.
      shippingRequired: false,
      imagePath: 'images/heart-word-flash-cards-product.png',
      productPageUrl: 'shop.html',
      displayOrder: 2,
      active: true
    }
  ]
};
