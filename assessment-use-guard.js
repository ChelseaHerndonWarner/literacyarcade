// Shared free-assessment quota gate for the four assessment tools (Quick
// Letter Knowledge, Quick Letter Sound, Phonics Knowledge Check, ORF
// Fluency Calculator).
//
// This module controls two separate things:
//   1. Requiring sign-in before an assessment can be administered (reuses
//      the existing firebase-tool-gate.js sign-in wall — the page must
//      already include that script and set data-tool-id/data-tool-name on
//      <body>, same convention as repeated-reading-raceway.html).
//   2. The shared 5-free-assessment quota for free accounts, unlimited for
//      Plus/family. Source of truth: users/{uid}.assessmentUses, which is
//      only ever written by the recordAssessmentCompletion Cloud Function
//      (functions/index.js) via the Admin SDK. firestore.rules blocks
//      clients from writing that field directly (same pattern as `plan`),
//      so this module only ever reads it and calls the callable function.
//
// This is intentionally separate from report-print-gate.js, which controls
// complete-report printing (Plus-only) and is unaffected by this module.

import { auth, db, functions } from './firebase-config.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js';

const UNLIMITED_PLANS = new Set(['plus', 'family']);
const FREE_ASSESSMENT_LIMIT = 5;
const PLUS_PLANS_URL = 'plus-subscriptions.html';

export async function canStartAssessment(user) {
  if (!user) return { allowed: false, reason: 'signed-out', uses: 0, plan: 'free' };
  const snap = await getDoc(doc(db, 'users', user.uid));
  const data = snap.exists() ? snap.data() : {};
  const plan = data.plan;
  const uses = typeof data.assessmentUses === 'number' ? data.assessmentUses : 0;

  if (UNLIMITED_PLANS.has(plan)) {
    return { allowed: true, reason: null, uses, plan };
  }
  if (uses < FREE_ASSESSMENT_LIMIT) {
    return { allowed: true, reason: null, uses, plan: 'free' };
  }
  return { allowed: false, reason: 'limit', uses, plan: 'free' };
}

let recordCallable = null;

export function newCompletionId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Records completion of one of the four assessments against the
 * authoritative server-side quota. Never throws — returns a structured
 * result so the caller can tell a quota rejection apart from a transient
 * network/server error:
 *   { ok: true, uses, plan, unlimited }
 *   { ok: false, reason: 'quota' }
 *   { ok: false, reason: 'error', error }
 *
 * `completionId` must be a stable id generated once per assessment attempt
 * (e.g. at begin-assessment time) and reused on every retry of that same
 * attempt — the Cloud Function uses it to make retries idempotent, so a
 * dropped response and a subsequent retry can never double-count.
 *
 * Prefer finalizeAssessmentCompletion() over calling this directly — it
 * also handles showing the right UI for each outcome.
 */
export async function recordAssessmentCompletion(assessmentType, completionId) {
  try {
    if (!recordCallable) recordCallable = httpsCallable(functions, 'recordAssessmentCompletion');
    const result = await recordCallable({ assessmentType, completionId });
    return { ok: true, ...result.data };
  } catch (error) {
    if (error?.code === 'functions/resource-exhausted') {
      return { ok: false, reason: 'quota' };
    }
    console.warn('Literacy Arcade: could not record assessment completion.', error);
    return { ok: false, reason: 'error', error };
  }
}

/* ---------------- shared modal (mirrors activity-save-guard.js styling) ---------------- */

const STYLE_ID = 'assessment-use-guard-styles';
const MODAL_ID = 'assessment-use-guard-modal';

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
#${MODAL_ID}-head { padding: 20px 22px 0; }
#${MODAL_ID}-title {
  font-family: 'Nunito', sans-serif; font-size: 20px; font-weight: 900;
  line-height: 1.2; margin: 0;
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
.aug-btn-primary { background: #2EC4B6; color: #fff; }
.aug-btn-primary:hover { background: #087A70; }
.aug-btn-secondary { background: #fff; color: #087A70; border: 1.5px solid #2EC4B6 !important; }
.aug-btn-secondary:hover { background: #EAF7E7; }
.assessment-quota-note {
  font-family: 'Nunito', sans-serif; font-size: 12px; font-weight: 800;
  color: #6A4F92; margin-top: 8px; display: none;
}
`;
  document.head.appendChild(style);
}

export function showAssessmentLimitModal() {
  ensureStyles();
  const existing = document.getElementById(`${MODAL_ID}-backdrop`);
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = `${MODAL_ID}-backdrop`;
  backdrop.innerHTML = `
    <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <div id="${MODAL_ID}-head">
        <h2 id="${MODAL_ID}-title">You’ve used your 5 free assessments</h2>
      </div>
      <div id="${MODAL_ID}-body">
        <div id="${MODAL_ID}-text"><p>Upgrade to Literacy Arcade Plus for unlimited assessments, complete printable reports, unlimited saved activities, and more.</p></div>
        <div id="${MODAL_ID}-actions">
          <a class="aug-btn-primary" href="${PLUS_PLANS_URL}">View Plus plans</a>
          <button type="button" class="aug-btn-secondary" id="${MODAL_ID}-close">Not now</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(`#${MODAL_ID}-close`).addEventListener('click', close);
  return { close };
}

/**
 * Shown for a transient/network/server error while confirming a completion
 * — distinct from the quota-limit modal above, so a connectivity hiccup is
 * never presented as "you're out of free assessments."
 */
export function showAssessmentNetworkErrorModal({ onRetry, onDismiss } = {}) {
  ensureStyles();
  const existing = document.getElementById(`${MODAL_ID}-backdrop`);
  if (existing) existing.remove();

  const backdrop = document.createElement('div');
  backdrop.id = `${MODAL_ID}-backdrop`;
  backdrop.innerHTML = `
    <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <div id="${MODAL_ID}-head">
        <h2 id="${MODAL_ID}-title">We couldn’t confirm this assessment</h2>
      </div>
      <div id="${MODAL_ID}-body">
        <div id="${MODAL_ID}-text"><p>We couldn’t confirm this assessment right now. Please check your connection and try again.</p></div>
        <div id="${MODAL_ID}-actions">
          <button type="button" class="aug-btn-primary" id="${MODAL_ID}-retry">Try again</button>
          <button type="button" class="aug-btn-secondary" id="${MODAL_ID}-close">Not now</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) { close(); if (onDismiss) onDismiss(); } });
  backdrop.querySelector(`#${MODAL_ID}-close`).addEventListener('click', () => { close(); if (onDismiss) onDismiss(); });
  backdrop.querySelector(`#${MODAL_ID}-retry`).addEventListener('click', () => { close(); if (onRetry) onRetry(); });
  return { close };
}

/**
 * Records a completion and only calls onAccepted(result) — i.e. only lets
 * the caller reveal/finalize results — once the server has authoritatively
 * accepted it. This is the only sanctioned way to finalize an assessment
 * completion; do not call recordAssessmentCompletion() directly and reveal
 * results without awaiting acceptance first.
 *
 *   - Server accepts            -> onAccepted(result) runs, then resolves
 *                                   { finalized: true }
 *   - Server rejects (quota)    -> shows the upgrade modal, resolves
 *                                   { finalized: false, reason: 'quota' }
 *   - Transient/network error   -> shows a recoverable error modal with a
 *                                   "Try again" action that retries with the
 *                                   SAME completionId (safe/idempotent); if
 *                                   dismissed instead, resolves
 *                                   { finalized: false, reason: 'error' }
 */
export async function finalizeAssessmentCompletion(assessmentType, completionId, { onAccepted } = {}) {
  const result = await recordAssessmentCompletion(assessmentType, completionId);

  if (result.ok) {
    if (onAccepted) onAccepted(result);
    return { finalized: true, result };
  }

  if (result.reason === 'quota') {
    showAssessmentLimitModal();
    return { finalized: false, reason: 'quota' };
  }

  return new Promise((resolve) => {
    showAssessmentNetworkErrorModal({
      onRetry: async () => {
        resolve(await finalizeAssessmentCompletion(assessmentType, completionId, { onAccepted }));
      },
      onDismiss: () => resolve({ finalized: false, reason: 'error' }),
    });
  });
}

/**
 * Updates a subtle "N of 5 free assessments used" note. Only shown to free
 * signed-in accounts; hidden entirely for signed-out visitors and Plus/family
 * accounts.
 */
export function renderUsageNote(el, gate) {
  if (!el) return;
  if (!gate || gate.plan !== 'free' || typeof gate.uses !== 'number') {
    el.style.display = 'none';
    el.textContent = '';
    return;
  }
  const remaining = Math.max(0, FREE_ASSESSMENT_LIMIT - gate.uses);
  el.textContent = `${remaining} of ${FREE_ASSESSMENT_LIMIT} free assessments remaining`;
  el.style.display = '';
}

/**
 * Full begin-assessment flow: requires sign-in (via firebase-tool-gate.js's
 * existing full-page gate, already loaded on the page), then checks the
 * shared 5-assessment quota. Shows the upgrade modal and returns
 * allowed:false if the free quota is exhausted. Does not itself record a
 * completion — call recordAssessmentCompletion() separately once the
 * assessment actually finishes.
 */
export async function requireAssessmentAccess(assessmentType, opts = {}) {
  const user = await window.LiteracyArcadeToolAccess?.requireSignIn?.();
  if (!user) return { allowed: false, reason: 'signed-out' };

  const gate = await canStartAssessment(user);
  if (opts.usageNoteEl) renderUsageNote(opts.usageNoteEl, gate);

  if (!gate.allowed) {
    showAssessmentLimitModal();
    return { allowed: false, reason: gate.reason, user, gate };
  }
  return { allowed: true, user, gate };
}

export { auth, db };
