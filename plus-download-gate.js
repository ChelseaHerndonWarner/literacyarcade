// Shared Plus-only download gate (e.g. the Letterbox Lesson PDF).
// Mirrors report-print-gate.js's entitlement pattern — same
// users/{uid}.plan check, same self-contained modal styling approach —
// but with download/lesson-appropriate wording instead of assessment-report
// wording. report-print-gate.js itself is not imported or modified by this
// module, so assessment report gating is unaffected.
//
// Sign-in (when signed out) is handled via firebase-tool-gate.js's existing
// in-page requireSignIn() gate rather than a full-page redirect to
// teacher-login.html. The host page never navigates away, so any
// in-progress builder state on that page (e.g. a Letterbox Lesson being
// built in phoneme-counter.html) is never destroyed by the sign-in step.
// The host page must already include firebase-tool-gate.js.

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const PLUS_PLANS_URL = 'plus-subscriptions.html';

function isPaidPlan(plan) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  return normalizedPlan === 'plus' || normalizedPlan === 'family';
}

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

async function getEntitlement() {
  await authReady;
  if (!currentUser) return { status: 'signed-out' };
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    const plan = snap.exists() ? (snap.data().plan || 'free') : 'free';
    return { status: isPaidPlan(plan) ? 'paid' : 'free', plan };
  } catch (err) {
    console.warn('Literacy Arcade download gate: could not confirm entitlement.', err);
    return { status: 'unknown' };
  }
}

/* ---------------- shared modal (mirrors report-print-gate.js styling) ---------------- */

const STYLE_ID = 'la-download-gate-styles';
const MODAL_ID = 'la-download-gate-modal';
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
.la-dg-primary { background: #2EC4B6; color: #fff; }
.la-dg-primary:hover { background: #087A70; }
.la-dg-secondary { background: #fff; color: #087A70; border: 1.5px solid #2EC4B6 !important; }
.la-dg-secondary:hover { background: #EAF7E7; }
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

function renderModal({ heading, body, primary, secondary }) {
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
          ${actionHtml(primary, 'la-dg-primary')}
          ${actionHtml(secondary, 'la-dg-secondary')}
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

  keydownHandler = trapFocus;
  document.addEventListener('keydown', keydownHandler);

  const focusTarget = document.getElementById(`${MODAL_ID}-close`);
  setTimeout(() => {
    const firstAction = backdrop.querySelector('.la-dg-primary, .la-dg-secondary');
    (firstAction || focusTarget).focus();
  }, 0);
}

function openFreeAccountModal() {
  renderModal({
    heading: 'Upgrade to Plus to download this PDF',
    body: 'Your free account can still build and use Letterbox Lessons, but downloading a printable lesson PDF requires an active Plus plan.',
    primary: { key: 'primary', label: 'View Plus plans', href: PLUS_PLANS_URL },
    secondary: { key: 'secondary', label: 'Continue without downloading', onClick: closeModal },
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
 * Gate a Plus-only download/print action (e.g. the Letterbox Lesson PDF)
 * behind active-paid-plan entitlement.
 *
 * If the visitor is signed out, this first requires sign-in via the host
 * page's existing firebase-tool-gate.js in-page gate (no navigation away),
 * then checks entitlement. downloadFn is only invoked for signed-in
 * accounts with an active Plus plan.
 */
async function guardPlusDownload(downloadFn, triggerElement) {
  triggerEl = triggerElement || document.activeElement;

  const user = await window.LiteracyArcadeToolAccess?.requireSignIn?.();
  if (!user) return; // gate was closed without signing in

  const entitlement = await getEntitlement();

  if (entitlement.status === 'paid') {
    downloadFn();
    return;
  }
  if (entitlement.status === 'free' || entitlement.status === 'signed-out') {
    openFreeAccountModal();
    return;
  }
  openUnknownStatusModal(() => guardPlusDownload(downloadFn, triggerEl));
}

export { guardPlusDownload, getEntitlement };
