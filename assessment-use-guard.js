// Shared Plus-entitlement gate for the four assessment tools (Quick Letter
// Knowledge, Quick Letter Sound, Phonics Knowledge Check, ORF Fluency
// Calculator).
//
// Administering any of these assessments requires an active Literacy Arcade
// Plus or Plus Family plan. There is no free-tier quota — a free account
// (signed in or not) cannot administer an assessment at all.
//
// Source of truth: Firestore users/{uid}.plan, synced from Stripe by
// functions/index.js (syncUserPlanFromStripeSubscription). This module only
// reads the resolved `plan` field — same approach as report-print-gate.js
// and plus-download-gate.js, which this module intentionally mirrors so all
// three Plus gates on the site behave consistently. It does not import or
// call firebase-tool-gate.js — the generic "create a free account" sign-in
// wall is not appropriate here, since a free account is not sufficient.
//
// The gate must run BEFORE the teacher can start entering assessment data,
// not only when they click Calculate — see guardAssessmentAccess() below.

import { auth, db } from './firebase-config.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

const PLUS_PLANS_URL = 'plus-subscriptions.html';
const LOGIN_URL = 'teacher-login.html';
const DASHBOARD_URL = 'teacher-dashboard.html';

function isPaidPlan(plan) {
  const normalizedPlan = String(plan || '').trim().toLowerCase();
  return normalizedPlan === 'plus' || normalizedPlan === 'family';
}

let currentUser = null;
let resolveAuthReady;
const authReady = new Promise((resolve) => { resolveAuthReady = resolve; });
let authReadyDone = false;
let authInitializationFailed = false;

onAuthStateChanged(
  auth,
  (user) => {
    currentUser = user;
    if (!authReadyDone) {
      authReadyDone = true;
      resolveAuthReady();
    }
  },
  (error) => {
    authInitializationFailed = true;
    console.warn('Literacy Arcade assessment gate: authentication did not initialize.', error);
    if (!authReadyDone) {
      authReadyDone = true;
      resolveAuthReady();
    }
  }
);

function returnToParam() {
  const path = `${window.location.pathname.split('/').pop()}${window.location.search}`;
  return encodeURIComponent(path || DASHBOARD_URL);
}

/**
 * Resolves the caller's assessment entitlement. Returns one of four
 * distinct states — these must never be conflated:
 *   { status: 'paid' }        - Plus or Plus Family, unlimited access
 *   { status: 'free' }        - signed in, but not on a paid plan
 *   { status: 'signed-out' }  - no authenticated user
 *   { status: 'unknown' }     - auth or the Firestore read genuinely failed;
 *                                we could not determine plan/free either way
 */
export async function getAssessmentEntitlement() {
  await authReady;
  if (authInitializationFailed) return { status: 'unknown' };
  if (!currentUser) return { status: 'signed-out' };
  try {
    const snap = await getDoc(doc(db, 'users', currentUser.uid));
    const plan = snap.exists() ? (snap.data().plan || 'free') : 'free';
    return { status: isPaidPlan(plan) ? 'paid' : 'free', plan, user: currentUser };
  } catch (err) {
    console.warn('Literacy Arcade assessment gate: could not confirm entitlement.', err);
    return { status: 'unknown' };
  }
}

/* ---------------- full-page blocking gate ---------------- */

const STYLE_ID = 'assessment-use-guard-styles';
const OVERLAY_ID = 'assessment-use-guard-overlay';

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
#${OVERLAY_ID} {
  position: fixed; inset: 0; background: #F7F5FC;
  display: flex; align-items: center; justify-content: center;
  z-index: 9999; padding: 20px; overflow-y: auto;
}
#${OVERLAY_ID}-card {
  width: min(460px, 100%); background: #fff; border: 1px solid #EEE8F8;
  border-radius: 16px; box-shadow: 0 18px 60px rgba(27,42,74,.18);
  padding: 28px 26px; font-family: 'Nunito', sans-serif; color: #1B2A4A;
  text-align: center;
}
#${OVERLAY_ID}-spinner {
  width: 34px; height: 34px; margin: 0 auto 16px; border-radius: 50%;
  border: 4px solid #EEE8F8; border-top-color: #2EC4B6;
  animation: aug-spin 0.8s linear infinite;
}
@keyframes aug-spin { to { transform: rotate(360deg); } }
#${OVERLAY_ID}-title {
  font-family: 'Nunito', sans-serif; font-size: 20px; font-weight: 900;
  line-height: 1.25; margin: 0 0 10px;
}
#${OVERLAY_ID}-text {
  font-size: 14px; font-weight: 600; line-height: 1.55; color: #4B5875; margin: 0 0 18px;
}
#${OVERLAY_ID}-actions { display: flex; flex-direction: column; gap: 9px; }
#${OVERLAY_ID}-actions a,
#${OVERLAY_ID}-actions button {
  display: flex; align-items: center; justify-content: center;
  border-radius: 10px; min-height: 44px; padding: 10px 14px;
  font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14px;
  cursor: pointer; border: 0; text-decoration: none; box-sizing: border-box;
}
.aug-btn-primary { background: #2EC4B6; color: #fff; }
.aug-btn-primary:hover { background: #087A70; }
.aug-btn-secondary { background: #fff; color: #087A70; border: 1.5px solid #2EC4B6 !important; }
.aug-btn-secondary:hover { background: #EAF7E7; }
.aug-btn-link {
  background: none; border: 0; min-height: 32px; font-size: 13px; font-weight: 800;
  color: #6A4F92; text-decoration: underline;
}
`;
  document.head.appendChild(style);
}

function removeOverlay() {
  const el = document.getElementById(OVERLAY_ID);
  if (el) el.remove();
  document.documentElement.style.overflow = '';
}

function actionHtml(action, className) {
  if (!action) return '';
  if (action.href) return `<a class="${className}" href="${action.href}">${action.label}</a>`;
  return `<button type="button" class="${className}" data-aug-action="${action.key}">${action.label}</button>`;
}

function renderOverlay({ heading, body, primary, secondary, link, spinner }) {
  ensureStyles();
  const existing = document.getElementById(OVERLAY_ID);
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', spinner ? 'status' : 'dialog');
  overlay.setAttribute('aria-modal', spinner ? 'false' : 'true');
  overlay.setAttribute('aria-live', 'polite');
  overlay.innerHTML = `
    <div id="${OVERLAY_ID}-card">
      ${spinner ? `<div id="${OVERLAY_ID}-spinner" aria-hidden="true"></div>` : ''}
      <h1 id="${OVERLAY_ID}-title">${heading}</h1>
      <p id="${OVERLAY_ID}-text">${body}</p>
      <div id="${OVERLAY_ID}-actions">
        ${actionHtml(primary, 'aug-btn-primary')}
        ${actionHtml(secondary, 'aug-btn-secondary')}
        ${link ? `<button type="button" class="aug-btn-link" data-aug-action="${link.key}">${link.label}</button>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  document.documentElement.style.overflow = 'hidden';

  if (primary?.onClick) overlay.querySelector(`[data-aug-action="${primary.key}"]`)?.addEventListener('click', primary.onClick);
  if (secondary?.onClick) overlay.querySelector(`[data-aug-action="${secondary.key}"]`)?.addEventListener('click', secondary.onClick);
  if (link?.onClick) overlay.querySelector(`[data-aug-action="${link.key}"]`)?.addEventListener('click', link.onClick);
}

function renderLoadingOverlay() {
  renderOverlay({
    spinner: true,
    heading: 'Checking your account…',
    body: 'One moment while we confirm your Literacy Arcade Plus access.',
  });
}

function renderSignedOutOverlay(toolName, onRetry) {
  renderOverlay({
    heading: `${toolName} requires Literacy Arcade Plus`,
    body: 'This assessment is available with an active Literacy Arcade Plus or Plus Family plan. Sign in with your Plus account to continue.',
    primary: { key: 'signin', label: 'Sign in', href: `${LOGIN_URL}?returnTo=${returnToParam()}` },
    secondary: { key: 'plans', label: 'View Plus plans', href: PLUS_PLANS_URL },
  });
}

function renderFreeAccountOverlay(toolName) {
  renderOverlay({
    heading: `Upgrade to Plus to use ${toolName}`,
    body: 'Administering assessments is a Literacy Arcade Plus feature. Your free account can still use Literacy Arcade’s other tools — upgrade to Plus or Plus Family for unlimited assessments, complete printable reports, and more.',
    primary: { key: 'plans', label: 'View Plus plans', href: PLUS_PLANS_URL },
    secondary: { key: 'dashboard', label: 'Go to dashboard', href: DASHBOARD_URL },
  });
}

function renderUnknownStatusOverlay(onRetry) {
  renderOverlay({
    heading: 'We couldn’t confirm your account status',
    body: 'We couldn’t confirm your account status right now. Please try again.',
    primary: { key: 'retry', label: 'Try again', onClick: () => onRetry() },
    secondary: { key: 'plans', label: 'View Plus plans', href: PLUS_PLANS_URL },
  });
}

/**
 * Gates an assessment page behind Plus/Plus Family entitlement. Call this
 * once, as early as possible on page load — before the teacher can interact
 * with any assessment fields — not from a button's click handler.
 *
 * Renders a full-page blocking overlay (not a dismissable modal) so the
 * page never appears usable while entitlement is still being checked or
 * once it's been denied:
 *   - while checking          -> loading overlay
 *   - Plus / Plus Family      -> overlay removed, assessment usable
 *   - signed out              -> "requires Plus" overlay with a sign-in path
 *   - signed in, free plan    -> "upgrade to Plus" overlay
 *   - entitlement unknown     -> distinct "couldn't confirm your account
 *                                 status" overlay with Try again, never
 *                                 phrased as a Plus requirement and never
 *                                 phrased as a connection/network problem
 *
 * Returns { allowed: true, entitlement } once Plus access is confirmed, or
 * { allowed: false, entitlement } for every other state (the overlay stays
 * up; retrying re-runs this same check).
 */
export async function guardAssessmentAccess(toolName) {
  renderLoadingOverlay();
  const entitlement = await getAssessmentEntitlement();

  if (entitlement.status === 'paid') {
    removeOverlay();
    return { allowed: true, entitlement };
  }

  const retry = () => guardAssessmentAccess(toolName);

  if (entitlement.status === 'signed-out') {
    renderSignedOutOverlay(toolName, retry);
  } else if (entitlement.status === 'free') {
    renderFreeAccountOverlay(toolName);
  } else {
    renderUnknownStatusOverlay(retry);
  }
  return { allowed: false, entitlement };
}

export { auth, db };
