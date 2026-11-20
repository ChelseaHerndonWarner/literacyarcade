// Pure logic for the Free-plan "5 lifetime activity creations" rule.
//
// users/{uid}.activitiesCreated is a server-written counter of activities a Free user has
// created. Deleting an activity never lowers it. Creations made while on Plus/Family are
// logged but not counted, so a lapsed Plus account is not charged for work it made while
// unlimited. Activities are only ever created by the createActivity callable (functions/index.js),
// which makes the check and the increment in a single transaction.

const UNLIMITED_PLANS = new Set(['plus', 'family']);
const FREE_LIMIT = 5;

function isUnlimited(plan) {
  return UNLIMITED_PLANS.has(plan);
}

function isCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Decide whether a new activity may be created right now.
// `liveCount` = activities the account has now (before this one); it only seeds accounts that
// have no counter yet. Returns:
//   allowed        – may create
//   counted        – this creation uses a Free credit
//   nextCounter    – value to write to activitiesCreated, or null to leave it alone
//   seedCounter    – (when blocked) counter value to persist, or null
//   count          – credits used so far
function computeCreateDecision({ plan, activitiesCreated, liveCount }) {
  const hasCounter = isCount(activitiesCreated);
  if (isUnlimited(plan)) {
    // Start the counter at 0 so a later lapse never counts Plus-era activities.
    return { allowed: true, counted: false, nextCounter: hasCounter ? null : 0, count: hasCounter ? activitiesCreated : 0 };
  }
  const base = hasCounter ? activitiesCreated : Math.max(0, Number(liveCount) || 0);
  if (base >= FREE_LIMIT) {
    return { allowed: false, counted: false, nextCounter: null, seedCounter: hasCounter ? null : base, count: base };
  }
  return { allowed: true, counted: true, nextCounter: base + 1, count: base };
}

// Read-only saved activities: a non-Plus account that has used all of its lifetime credits.
// Mirrors isEditLocked() in firestore.rules.
function isEditLocked({ plan, activitiesCreated }) {
  return !isUnlimited(plan) && isCount(activitiesCreated) && activitiesCreated >= FREE_LIMIT;
}

// Called when an activity document is deleted. If the account has no counter yet, seed it so the
// deleted activity still counts (liveCountAfter excludes it). Returns null when nothing should be written.
function computeDeleteSeed({ plan, activitiesCreated, liveCountAfter }) {
  if (isUnlimited(plan) || isCount(activitiesCreated)) return null;
  return (Number(liveCountAfter) || 0) + 1;
}

// Conservative starting counter for accounts that existed before the counter did.
// Past deletions were never tracked and plan history is not stored, so only activities that are
// provably from the Free era are counted:
//   - never paid (no Stripe evidence)       → every current activity counts
//   - paid history with a known first start → only activities whose createdAt is earlier than it
//   - paid history, no usable start date    → 0 (unprovable; flagged for review)
// Activities with no createdAt are never counted for accounts with paid history.
function computeBackfillCounter({ hasPaidEvidence, firstPaidStartMs, activityCreatedAtMs }) {
  const times = Array.isArray(activityCreatedAtMs) ? activityCreatedAtMs : [];
  if (!hasPaidEvidence) return { counter: times.length, category: 'neverPaid' };
  if (!Number.isFinite(firstPaidStartMs)) return { counter: 0, category: 'paidUnprovable' };
  const counter = times.filter((t) => Number.isFinite(t) && t < firstPaidStartMs).length;
  return { counter, category: 'paidProvable' };
}

module.exports = {
  UNLIMITED_PLANS,
  FREE_LIMIT,
  isUnlimited,
  computeCreateDecision,
  isEditLocked,
  computeDeleteSeed,
  computeBackfillCounter,
};
