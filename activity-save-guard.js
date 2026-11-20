// Free creation limit guard: 5 lifetime activity creations. Deleting an activity never gives
// one back — the count comes from users/{uid}.activitiesCreated, which only the
// recordActivityCreated Cloud Function writes (functions/index.js).
// Exports canCreateActivity() and showUpgradeModal(). Self-contained styling
// (hardcoded brand tokens) so it renders consistently across every guarded
// tool page regardless of that page's own CSS variable names.

import {
  doc,
  getDoc,
  collection,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-functions.js";

const UNLIMITED_PLANS = new Set(['plus', 'family']);
const FREE_LIMIT = 5;

export async function canCreateActivity(user, db) {
  if (!user) return { allowed: false, reason: 'signed-out', count: 0, plan: 'free' };

  let profileSnap;
  try {
    profileSnap = await getDoc(doc(db, 'users', user.uid));
  } catch (error) {
    const guardError = new Error('Literacy Arcade could not read the account plan.', { cause: error });
    guardError.code = 'plan-read-failed';
    throw guardError;
  }
  const profile = profileSnap.exists() ? profileSnap.data() : {};
  const plan = profile.plan;

  if (UNLIMITED_PLANS.has(plan)) {
    return { allowed: true, reason: null, count: null, plan };
  }

  // Lifetime creations. Accounts the server has not counted yet (no counter) fall
  // back to the activities they currently have, as before.
  let count = profile.activitiesCreated;
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) {
    let countSnap;
    try {
      countSnap = await getCountFromServer(collection(db, `users/${user.uid}/activities`));
    } catch (error) {
      const guardError = new Error('Literacy Arcade could not count saved activities.', { cause: error });
      guardError.code = 'save-count-read-failed';
      throw guardError;
    }
    count = countSnap.data().count;
  }

  if (count < FREE_LIMIT) {
    return { allowed: true, reason: null, count, plan: 'free' };
  }
  return { allowed: false, reason: 'limit', count, plan: 'free' };
}

// Creates a NEW saved activity. Direct client creates are blocked by firestore.rules; the
// createActivity Cloud Function checks the plan and lifetime counter and creates the document
// (and the public share link, when data.shareEnabled === true) in one transaction. Returns an
// object shaped like a DocumentReference ({ id }) plus { shareId } when a share was requested.
// On "limit reached" it shows the upgrade modal and throws an error with saveGuardHandled = true.
// Editing an existing activity is a normal updateDoc and never goes through here.
export async function createActivityDoc(user, db, data, opts = {}) {
  if (!user) throw new Error('Sign in to save an activity.');
  // Server timestamps are set by the function, so drop the client sentinels before serialising.
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...plain } = data || {};
  const activity = JSON.parse(JSON.stringify(plain));
  const wantsShare = activity.shareEnabled === true;
  const requestId = (globalThis.crypto && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, '')
    : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

  const call = httpsCallable(getFunctions(getApp(), 'us-central1'), 'createActivity');
  try {
    const res = await call({ requestId, activity, share: wantsShare });
    return { id: res.data.id, shareId: res.data.shareId || null };
  } catch (error) {
    if (error && error.code === 'functions/resource-exhausted') {
      const count = Number(error.details && error.details.count);
      showUpgradeModal({ allowed: false, reason: 'limit', count: Number.isFinite(count) ? count : FREE_LIMIT, plan: 'free' },
        wantsShare || opts.shared ? { leadIn: 'Sharing saves a copy to your dashboard — and you’ve used your 5 free activities.' } : {});
      const handled = new Error('Free activity creation limit reached.', { cause: error });
      handled.saveGuardHandled = true;
      handled.code = 'limit-reached';
      throw handled;
    }
    throw error;
  }
}

// True when this account's saved activities are read-only: a Free account that has used all 5
// lifetime creation credits. Mirrors isEditLocked() in firestore.rules, which is what actually
// enforces it; this check only lets the page explain it instead of failing with a permissions error.
export async function isEditLocked(user, db) {
  if (!user) return false;
  let snap;
  try {
    snap = await getDoc(doc(db, 'users', user.uid));
  } catch (error) {
    return false; // the rules still decide
  }
  const profile = snap.exists() ? snap.data() : {};
  if (UNLIMITED_PLANS.has(profile.plan)) return false;
  return typeof profile.activitiesCreated === 'number' && profile.activitiesCreated >= FREE_LIMIT;
}

export function showReadOnlyModal() {
  return showUpgradeModal({ allowed: false, reason: 'read-only', count: FREE_LIMIT, plan: 'free' }, {
    title: 'Your saved activities are read-only',
    body: [
      'You’ve used your 5 free activities, so your saved activities can’t be changed on the Free plan. You can still open, play and share them, and students keep access to shared links.',
      'Upgrade to Literacy Arcade Plus to edit your activities and create new ones.'
    ]
  });
}

// Shares an activity that is already saved (no credit used; allowed even when read-only). The
// server builds the public copy from the saved activity. Returns { shareId }.
export async function shareExistingActivity(activityId, opts = {}) {
  const call = httpsCallable(getFunctions(getApp(), 'us-central1'), 'shareActivity');
  const res = await call({ activityId, forceNew: opts.forceNew === true });
  return { shareId: res.data.shareId };
}

const STYLE_ID = 'activity-save-guard-styles';
const MODAL_ID = 'activity-save-guard-modal';

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
#${MODAL_ID}-head {
  padding: 20px 22px 0;
}
#${MODAL_ID}-title {
  font-family: 'Nunito', sans-serif; font-size: 20px; font-weight: 900;
  line-height: 1.2; margin: 0;
}
#${MODAL_ID}-body {
  padding: 12px 22px 22px; display: flex; flex-direction: column; gap: 12px;
}
#${MODAL_ID}-leadin {
  font-size: 13px; font-weight: 700; color: #087A70;
  background: #D9F8F5; border-radius: 10px; padding: 8px 12px; margin: 0;
}
#${MODAL_ID}-text p {
  font-size: 14px; font-weight: 600; line-height: 1.55; color: #4B5875; margin: 0 0 10px;
}
#${MODAL_ID}-text p:last-child { margin-bottom: 0; }
#${MODAL_ID}-actions {
  display: flex; flex-direction: column; gap: 9px; margin-top: 4px;
}
#${MODAL_ID}-actions button {
  border-radius: 10px; min-height: 44px; padding: 10px 14px;
  font-family: 'Nunito', sans-serif; font-weight: 900; font-size: 14px;
  cursor: pointer; border: 0;
}
.asg-btn-primary { background: #2EC4B6; color: #fff; }
.asg-btn-primary:hover { background: #087A70; }
.asg-btn-secondary { background: #fff; color: #087A70; border: 1.5px solid #2EC4B6 !important; }
.asg-btn-secondary:hover { background: #EAF7E7; }
`;
  document.head.appendChild(style);
}

const STANDARD_BODY = [
  'Free accounts can create up to 5 classroom activities in total, and deleting an activity does not give one back. Everything you’ve already created stays available to open, edit and share.',
  'Upgrade to Literacy Arcade Plus to create and share unlimited games and tools.'
];

const GRANDFATHERED_BODY = [
  'You’ve already created more than 5 activities from before this change. They’re all still yours and are not going anywhere. Upgrade to create or share new activities.'
];

export function showUpgradeModal(gate, opts = {}) {
  ensureStyles();
  const existing = document.getElementById(`${MODAL_ID}-backdrop`);
  if (existing) existing.remove();

  const grandfathered = Boolean(opts.grandfathered || (gate && gate.count > 5));
  const bodyParagraphs = Array.isArray(opts.body) ? opts.body : (grandfathered ? GRANDFATHERED_BODY : STANDARD_BODY);

  const backdrop = document.createElement('div');
  backdrop.id = `${MODAL_ID}-backdrop`;

  const leadInHtml = opts.leadIn
    ? `<p id="${MODAL_ID}-leadin">${opts.leadIn}</p>`
    : '';

  backdrop.innerHTML = `
    <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <div id="${MODAL_ID}-head">
        <h2 id="${MODAL_ID}-title">${opts.title || 'You’ve used your 5 free activities'}</h2>
      </div>
      <div id="${MODAL_ID}-body">
        ${leadInHtml}
        <div id="${MODAL_ID}-text">
          ${bodyParagraphs.map(p => `<p>${p}</p>`).join('')}
        </div>
        <div id="${MODAL_ID}-actions">
          <button type="button" class="asg-btn-primary" id="${MODAL_ID}-upgrade">Get unlimited activities</button>
          <button type="button" class="asg-btn-secondary" id="${MODAL_ID}-close">Keep using free tools</button>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(backdrop);

  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  backdrop.querySelector(`#${MODAL_ID}-close`).addEventListener('click', close);
  backdrop.querySelector(`#${MODAL_ID}-upgrade`).addEventListener('click', () => {
    window.location.href = 'plus-subscriptions.html';
  });

  return { close };
}
