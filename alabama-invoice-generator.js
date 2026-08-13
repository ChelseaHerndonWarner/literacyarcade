/* ============================================================================
   Alabama CHOOSE Act invoice generator
   ----------------------------------------------------------------------------
   Powers the "Request a CHOOSE Act Invoice" modal on alabama-choose-act.html.
   Depends on:
     - alabama-invoice-config.js  (must load first — window.AlabamaInvoiceConfig)
     - jsPDF UMD build            (must load first — window.jspdf.jsPDF)

   Version 1 scope (see conversation report for full detail):
     - Client-side only. No server, no stored credentials, no secrets here.
     - Generates a PDF invoice for one of two eligible annual plans.
     - Does not persist invoice requests anywhere and does not email the PDF.
     - Collects no email address — the form only asks for the parent name,
       the student name tied to the ClassWallet payment, and a plan.
   ============================================================================ */
(function () {
  'use strict';

  const CONFIG = window.AlabamaInvoiceConfig;
  if (!CONFIG) {
    console.error('Alabama invoice generator: missing AlabamaInvoiceConfig.');
    return;
  }

  const SESSION_KEY = 'laAlInvoiceNumbers';

  /* ── Sanitization helpers ────────────────────────────────────────────────
     Values are only ever placed into the page via textContent (never
     innerHTML) and into the PDF via jsPDF's text APIs (never HTML), so
     script injection isn't reachable through these fields either way.
     Stripping angle brackets and collapsing whitespace is defense in depth,
     plus it keeps stray markup out of a document meant to look official. ── */
  function sanitizeText(value, maxLength) {
    const cleaned = String(value == null ? '' : value)
      .replace(/[<>]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return typeof maxLength === 'number' ? cleaned.slice(0, maxLength) : cleaned;
  }

  /* ── Unique invoice numbers ──────────────────────────────────────────────
     No backend exists to hand out a persistent sequential counter (that
     would need a database + write endpoint). A sequential counter kept in
     the browser (e.g. localStorage) would also silently collide across
     different devices/browsers/incognito sessions and reset if storage is
     cleared, producing duplicate invoice numbers — worse than not having
     one. Instead we generate a cryptographically random suffix per invoice
     (8 base-36 characters ≈ 2.8×10^12 possibilities), which does not
     require any coordination and is unique for all practical purposes.
     A sessionStorage check adds a second, essentially redundant guard
     against generating the same number twice in one browser session. ── */
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

  /* ── Service dates ───────────────────────────────────────────────────── */
  function getServiceDates() {
    const start = new Date();
    const end = new Date(`${CONFIG.program.serviceEndDate}T00:00:00`);
    return { start, end };
  }

  function formatDate(date) {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function isProgramYearActive() {
    const { start, end } = getServiceDates();
    return start.getTime() <= end.getTime();
  }

  /* ── Plan lookup ─────────────────────────────────────────────────────── */
  function getPlanById(id) {
    return CONFIG.plans.find((plan) => plan.id === id) || null;
  }

  /* ── DOM references (resolved lazily so this file can load in <head> or
        before the modal markup without ordering issues) ────────────────── */
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

  function renderPlanOptions() {
    const { planOptions } = getEls();
    if (!planOptions || planOptions.dataset.rendered) return;
    planOptions.innerHTML = CONFIG.plans
      .map(
        (plan) => `
        <label class="ia-plan-option">
          <input type="radio" name="plan" value="${plan.id}" />
          <span class="ia-plan-option-body">
            <span class="ia-plan-option-top">
              <span class="ia-plan-name">${plan.name}</span>
              <span class="ia-plan-price">${plan.priceLabel}</span>
            </span>
            <span class="ia-plan-sub">${plan.billingLabel} · price set by Literacy Arcade, not editable</span>
          </span>
        </label>`
      )
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
      setFieldError(studentName, studentNameError, 'Enter the student name associated with this ClassWallet payment.');
      valid = false;
      firstInvalid = firstInvalid || studentName;
    } else {
      setFieldError(studentName, studentNameError, '');
    }

    const planInput = form.querySelector('input[name="plan"]:checked');
    const plan = planInput ? getPlanById(planInput.value) : null;
    if (!plan) {
      planError.textContent = 'Choose a subscription plan.';
      planError.hidden = false;
      valid = false;
      firstInvalid = firstInvalid || (form.querySelector('input[name="plan"]') || form);
    } else {
      planError.hidden = true;
      planError.textContent = '';
    }

    if (valid && !isProgramYearActive()) {
      generalError.textContent = `This tool generates invoices for the ${CONFIG.program.academicYearLabel} Alabama CHOOSE Act program year, which has ended. Contact Literacy Arcade at ${CONFIG.provider.email} for a current invoice.`;
      generalError.hidden = false;
      valid = false;
      firstInvalid = firstInvalid || form;
    }

    if (!valid) {
      if (firstInvalid) firstInvalid.focus();
      return null;
    }

    return {
      parentName: parentVal,
      studentName: studentVal,
      plan
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

  /* ── Formal, restrained invoice layout ───────────────────────────────────
     White background throughout; navy/teal used only for small labels, a
     divider rule, and the totals line — not as large color fills — so the
     PDF reads as a business invoice rather than a marketing page. ── */
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

    const { start, end } = getServiceDates();
    const invoiceDate = new Date();

    let y = 58;

    /* ── Provider block: logo + legal name + address (top-left) ────────── */
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

    /* ── INVOICE title + meta (top-right, right-aligned) ────────────────── */
    const rightX = pageWidth - margin;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.setTextColor.apply(doc, NAVY);
    doc.text('INVOICE', rightX, y - 12, { align: 'right' });

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text(`Invoice #: ${invoiceNumber}`, rightX, y + 2, { align: 'right' });
    doc.text(`Invoice Date: ${formatDate(invoiceDate)}`, rightX, y + 14, { align: 'right' });

    y = Math.max(providerLineY, y + 14) + 16;

    /* ── Divider rule ────────────────────────────────────────────────────── */
    doc.setDrawColor.apply(doc, TEAL_DK);
    doc.setLineWidth(1.5);
    doc.line(margin, y, margin + contentWidth, y);
    y += 26;

    /* ── Parent / Student block (two columns, wraps for long names) ─────── */
    const colGap = 24;
    const colWidth = (contentWidth - colGap) / 2;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, TEAL_DK);
    doc.text('PARENT / GUARDIAN', margin, y);
    doc.text('STUDENT NAME', margin + colWidth + colGap, y);

    const parentLines = doc.splitTextToSize(data.parentName, colWidth);
    const studentLines = doc.splitTextToSize(data.studentName, colWidth);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor.apply(doc, INK);
    doc.text(parentLines, margin, y + 15);
    doc.text(studentLines, margin + colWidth + colGap, y + 15);

    const nameLineCount = Math.max(parentLines.length, studentLines.length);
    y += 15 + nameLineCount * 13 + 18;

    /* ── Service period (full width) ─────────────────────────────────────── */
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor.apply(doc, TEAL_DK);
    doc.text('SERVICE PERIOD', margin, y);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, INK);
    doc.text(`${formatDate(start)} – ${formatDate(end)}`, margin, y + 15);

    y += 15 + 26;

    /* ── Line-item table ──────────────────────────────────────────────────
       Subtle light-gray header row (not a solid navy/teal fill) keeps the
       table looking like a standard business invoice line-item table. ── */
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

    const wrappedDesc = doc.splitTextToSize(data.plan.description, descColW - 16);
    const rowH = Math.max(52, 26 + wrappedDesc.length * 11.5);
    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(1);
    doc.rect(margin, y, contentWidth, rowH, 'S');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor.apply(doc, INK);
    doc.text(data.plan.name, margin + 10, y + 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, INK_SOFT);
    doc.text(wrappedDesc, margin + 10, y + 32);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor.apply(doc, INK);
    doc.text(data.plan.priceLabel, amountColX - 10, y + 18, { align: 'right' });

    y += rowH + 22;

    /* ── Total due — a clean rule + bold line, not a solid color block ──── */
    doc.setDrawColor.apply(doc, NAVY);
    doc.setLineWidth(1.25);
    doc.line(margin + contentWidth - 220, y, margin + contentWidth, y);
    y += 20;

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.setTextColor.apply(doc, NAVY);
    doc.text('TOTAL DUE', margin + contentWidth - 220, y);
    doc.setFontSize(15);
    doc.text(data.plan.priceLabel, margin + contentWidth, y, { align: 'right' });

    y += 34;

    /* ── Footer note — explicitly not a receipt ──────────────────────────── */
    doc.setDrawColor.apply(doc, BORDER);
    doc.setLineWidth(1);
    doc.line(margin, y, margin + contentWidth, y);
    y += 18;

    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    doc.setTextColor.apply(doc, INK_SOFT);
    const footerNote = doc.splitTextToSize(
      'This invoice is provided for submission to Alabama ClassWallet as a Pay Vendor payment request. No payment has been made to Literacy Arcade at this time.',
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
            els2.successSummary.textContent = `${data.plan.name} · Invoice ${currentInvoiceNumber} · ${data.plan.priceLabel}`;
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
