// The single definition of "which plan does this account have right now".
//
// Access can come from two independent sources:
//   - Stripe: subscription records under customers/{uid}/subscriptions, written by the extension.
//   - Manual grant: planGrants/{uid}, written only by an administrator (Firebase console or
//     Admin SDK). Fields: plan ('plus' | 'family'), expiresAt (Timestamp, or absent for no end
//     date) and an optional note.
// The higher of the two wins, so neither source can lower the other. Grants are created only by an
// administrator; nothing creates them automatically, and editing users/{uid}.plan by hand is not a
// grant (the next sync overwrites it). plan-sync.js stores the
// result on users/{uid} (plan, planSource, planExpiresAt, planAfterExpiry), which every page,
// security rule and function reads. Server code must call effectivePlan() so that an expired
// grant stops working immediately, even before the scheduled sweep rewrites the user document.

const PLAN_RANK = new Map([['free', 0], ['plus', 1], ['family', 2]]);
const PAID_PLANS = new Set(['plus', 'family']);

const rank = (plan) => PLAN_RANK.get(plan) || 0;
const isPaidPlan = (plan) => PAID_PLANS.has(plan);
const toMillis = (value) => (value && typeof value.toMillis === 'function' ? value.toMillis() : null);

// state: 'none' | 'active' | 'expired' | 'invalid'. An unreadable grant (unknown plan, or an
// expiry that is not a Timestamp) gives no access, so a typing mistake cannot grant forever.
function readGrant(grant, nowMs) {
  if (!grant) return { state: 'none' };
  if (!isPaidPlan(grant.plan)) return { state: 'invalid' };
  if (grant.expiresAt === undefined || grant.expiresAt === null) {
    return { state: 'active', plan: grant.plan, expiresAt: null };
  }
  const expiresMs = toMillis(grant.expiresAt);
  if (expiresMs === null) return { state: 'invalid' };
  if (expiresMs <= nowMs) return { state: 'expired' };
  return { state: 'active', plan: grant.plan, expiresAt: grant.expiresAt };
}

// What should be stored on users/{uid}, given both sources.
function resolveEntitlement({ stripePlan = 'free', hasStripeRecords = false, grant = null, nowMs }) {
  const manual = readGrant(grant, nowMs);
  const manualWins = manual.state === 'active' && rank(manual.plan) > rank(stripePlan);
  const expiring = manualWins && manual.expiresAt !== null;
  return {
    plan: manualWins ? manual.plan : stripePlan,
    planSource: manualWins ? 'manual' : hasStripeRecords ? 'stripe' : 'none',
    planExpiresAt: expiring ? manual.expiresAt : null,
    // What remains when the grant ends (a lower Stripe plan, or Free).
    planAfterExpiry: expiring ? stripePlan : null,
    grantState: manual.state,
  };
}

// The plan to enforce for a users/{uid} document. It can only ever lower the stored plan.
// Mirrored by isEditLocked() in firestore.rules.
function effectivePlan(userData, nowMs = Date.now()) {
  const stored = isPaidPlan(userData?.plan) ? userData.plan : 'free';
  const expiry = userData?.planExpiresAt;
  if (expiry === undefined || expiry === null) return stored;
  const expiresMs = toMillis(expiry);
  if (expiresMs !== null && expiresMs > nowMs) return stored;
  const after = isPaidPlan(userData.planAfterExpiry) ? userData.planAfterExpiry : 'free';
  return rank(after) < rank(stored) ? after : stored;
}

module.exports = { effectivePlan, isPaidPlan, rank, readGrant, resolveEntitlement };
