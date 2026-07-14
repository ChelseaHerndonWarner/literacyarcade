// Shared paid-entitlement gate for assessment "Print Report" buttons.
// Source of truth: Firestore users/{uid}.plan, synced from Stripe by
// functions/index.js (syncUserPlanFromStripeSubscription). Do not duplicate
// that logic here — this module only reads the resolved `plan` field.
// Self-contained styling (hardcoded brand tokens), same approach as
// activity-save-guard.js, so it renders consistently regardless of the
// host page's own CSS variable names.

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const PAID_PLANS = new Set(['plus', 'family']);
const PLUS_PLANS_URL = 'plus-subscriptions.html';
const LOGIN_URL = 'teacher-login.html';
const DASHBOARD_URL = 'teacher-dashboard.html';

let currentUser = null;
let resolveAuthReady;
const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
let authReadyDone = false;

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  if (!authReadyDone) {
    authReadyDone = true;
    resolveAuthReady();
  }
});

function track(eventName) {
  try {
    if (typeof window.gtag === 'function') window.gtag('event', eventName);
  } catch (e) { /* analytics must never block printing */ }
}

function returnToParam() {
  const path = `${window.location.pathname.split('/').pop()}${window.location.search}`;
  return encodeURIComponent(path || DASHBOARD_URL);
}

async function getEntitlement() {
  await authReady;
  if (!currentUser) return { status: 'signed-out' };
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    const plan = snap.exists() ? (snap.data().plan || 'free') : 'free';
    return { status: PAID_PLANS.has(plan) ? 'paid' : 'free', plan };
  } catch (err) {
    console.warn('Literacy Arcade report gate: could not confirm entitlement.', err);
    return { status: 'unknown' };
  }
}

/* ---------------- shared modal ---------------- */

const STYLE_ID = 'la-report-gate-styles';
const MODAL_ID = 'la-report-gate-modal';
let triggerEl = null;
let keydownHandler = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${MODAL_ID}-backdrop {
  position: fixed; inset: 0; background: rgba(27,42,74,.45);
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; padding: 20px;
}
#${MODAL_ID} {
  width: min(460px, 100%); background: #fff; border: 1px solid #EEE8F8;
  border-radius: 16px; box-shadow: 0 18px 60px rgba(27,42,74,.25);
  overflow: hidden; font-family: 'Nunito', sans-serif; color: #1B2A4A;
}
#${MODAL_ID}-head { padding: 20px 22px 0; position: relative; }
#${MODAL_ID}-close {
  position: absolute; top: 14px; right: 14px; width: 32px; height: 32px;
  border-radius: 50%; border: 0; background: transparent; color: #4B5875;
  font-size: 18px; font-weight: 900; cursor: pointer; line-height: 1;
}
#${MODAL_ID}-close:hover { background: #F1EFFA; }
#${MODAL_ID}-title {
  font-family: 'Nunito', sans-serif; font-size: 20px; font-weight: 900;
  line-height: 1.25; margin: 0; padding-right: 28px;
}
#${MODAL_ID}-body { padding: 12px 22px 22px; display: flex; flex-direction: column; gap: 12px; }
#${MODAL_ID}-text p { font-size: 14px; font-weight: 600; line-height: 1.55; color: #4B5875; margin: 0; }
#${MODAL_ID}-actions { display: flex; flex-direction: column; gap: 9px; margin-top: 4px; }
#${MODAL_ID}-actions a,
#${MODAL_ID}-actions button {
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; min-height: 44px; padding: 10px 14px;
  font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14px;
  cursor: pointer; border: 0; text-decoration: none; box-sizing: border-box;
}
.la-rg-primary { background: #2EC4B6; color: #fff; }
.la-rg-primary:hover { background: #087A70; }
.la-rg-secondary { background: #fff; color: #087A70; border: 1.5px solid #2EC4B6 !important; }
.la-rg-secondary:hover { background: #EAF7E7; }
.la-rg-link {
  display: inline-flex; align-items: center; justify-content: center;
  min-height: 44px; font-size: 13px; font-weight: 800; color: #6A4F92;
  text-decoration: underline; cursor: pointer; background: none; border: 0;
}
@media (max-width: 360px) {
  #${MODAL_ID}-backdrop { padding: 12px; }
  #${MODAL_ID}-title { font-size: 18px; }
}
`;
  document.head.appendChild(style);
}

function trapFocus(event) {
  const modal = document.getElementById(MODAL_ID);
  if (!modal) return;
  if (event.key === 'Escape') {
    closeModal();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = modal.querySelectorAll('a[href], button:not([disabled])');
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

function closeModal() {
  const backdrop = document.getElementById(`${MODAL_ID}-backdrop`);
  if (backdrop) backdrop.remove();
  if (keydownHandler) {
    document.removeEventListener('keydown', keydownHandler);
    keydownHandler = null;
  }
  if (triggerEl && typeof triggerEl.focus === 'function') triggerEl.focus();
  triggerEl = null;
}

function renderModal({ heading, body, primary, secondary, link }) {
  ensureStyles();
  const existing = document.getElementById(`${MODAL_ID}-backdrop`);
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = `${MODAL_ID}-backdrop`;

  const actionHtml = (action, className) => {
    if (!action) return '';
    if (action.href) {
      return `<a class="${className}" href="${action.href}">${action.label}</a>`;
    }
    return `<button type="button" class="${className}" id="${MODAL_ID}-${action.key}">${action.label}</button>`;
  };

  backdrop.innerHTML = `
    <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <div id="${MODAL_ID}-head">
        <h2 id="${MODAL_ID}-title">${heading}</h2>
        <button type="button" id="${MODAL_ID}-close" aria-label="Close">&times;</button>
      </div>
      <div id="${MODAL_ID}-body">
        <div id="${MODAL_ID}-text"><p>${body}</p></div>
        <div id="${MODAL_ID}-actions">
          ${actionHtml(primary, 'la-rg-primary')}
          ${actionHtml(secondary, 'la-rg-secondary')}
          ${link ? `<button type="button" class="la-rg-link" id="${MODAL_ID}-link">${link.label}</button>` : ''}
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) closeModal(); });
  document.getElementById(`${MODAL_ID}-close`).addEventListener('click', closeModal);

  if (primary && primary.onClick) {
    document.getElementById(`${MODAL_ID}-${primary.key}`).addEventListener('click', primary.onClick);
  }
  if (secondary && secondary.onClick) {
    document.getElementById(`${MODAL_ID}-${secondary.key}`).addEventListener('click', secondary.onClick);
  }
  if (link && link.onClick) {
    document.getElementById(`${MODAL_ID}-link`).addEventListener('click', link.onClick);
  }

  keydownHandler = trapFocus;
  document.addEventListener('keydown', keydownHandler);

  const focusTarget = document.getElementById(`${MODAL_ID}-close`);
  setTimeout(() => {
    const firstAction = backdrop.querySelector('.la-rg-primary, .la-rg-secondary');
    (firstAction || focusTarget).focus();
  }, 0);
}

function openSignedOutModal() {
  renderModal({
    heading: 'Print complete reports with Literacy Arcade Plus',
    body: 'Sign in to check your account or choose a Plus plan to access complete assessment reports, skill analysis, and instructional next-step guidance.',
    primary: { key: 'primary', label: 'Sign in', href: `${LOGIN_URL}?returnTo=${returnToParam()}` },
    secondary: { key: 'secondary', label: 'View Plus plans', href: PLUS_PLANS_URL },
    link: { label: 'Not now', onClick: closeModal },
  });
}

function openFreeAccountModal() {
  renderModal({
    heading: 'Upgrade to Plus to print complete reports',
    body: 'Your free account can still use available Literacy Arcade tools, but complete assessment reports, detailed skill analysis, and instructional next-step guidance require an active Plus plan.',
    primary: { key: 'primary', label: 'View Plus plans', href: PLUS_PLANS_URL },
    secondary: { key: 'secondary', label: 'Continue without printing', onClick: closeModal },
    link: { label: 'Go to dashboard', onClick: () => { window.location.href = DASHBOARD_URL; } },
  });
}

function openUnknownStatusModal(retry) {
  renderModal({
    heading: 'We could not confirm your Plus access',
    body: 'Please refresh the page and try again. If your subscription was recently purchased, it may take a moment to update. Contact hello@literacyarcade.com if the problem continues.',
    primary: { key: 'primary', label: 'Try again', onClick: () => { closeModal(); retry(); } },
    secondary: { key: 'secondary', label: 'View Plus plans', href: PLUS_PLANS_URL },
  });
}

/**
 * Gate a "Print Report" action behind active-paid-plan entitlement.
 * printFn is only invoked for signed-in accounts with an active Plus plan.
 */
async function guardReportPrint(printFn, triggerElement) {
  triggerEl = triggerElement || document.activeElement;
  const entitlement = await getEntitlement();

  if (entitlement.status === 'paid') {
    track('report_print_success_paid');
    printFn();
    return;
  }
  if (entitlement.status === 'signed-out') {
    track('report_print_attempt_signed_out');
    openSignedOutModal();
    return;
  }
  if (entitlement.status === 'free') {
    track('report_print_attempt_free');
    openFreeAccountModal();
    return;
  }
  openUnknownStatusModal(() => guardReportPrint(printFn, triggerEl));
}

function trackUpgradeClick() {
  track('report_upgrade_click');
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('.la-rg-primary, .la-rg-secondary');
  if (target && target.getAttribute('href') === PLUS_PLANS_URL) trackUpgradeClick();
});

export { guardReportPrint, getEntitlement };
