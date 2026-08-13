/* ============================================================================
   Alabama CHOOSE Act invoice generator — centralized configuration
   ----------------------------------------------------------------------------
   Loaded by alabama-choose-act.html before alabama-invoice-generator.js.
   Edit the values below to update provider info, the program year, or the
   eligible plans/prices without touching the generator or form logic.

   No secrets belong in this file — it ships to every visitor's browser.
   ============================================================================ */
window.AlabamaInvoiceConfig = {
  provider: {
    // Formal registered business name — printed on the invoice instead of
    // the shorter "Literacy Arcade" brand name used elsewhere on the site.
    legalName: 'Literacy Arcade LLC',

    // Verified business mailing address (confirmed 2026-08-13). One printed
    // line per array entry.
    addressLines: ['401 Dove Creek Drive', 'Round Rock, TX 78664'],

    email: 'hello@literacyarcade.com',
    website: 'literacyarcade.com',

    // Logo used in the site header/nav (state-program.css .nav-logo-icon)
    // and as the site favicon/apple-touch-icon — the same square "LA" mark
    // everywhere. No separate full wordmark logo exists in this repo; see
    // the invoice-generator report for details.
    logoPath: 'apple-touch-icon.png'
  },

  program: {
    label: 'Alabama CHOOSE Act',
    academicYearLabel: '2026–27',
    // Outer allowable funding window for this program year is
    // 2026-07-01 through 2027-06-30. Invoices use the generation date as
    // the service start date and this value as the service end date, and
    // the tool refuses to generate invoices once "today" is after this
    // date (the program year config below needs updating first).
    serviceEndDate: '2027-06-30'
  },

  // Prefix for generated invoice numbers, e.g. "LA-AL-2026-<unique suffix>".
  // Update the year portion for future program years.
  invoiceNumberPrefix: 'LA-AL-2026',

  // The ONLY purchases this tool can generate invoices for. Prices are the
  // source of truth from plus-subscriptions.html as of this build — flag any
  // discrepancy with the live site rather than editing prices silently.
  // Intentionally excludes Plus Monthly and all physical products (The
  // Letter Box, Heart Word Flash Cards, etc.).
  plans: [
    {
      id: 'plus-annual',
      name: 'Literacy Arcade Plus Annual',
      price: 79,
      priceLabel: '$79.00',
      billingLabel: 'One-year digital subscription',
      description: 'Literacy Arcade Plus Annual — educational software subscription and literacy instructional resources for the 2026–27 academic year.'
    },
    {
      id: 'plus-family-annual',
      name: 'Literacy Arcade Plus Family Annual',
      price: 99,
      priceLabel: '$99.00',
      billingLabel: 'One-year digital subscription',
      description: 'Literacy Arcade Plus Family Annual — educational software subscription and literacy instructional resources for the 2026–27 academic year.'
    }
  ]
};
