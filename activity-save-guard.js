// Free save/share limit guard (5 activities). See save-limit-BUILD-BRIEF.md.
// Exports canCreateActivity() and showUpgradeModal(). Self-contained styling
// (hardcoded brand tokens) so it renders consistently across every guarded
// tool page regardless of that page's own CSS variable names.

import {
  doc,
  getDoc,
  collection,
  getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const UNLIMITED_PLANS = new Set(['plus', 'family']);
const FREE_LIMIT = 5;

export async function canCreateActivity(user, db) {
  if (!user) return { allowed: false, reason: 'signed-out', count: 0, plan: 'free' };

  const profileSnap = await getDoc(doc(db, 'users', user.uid));
  const plan = profileSnap.exists() ? profileSnap.data().plan : undefined;

  if (UNLIMITED_PLANS.has(plan)) {
    return { allowed: true, reason: null, count: null, plan };
  }

  const countSnap = await getCountFromServer(collection(db, `users/${user.uid}/activities`));
  const count = countSnap.data().count;

  if (count < FREE_LIMIT) {
    return { allowed: true, reason: null, count, plan: 'free' };
  }
  return { allowed: false, reason: 'limit', count, plan: 'free' };
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
  'Free accounts can save or share up to 5 classroom activities. Everything you’ve already saved or shared stays available.',
  'Upgrade to Literacy Arcade Plus to save and share unlimited games and tools.'
];

const GRANDFATHERED_BODY = [
  'You’ve already saved more than 5 activities from before this change. They’re all still yours and are not going anywhere. Upgrade to save or share new activities.'
];

export function showUpgradeModal(gate, opts = {}) {
  ensureStyles();
  const existing = document.getElementById(`${MODAL_ID}-backdrop`);
  if (existing) existing.remove();

  const grandfathered = Boolean(opts.grandfathered || (gate && gate.count > 5));
  const bodyParagraphs = grandfathered ? GRANDFATHERED_BODY : STANDARD_BODY;

  const backdrop = document.createElement('div');
  backdrop.id = `${MODAL_ID}-backdrop`;

  const leadInHtml = opts.leadIn
    ? `<p id="${MODAL_ID}-leadin">${opts.leadIn}</p>`
    : '';

  backdrop.innerHTML = `
    <div id="${MODAL_ID}" role="dialog" aria-modal="true" aria-labelledby="${MODAL_ID}-title">
      <div id="${MODAL_ID}-head">
        <h2 id="${MODAL_ID}-title">Your free toolbox is full</h2>
      </div>
      <div id="${MODAL_ID}-body">
        ${leadInHtml}
        <div id="${MODAL_ID}-text">
          ${bodyParagraphs.map(p => `<p>${p}</p>`).join('')}
        </div>
        <div id="${MODAL_ID}-actions">
          <button type="button" class="asg-btn-primary" id="${MODAL_ID}-upgrade">Get unlimited saves and shares</button>
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
