// One-time, conservative backfill for the Free-plan "5 lifetime activity creations" rule.
//
// Sets users/{uid}.activitiesCreated for every account that does not have one yet. Past deletions
// were never tracked and plan history is not stored, so a historical creation is counted only if it
// is provably from the Free era (see computeBackfillCounter in ../activity-credits.js):
//   neverPaid       – no Stripe/plan evidence             → every current activity counts
//   paidProvable    – paid history + a known first start  → only activities created before it
//   paidUnprovable  – paid history, no usable start date  → 0 (listed for manual review)
// Activities with no createdAt are never counted for accounts with paid history.
// Nobody loses access to anything; this only decides how many new creations a Free account has left.
//
// Run BEFORE deploying createActivity and the new rules.
//   Dry run (default, writes nothing):  node functions/scripts/backfill-activities-created.js
//   Apply:                              node functions/scripts/backfill-activities-created.js --apply
// Needs Admin credentials for the literacy-arcade project (GOOGLE_APPLICATION_CREDENTIALS).
const admin = require('firebase-admin');
const { isUnlimited, computeBackfillCounter } = require('../activity-credits');

const APPLY = process.argv.includes('--apply');

admin.initializeApp({ projectId: 'literacy-arcade' });
const db = admin.firestore();

function toMs(value) {
  if (!value) return NaN;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value; // Stripe seconds vs ms
  if (value instanceof Date) return value.getTime();
  return NaN;
}

const START_FIELDS = ['created', 'start_date', 'current_period_start', 'trial_start'];

(async () => {
  const refs = await db.collection('users').listDocuments(); // includes accounts with no profile doc
  const tally = {
    accounts: refs.length, alreadyCounted: 0, noActivities: 0,
    neverPaid: 0, paidProvable: 0, paidUnprovable: 0, atOrOverLimit: 0,
  };
  const review = [];

  for (const ref of refs) {
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    if (typeof data.activitiesCreated === 'number') { tally.alreadyCounted += 1; continue; }

    const activitiesSnap = await ref.collection('activities').select('createdAt').get();
    const activityTimes = activitiesSnap.docs.map((d) => toMs(d.get('createdAt')));

    const subsSnap = await db.collection('customers').doc(ref.id).collection('subscriptions').get();
    let firstPaidStartMs = NaN;
    subsSnap.forEach((sub) => {
      START_FIELDS.forEach((field) => {
        const ms = toMs(sub.get(field));
        if (Number.isFinite(ms) && (!Number.isFinite(firstPaidStartMs) || ms < firstPaidStartMs)) firstPaidStartMs = ms;
      });
    });
    const hasPaidEvidence =
      !subsSnap.empty || isUnlimited(data.plan) ||
      Boolean(data.stripeSubscriptionId || data.stripePriceId || data.stripeStatus) ||
      data.planSource === 'stripe';

    const { counter, category } = computeBackfillCounter({ hasPaidEvidence, firstPaidStartMs, activityCreatedAtMs: activityTimes });
    if (activityTimes.length === 0 && !hasPaidEvidence) { tally.noActivities += 1; continue; } // counter starts at 0 implicitly
    tally[category] += 1;
    if (counter >= 5) tally.atOrOverLimit += 1;
    if (hasPaidEvidence) {
      review.push({
        uid: ref.id, plan: data.plan || 'free', category, counter, liveActivities: activityTimes.length,
        firstPaidStart: Number.isFinite(firstPaidStartMs) ? new Date(firstPaidStartMs).toISOString() : null,
      });
    }
    console.log(`${APPLY ? 'SET' : 'would set'} ${ref.id}: activitiesCreated=${counter} (${category})`);
    if (APPLY) await ref.set({ activitiesCreated: counter }, { merge: true });
  }

  if (review.length) {
    console.log('\nAccounts with paid history (review these before applying):');
    review.forEach((r) => console.log(JSON.stringify(r)));
  }
  console.log('\n' + JSON.stringify(tally, null, 2), APPLY ? '(applied)' : '(dry run — nothing written)');
})().catch((err) => { console.error(err); process.exit(1); });
