// Run with: node functions/activity-credits.test.js
const assert = require('assert');
const { computeCreateDecision, computeDeleteSeed, computeBackfillCounter, isEditLocked } = require('./activity-credits');

// --- Free user with a counter: allowed below 5, +1 each time, blocked at 5 ---
assert.deepStrictEqual(computeCreateDecision({ plan: undefined, activitiesCreated: 0, liveCount: 0 }),
  { allowed: true, counted: true, nextCounter: 1, count: 0 });
assert.deepStrictEqual(computeCreateDecision({ plan: 'free', activitiesCreated: 4, liveCount: 1 }),
  { allowed: true, counted: true, nextCounter: 5, count: 4 });
const blocked = computeCreateDecision({ plan: 'free', activitiesCreated: 5, liveCount: 0 });
assert.strictEqual(blocked.allowed, false);
assert.strictEqual(blocked.count, 5);
// Deleting never restores a credit: a counter of 5 blocks even when no activities remain.
assert.strictEqual(computeCreateDecision({ plan: 'free', activitiesCreated: 7, liveCount: 0 }).allowed, false);

// --- No counter yet: seed from the live count, which is the best available history ---
assert.deepStrictEqual(computeCreateDecision({ plan: 'free', liveCount: 3 }),
  { allowed: true, counted: true, nextCounter: 4, count: 3 });
const seededBlock = computeCreateDecision({ plan: 'free', liveCount: 6 });
assert.strictEqual(seededBlock.allowed, false);
assert.strictEqual(seededBlock.seedCounter, 6);

// --- Plus / Family: always allowed, never counted, counter initialised to 0 once ---
assert.deepStrictEqual(computeCreateDecision({ plan: 'plus', activitiesCreated: 5, liveCount: 20 }),
  { allowed: true, counted: false, nextCounter: null, count: 5 });
assert.deepStrictEqual(computeCreateDecision({ plan: 'family', liveCount: 20 }),
  { allowed: true, counted: false, nextCounter: 0, count: 0 });
// A lapsed Plus user's counter reflects Free-era use only.
assert.strictEqual(computeCreateDecision({ plan: 'free', activitiesCreated: 2, liveCount: 40 }).allowed, true);

// --- Delete safety net ---
assert.strictEqual(computeDeleteSeed({ plan: 'free', liveCountAfter: 4 }), 5);
assert.strictEqual(computeDeleteSeed({ plan: undefined, liveCountAfter: 0 }), 1);
assert.strictEqual(computeDeleteSeed({ plan: 'free', activitiesCreated: 5, liveCountAfter: 4 }), null);
assert.strictEqual(computeDeleteSeed({ plan: 'plus', liveCountAfter: 4 }), null);

// --- Conservative backfill ---
const T = (d) => Date.UTC(2026, 0, d);
// Never paid: all current activities count.
assert.deepStrictEqual(computeBackfillCounter({ hasPaidEvidence: false, activityCreatedAtMs: [T(1), null, T(9)] }),
  { counter: 3, category: 'neverPaid' });
// Paid history with a start date: only activities provably before it; undated or later ones do not count.
assert.deepStrictEqual(
  computeBackfillCounter({ hasPaidEvidence: true, firstPaidStartMs: T(10), activityCreatedAtMs: [T(1), T(9), T(10), T(20), null] }),
  { counter: 2, category: 'paidProvable' });
// Paid history without a usable start date: do not guess.
assert.deepStrictEqual(
  computeBackfillCounter({ hasPaidEvidence: true, firstPaidStartMs: NaN, activityCreatedAtMs: [T(1), T(2)] }),
  { counter: 0, category: 'paidUnprovable' });

// --- Read-only once all 5 credits are used (mirrors isEditLocked in firestore.rules) ---
assert.strictEqual(isEditLocked({ plan: 'free', activitiesCreated: 5 }), true);
assert.strictEqual(isEditLocked({ plan: undefined, activitiesCreated: 9 }), true);
assert.strictEqual(isEditLocked({ plan: 'free', activitiesCreated: 4 }), false);
assert.strictEqual(isEditLocked({ plan: 'plus', activitiesCreated: 5 }), false);
assert.strictEqual(isEditLocked({ plan: 'family', activitiesCreated: 9 }), false);
assert.strictEqual(isEditLocked({ plan: 'free' }), false); // no counter yet

console.log('activity-credits: all checks passed');
