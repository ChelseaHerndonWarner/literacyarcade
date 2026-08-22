/* ============================================================================
   South Carolina ESTF invoice generator + physical-product renderer
   ----------------------------------------------------------------------------
   Powers two things on south-carolina-estf.html, both driven by the single
   offerings list in south-carolina-invoice-config.js:
     1. The "Physical literacy products" card grid (#scProductGrid)
     2. The "Request a South Carolina ESTF Invoice" modal + generated PDF

   Depends on:
     - south-carolina-invoice-config.js  (must load first — window.SouthCarolinaInvoiceConfig)
     - jsPDF UMD build                   (must load first — window.jspdf.jsPDF)

   Adapted from arkansas-invoice-generator.js — same structure, no
   offering-specific conditionals, single offering per invoice (V1 scope).

   South Carolina uses ClassWallet's Pay Vendor process, which requires the
   parent to upload an invoice — unlike Arkansas, there is no vendor-payment-
   request alternative to hedge around here. The PDF footer note below
   describes the parent-uploaded, Pay Vendor path directly.

   Required South Carolina Pay Vendor invoice fields: provider name,
   provider address, student name, parent/guardian name, invoice date,
   date/service information, what the payment is for, and total amount due.
   buildInvoicePdf() below renders all of these. Per South Carolina ESTF
   guidance:
     - Digital plans (Plus Annual / Plus Family Annual) get a SERVICE
       PERIOD line reading "One year beginning upon activation after ESTF
       payment approval" — not a fixed calendar date range, since no
       verified South Carolina program-year boundary exists in this repo.
     - Physical products (The Letter Box) get a FULFILLMENT line describing
       shipping, never a service date — The Letter Box is a one-time
       physical purchase, not a service period. Do not add a literal "Date
       of Service" field to a physical-product invoice.

   Physical-product cards render an out-of-stock status badge
   (statusLabel/statusNote from south-carolina-invoice-config.js) when
   inventoryStatusShown is true and invoiceEnabled is false.

   Client-side only. No server, no stored credentials, no secrets here.
   Does not persist invoice requests anywhere and does not email the PDF.
   ============================================================================ */
(function () {
  'use strict';

  const CONFIG = window.SouthCarolinaInvoiceConfig;
  if (!CONFIG) {
    console.error('South Carolina invoice generator: missing SouthCarolinaInvoiceConfig.');
    return;
  }

  const SESSION_KEY = 'laScInvoiceNumbers';

  /* ── Sanitization helpers ────────────────────────────────────────────────
     Values are only ever placed into the page via textContent (never
     innerHTML) and into the PDF via jsPDF's text APIs (never HTML). ── */
  function sanitizeText(value, maxLength) {
    const cleaned = String(value == null ? '' : value)
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return typeof maxLength === 'number' ? cleaned.slice(0, maxLength) : cleaned;
  }

  /* ── Offering helpers ─────────────────────────────────────────────────── */
  function getActiveOfferings() {
    return CONFIG.offerings
      .filter((o) => o.active)
      .sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0));
  }

  function getOfferingById(id) {
    return CONFIG.offerings.find((o) => o.id === id && o.active) || null;
  }

  function formatPrice(offering) {
    return offering.priceLabel || (typeof offering.price === 'number' ? `$${offering.price.toFixed(2)}` : 'Price not yet available');
  }

  /* ── Physical-product cards on the state page ──────────────────────────── */
  function renderProductCards() {
    const grid = document.getElementById('scProductGrid');
    if (!grid) return;

    const products = getActiveOfferings().filter(
      (o) => o.type === 'physical-product' && o.showOnStatePage
    );

    grid.innerHTML = products
      .map((product) => {
        const priceRow = product.priceLabel
          ? `<div class="sc-product-price">${product.priceLabel}${product.billingLabel ? ` <span>${product.billingLabel}</span>` : ''}</div>`
          : `<div class="sc-product-price sc-product-price-placeholder" aria-hidden="true">&nbsp;</div>`;

        // Out-of-stock status badge — only rendered when the config marks
        // inventoryStatusShown:true (currently just Heart Word Flash
        // Cards). Makes 0-inventory obvious on the card itself rather than
        // relying on the CTA text alone.
        const statusRow =
          product.inventoryStatusShown && product.statusLabel
            ? `<div class="sc-product-status"><span class="sc-product-status-badge">${product.statusLabel}</span>${
                product.statusNote ? `<span class="sc-product-status-note">${product.statusNote}</span>` : ''
              }</div>`
            : '';

        const cta = product.invoiceEnabled
          ? `<button type="button" class="btn btn-primary" data-invoice-trigger data-plan="${product.id}">Request a South Carolina ESTF Invoice →</button>`
          : `<a class="btn btn-quiet" href="${product.productPageUrl}">View product details →</a>`;

        return `
        <article class="sc-product-card">
          <button type="button" class="sc-product-media img-zoom" data-full="${product.imagePath}" aria-label="Enlarge ${product.name} product image">
            <img src="${product.imagePath}" alt="${product.name}" loading="lazy" decoding="async" width="1254" height="1254" />
            <span class="zoom-hint" aria-hidden="true">Click to enlarge</span>
          </button>
          <div class="sc-product-body">
            <h3>${product.name}</h3>
            <p>${product.educationalBlurb || ''}</p>
            ${statusRow}
            ${priceRow}
            <div class="sc-product-actions">${cta}</div>
          </div>
        </article>`;
      })
      .join('');

    if (typeof window.__scBindImgZoom === 'function') {
      window.__scBindImgZoom(grid);
    }
  }

  /* ── Unique invoice numbers ──────────────────────────────────────────────
     Cryptographically random suffix per invoice — see the New Hampshire
     generator's comment for why a sequential/localStorage counter was
     rejected. ── */
  function randomSuffix() {
    const bytes = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(bytes);
    return Array.from(bytes)
      .map((b) => b.toString(36))
      .join('')
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, 'X')
      .slice(0, 8)
      .padEnd(8, '0');
  }

  function getSeenInvoiceNumbers() {
    try {
      const raw = window.sessionStorage.getItem(SESSION_KEY);
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch (err) {
      return new Set();
    }
  }

  function rememberInvoiceNumber(number) {
    try {
      const seen = getSeenInvoiceNumbers();
      seen.add(number);
      window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(seen)));
    } catch (err) {
      /* sessionStorage unavailable (private mode, etc.) — uniqueness still
         holds via the random suffix itself, so this is a soft failure. */
    }
  }

  function generateInvoiceNumber() {
    const seen = getSeenInvoiceNumbers();
    let number;
    let attempts = 0;
    do {
      number = `${CONFIG.invoiceNumberPrefix}-${randomSuffix()}`;
      attempts += 1;
    } while (seen.has(number) && attempts < 10);
    rememberInvoiceNumber(number);
    return number;
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  /* ── DOM references ──────────────────────────────────────────────────── */
  let els = null;
  function getEls() {
    if (els) return els;
    els = {
      overlay: document.getElementById('invoiceModal'),
      closeBtn: document.getElementById('invoiceModalClose'),
      formView: document.getElementById('invoiceFormView'),
      form: document.getElementById('invoiceForm'),
      parentName: document.getElementById('invParentName'),
      parentNameError: document.getElementById('invParentNameError'),
      studentName: document.getElementById('invStudentName'),
      studentNameError: document.getElementById('invStudentNameError'),
      planOptions: document.getElementById('invPlanOptions'),
      planError: document.getElementById('invPlanError'),
      generalError: document.getElementById('invGeneralError'),
      successView: document.getElementById('invoiceSuccessView'),
      downloadBtn: document.getElementById('invoiceDownloadBtn'),
      startOverBtn: document.getElementById('invoiceStartOverBtn'),
      successSummary: document.getElementById('invoiceSuccessSummary')
    };
    return els;
  }

  /* ── Modal offering list — grouped, invoiceEnabled only ── */
  function renderPlanOptions() {
    const { planOptions } = getEls();
    if (!planOptions || planOptions.dataset.rendered) return;

    const selectable = getActiveOfferings().filter((o) => o.invoiceEnabled);
    const groups = [
      { type: 'digital-subscription', label: 'Annual digital plans' },
      { type: 'physical-product', label: 'Physical literacy products' }
    ];

    planOptions.innerHTML = groups
      .map((group) => {
        const items = selectable.filter((o) => o.type === group.type);
        if (!items.length) return '';
        return `
        <div class="ia-plan-group">
          <p class="ia-plan-group-label">${group.label}</p>
          ${items
            .map(
              (offering) => `
            <label class="ia-plan-option">
              <input type="radio" name="plan" value="${offering.id}" />
              <span class="ia-plan-option-body">
                <span class="ia-plan-option-top">
                  <span class="ia-plan-name">${offering.name}</span>
                  <span class="ia-plan-price">${formatPrice(offering)}</span>
                </span>
                <span class="ia-plan-sub">${offering.billingLabel || ''} · price set by Literacy Arcade, not editable</span>
              </span>
            </label>`
            )
            .join('')}
        </div>`;
      })
      .join('');
    planOptions.dataset.rendered = 'true';
  }

  /* ── Field-level validation ──────────────────────────────────────────── */
  function setFieldError(input, errorEl, message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.hidden = false;
      input.setAttribute('aria-invalid', 'true');
    } else {
      errorEl.textContent = '';
      errorEl.hidden = true;
      input.removeAttribute('aria-invalid');
    }
  }

  function validateForm() {
    const { parentName, parentNameError, studentName, studentNameError, form, planError, generalError } = getEls();
    let firstInvalid = null;
    let valid = true;

    generalError.hidden = true;
    generalError.textContent = '';

    // Student name and parent/guardian name are both required, for every
    // offering type — including physical products — per South Carolina
    // Pay Vendor invoice requirements. Do not make either field conditional
    // by offering.type.
    const parentVal = sanitizeText(parentName.value, 80);
    if (!parentVal) {
      setFieldError(parentName, parentNameError, 'Enter the parent or guardian name.');
      valid = false;
      firstInvalid = firstInvalid || parentName;
    } else {
      setFieldError(parentName, parentNameError, '');
    }

    const studentVal = sanitizeText(studentName.value, 80);
    if (!studentVal) {
      setFieldError(studentName, studentNameError, 'Enter the student name on the South Carolina ESTF account.');
      valid = false;
      firstInvalid = firstInvalid || studentName;
    } else {
      setFieldError(studentName, studentNameError, '');
    }

    const planInput = form.querySelector('input[name="plan"]:checked');
    const offering = planInput ? getOfferingById(planInput.value) : null;
    if (!offering || !offering.invoiceEnabled) {
      planError.textContent = 'Choose a subscription plan or eligible product.';
      planError.hidden = false;
      valid = false;
      firstInvalid = firstInvalid || (form.querySelector('input[name="plan"]') || form);
    } else {
      planError.hidden = true;
      planError.textContent = '';
    }

    if (!valid) {
      if (firstInvalid) firstInvalid.focus();
      return null;
    }

    return {
      parentName: parentVal,
      studentName: studentVal,
      offering
    };
  }

  /* ── PDF generation ──────────────────────────────────────────────────── */
  function loadImageAsDataUrl(src) {
    return fetch(src)
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error('logo fetch failed'))))
      .then(
        (blob) =>
          new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          })
      )
      .catch(() => null);
  }

  function buildInvoicePdf(data, invoiceNumber, logoDataUrl) {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'pt', format: 'letter' });
    const pageWidth = doc.internal.pageSize.getWidth();
    const margin = 54;
    const contentWidth = pageWidth - margin * 2;

    const NAVY = [26, 26, 46];
    const INK = [26, 26, 46];
    const INK_SOFT = [74, 74, 106];
    const TEAL_DK = [31, 169, 156];
    const BORDER = [214, 210, 224];
    const HEADER_FILL = [246, 245, 249];

    const invoiceDate = new Date();
    const isSubscription = data.offering.type === 'digital-subscription';

    let y = 58;

    // ── Provider block: logo + legal name + address (top-left). Provider
    // name and address are both required fields on a South Carolina Pay
    // Vendor invoice. ──
    const logoSize = 40;
    let providerTextX = margin;
    if (logoDataUrl) {
      try {
        doc.addImage(logoDataUrl, 'PNG', margin, y - 28, logoSize, logoSize);
        providerTextX = margin + logoSize + 12;
      } catch (err) {
        /* fall back silently to text-only provider block */
      }
    }

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor.apply(doc, INK);
    doc.text(CONFIG.provider.legalName, providerTextX, y - 12);

    let providerLineY = y + 2;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor.apply(doc, INK_SOFT);
    (CONFIG.provider.addressLines || []).forEach((line) => {
      doc.text(line, providerTextX, providerLineY);
      providerLineY += 12;
    });

    const rightX = pageWidth - margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor.apply(doc, NAVY);
    doc.text('INVOICE', rightX, y - 12, { align: 'right' });

    // Invoice date is generated automatically from the current date — not
    // collected from the parent.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text(`Invoice #: ${invoiceNumber}`, rightX, y + 2, { align: 'right' });
    doc.text(`Invoice Date: ${formatDate(invoiceDate)}`, rightX, y + 14, { align: 'right' });

    y = Math.max(providerLineY, y + 14) + 16;

    doc.setDrawColor.apply(doc, TEAL_DK);
    doc.setLineWidth(1.5);
    doc.line(margin, y, margin + contentWidth, y);
    y += 26;

    // ── Parent / Student block — both required for every offering type,
    // including physical products (South Carolina Pay Vendor requirement,
    // not conditional by offering.type). ──
    const colGap = 24;
    const colWidth = (contentWidth - colGap) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, TEAL_DK);
    doc.text('PARENT / GUARDIAN', margin, y);
    doc.text('STUDENT NAME (ESTF ACCOUNT)', margin + colWidth + colGap, y);

    const parentLines = doc.splitTextToSize(data.parentName, colWidth);
    const studentLines = doc.splitTextToSize(data.studentName, colWidth);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor.apply(doc, INK);
    doc.text(parentLines, margin, y + 15);
    doc.text(studentLines, margin + colWidth + colGap, y + 15);

    const nameLineCount = Math.max(parentLines.length, studentLines.length);
    y += 15 + nameLineCount * 13 + 18;

    // ── Service/fulfillment block — differs by offering type. Digital
    // plans get an access-period statement (no invented calendar dates);
    // physical products get fulfillment/shipping language, never a
    // service date. Do not add a literal "Date of Service" line here for
    // The Letter Box or any other physical product. ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, TEAL_DK);
    doc.text(isSubscription ? 'SERVICE PERIOD' : 'FULFILLMENT', margin, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, INK);
    if (isSubscription) {
      doc.text('One year beginning upon activation after ESTF payment approval', margin, y + 15);
    } else {
      const shippingLine = data.offering.shippingRequired
        ? 'Ships to the address provided at activation after ESTF payment approval; shipping is itemized separately.'
        : 'Ships free within the U.S. after ESTF payment approval.';
      doc.text(shippingLine, margin, y + 15);
    }

    y += 15 + 26;

    // ── Line-item table — item name/description ("what the payment is
    // for") and itemized amount. ──
    const descColW = contentWidth * 0.7;
    const amountColX = margin + contentWidth;

    doc.setFillColor.apply(doc, HEADER_FILL);
    doc.rect(margin, y, contentWidth, 22, 'F');
    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(1);
    doc.rect(margin, y, contentWidth, 22, 'S');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text('DESCRIPTION', margin + 10, y + 15);
    doc.text('AMOUNT', amountColX - 10, y + 15, { align: 'right' });

    y += 22;

    const wrappedDesc = doc.splitTextToSize(data.offering.invoiceDescription, descColW - 16);
    const rowH = Math.max(52, 26 + wrappedDesc.length * 11.5);
    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(1);
    doc.rect(margin, y, contentWidth, rowH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, INK);
    doc.text(data.offering.name, margin + 10, y + 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text(wrappedDesc, margin + 10, y + 32);

    const priceLabel = formatPrice(data.offering);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor.apply(doc, INK);
    doc.text(priceLabel, amountColX - 10, y + 18, { align: 'right' });

    y += rowH + 22;

    // ── Total due ──
    doc.setDrawColor.apply(doc, NAVY);
    doc.setLineWidth(1.25);
    doc.line(margin + contentWidth - 220, y, margin + contentWidth, y);
    y += 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor.apply(doc, NAVY);
    doc.text('TOTAL DUE', margin + contentWidth - 220, y);
    doc.setFontSize(15);
    doc.text(priceLabel, margin + contentWidth, y, { align: 'right' });

    y += 34;

    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + contentWidth, y);
    y += 18;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, INK_SOFT);
    // South Carolina uses ClassWallet Pay Vendor, which requires the parent
    // to upload the invoice themselves — stated directly, no hedging.
    const footerNote = doc.splitTextToSize(
      'This invoice is provided for the parent or guardian to upload through Pay Vendor in the student’s South Carolina ESTF ClassWallet account. Eligible educational expenses remain subject to South Carolina ESTF review. No payment has been made to Literacy Arcade at this time.',
      contentWidth
    );
    doc.text(footerNote, margin, y);
    y += footerNote.length * 12 + 10;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text(`Invoice ${invoiceNumber} · Generated ${formatDate(invoiceDate)} · ${CONFIG.provider.website} · ${CONFIG.provider.email}`, margin, y);

    return doc;
  }

  /* ── Modal open/close + focus trap ───────────────────────────────────── */
  let lastTrigger = null;

  function getFocusable(container) {
    return Array.from(
      container.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
    ).filter((el) => el.offsetParent !== null);
  }

  function trapFocus(event) {
    const { overlay } = getEls();
    if (overlay.hidden || event.key !== 'Tab') return;
    const focusable = getFocusable(overlay);
    if (!focusable.length) return;
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

  function resetForm() {
    const { form, formView, successView, generalError, planError } = getEls();
    form.reset();
    [...form.querySelectorAll('.ia-error')].forEach((el) => {
      el.hidden = true;
      el.textContent = '';
    });
    [...form.querySelectorAll('input')].forEach((el) => el.removeAttribute('aria-invalid'));
    generalError.hidden = true;
    planError.hidden = true;
    formView.hidden = false;
    successView.hidden = true;
  }

  function openModal(triggerEl) {
    const { overlay, form, parentName } = getEls();
    renderPlanOptions();
    resetForm();
    lastTrigger = triggerEl || document.activeElement;

    const preselectPlanId = triggerEl && triggerEl.dataset ? triggerEl.dataset.plan : null;
    if (preselectPlanId) {
      const radio = form.querySelector(`input[name="plan"][value="${preselectPlanId}"]`);
      if (radio) radio.checked = true;
    }

    overlay.hidden = false;
    document.body.style.overflow = 'hidden';
    parentName.focus();
  }

  function closeModal() {
    const { overlay } = getEls();
    overlay.hidden = true;
    document.body.style.overflow = '';
    if (lastTrigger && typeof lastTrigger.focus === 'function') lastTrigger.focus();
  }

  /* ── Wire everything up once the DOM is ready ────────────────────────── */
  document.addEventListener('DOMContentLoaded', () => {
    renderProductCards();

    const els2 = getEls();
    if (!els2.overlay) return; // modal markup not present on this page

    renderPlanOptions();

    document.querySelectorAll('[data-invoice-trigger]').forEach((trigger) => {
      trigger.addEventListener('click', () => openModal(trigger));
    });

    els2.closeBtn.addEventListener('click', closeModal);
    els2.overlay.addEventListener('click', (event) => {
      if (event.target === els2.overlay) closeModal();
    });
    els2.startOverBtn.addEventListener('click', () => {
      resetForm();
      els2.parentName.focus();
    });

    document.addEventListener('keydown', (event) => {
      if (els2.overlay.hidden) return;
      if (event.key === 'Escape') closeModal();
      trapFocus(event);
    });

    let currentDoc = null;
    let currentInvoiceNumber = null;

    els2.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const data = validateForm();
      if (!data) return;

      const submitBtn = els2.form.querySelector('.ia-submit');
      submitBtn.disabled = true;
      const originalLabel = submitBtn.textContent;
      submitBtn.textContent = 'Generating your invoice…';

      const finish = (logoDataUrl) => {
        try {
          currentInvoiceNumber = generateInvoiceNumber();
          currentDoc = buildInvoicePdf(data, currentInvoiceNumber, logoDataUrl);

          if (els2.successSummary) {
            els2.successSummary.textContent = `${data.offering.name} · Invoice ${currentInvoiceNumber} · ${formatPrice(data.offering)}`;
          }

          els2.formView.hidden = true;
          els2.successView.hidden = false;
          els2.downloadBtn.focus();
        } catch (err) {
          console.error('Invoice PDF generation failed:', err);
          els2.generalError.textContent = 'Something went wrong generating the PDF. Please try again, or contact us if the problem continues.';
          els2.generalError.hidden = false;
        } finally {
          submitBtn.disabled = false;
          submitBtn.textContent = originalLabel;
        }
      };

      if (!window.jspdf || !window.jspdf.jsPDF) {
        els2.generalError.textContent = 'The PDF tool did not load. Please check your connection and try again.';
        els2.generalError.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
        return;
      }

      loadImageAsDataUrl(CONFIG.provider.logoPath).then(finish);
    });

    els2.downloadBtn.addEventListener('click', () => {
      if (!currentDoc || !currentInvoiceNumber) return;
      currentDoc.save(`Literacy-Arcade-Invoice-${currentInvoiceNumber}.pdf`);
    });
  });
})();
