const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

// Assessment types covered by the shared 5-free-assessment quota. Keep this
// list in sync with the toolType identifiers passed by assessment-use-guard.js.
const ASSESSMENT_TYPES = new Set([
  'quick-letter-knowledge',
  'quick-letter-sound',
  'phonics-knowledge-check',
  'orf-fluency-calculator',
]);
const UNLIMITED_ASSESSMENT_PLANS = new Set(['plus', 'family']);
const FREE_ASSESSMENT_LIMIT = 5;

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const PRICE_TO_PLAN = {
  // Preserve Plus access for active subscriptions purchased through the
  // discontinued Founding Teacher offer (live and test prices).
  price_1TqmEK3PzX3bHrbQEkK6vaes: 'plus',
  price_1TqY6k4Gz51pZDtQR6oFrYDp: 'plus',
  price_1TqmEJ3PzX3bHrbQ2cWDevb5: 'plus',
  price_1TqmEM3PzX3bHrbQh3wylsSF: 'plus',
  price_1TqY5P4Gz51pZDtQOiymXQZ4: 'plus',
  price_1TqY444Gz51pZDtQmTMOq3Gv: 'plus',
  price_1TssAC3PzX3bHrbQg4qIhxOH: 'family',
};
const PLAN_PRIORITY = {
  free: 0,
  plus: 1,
  family: 2,
};

function addPriceId(ids, value) {
  if (typeof value === 'string' && value.startsWith('price_')) {
    ids.add(value);
  }
}

function collectPriceIds(subscription) {
  const ids = new Set();
  if (!subscription || typeof subscription !== 'object') return ids;

  addPriceId(ids, subscription.price);
  addPriceId(ids, subscription.priceId);
  addPriceId(ids, subscription.plan?.id);
  addPriceId(ids, subscription.plan?.price);
  addPriceId(ids, subscription.items?.data?.[0]?.price?.id);
  addPriceId(ids, subscription.items?.[0]?.price?.id);

  return ids;
}

function getBestPlanFromSubscription(subscription) {
  const status = subscription?.status;
  if (!ACTIVE_STATUSES.has(status)) return null;

  const explicitPlan = subscription?.literacyArcadePlan || subscription?.metadata?.literacyArcadePlan;
  if (explicitPlan && PLAN_PRIORITY[explicitPlan] > PLAN_PRIORITY.free) {
    return explicitPlan;
  }

  const priceIds = collectPriceIds(subscription);
  let bestPlan = null;

  priceIds.forEach((priceId) => {
    const plan = PRICE_TO_PLAN[priceId];
    if (!plan) return;
    if (!bestPlan || PLAN_PRIORITY[plan] > PLAN_PRIORITY[bestPlan]) {
      bestPlan = plan;
    }
  });

  return bestPlan;
}

async function recomputeUserPlan(userId) {
  const subscriptionsSnap = await db
    .collection('customers')
    .doc(userId)
    .collection('subscriptions')
    .get();

  let bestPlan = 'free';
  let bestSubscription = null;
  let bestPriceId = null;
  let bestStatus = null;

  subscriptionsSnap.forEach((subscriptionDoc) => {
    const subscription = subscriptionDoc.data();
    const plan = getBestPlanFromSubscription(subscription);
    logger.info('Evaluated Stripe subscription for Literacy Arcade plan.', {
      userId,
      subscriptionId: subscriptionDoc.id,
      status: subscription.status || null,
      literacyArcadePlan: subscription.literacyArcadePlan || subscription.metadata?.literacyArcadePlan || null,
      resolvedPlan: plan || null,
    });
    if (!plan || PLAN_PRIORITY[plan] <= PLAN_PRIORITY[bestPlan]) return;

    const priceIds = Array.from(collectPriceIds(subscription));
    bestPlan = plan;
    bestSubscription = subscriptionDoc.id;
    bestPriceId = priceIds.find((priceId) => PRICE_TO_PLAN[priceId] === plan) || priceIds[0] || null;
    bestStatus = subscription.status || null;
  });

  const planUpdate = {
    plan: bestPlan,
    planSource: 'stripe',
    planUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (bestPlan === 'free') {
    planUpdate.stripePriceId = admin.firestore.FieldValue.delete();
    planUpdate.stripeSubscriptionId = admin.firestore.FieldValue.delete();
    planUpdate.stripeStatus = admin.firestore.FieldValue.delete();
  } else {
    planUpdate.stripePriceId = bestPriceId;
    planUpdate.stripeSubscriptionId = bestSubscription;
    planUpdate.stripeStatus = bestStatus;
  }

  logger.info('Writing Literacy Arcade plan to user document.', {
    userId,
    userPath: `users/${userId}`,
    plan: bestPlan,
    stripePriceId: bestPriceId,
    stripeSubscriptionId: bestSubscription,
    stripeStatus: bestStatus,
  });

  await db.collection('users').doc(userId).set(planUpdate, { merge: true });

  logger.info('Synced Literacy Arcade plan from Stripe subscription state.', {
    userId,
    plan: bestPlan,
    stripePriceId: bestPriceId,
    stripeSubscriptionId: bestSubscription,
    stripeStatus: bestStatus,
  });
}

exports.syncUserPlanFromStripeSubscription = onDocumentWritten(
  'customers/{userId}/subscriptions/{subscriptionId}',
  async (event) => {
    const { userId, subscriptionId } = event.params;
    if (!userId) return;

    logger.info('Stripe subscription changed; recomputing user plan.', {
      userId,
      subscriptionId,
    });

    await recomputeUserPlan(userId);
  }
);

// Records completion of one of the four free-assessment tools and atomically
// increments the caller's shared assessment-use counter. This is the only
// code path allowed to write users/{uid}.assessmentUses — firestore.rules
// blocks clients from writing that field directly (same pattern already
// used for users/{uid}.plan), so a signed-in user cannot reset or lower
// their own count from browser JavaScript.
//
// Plus/family users are recorded for bookkeeping but are never blocked.
// Free users are recorded only while under the shared 5-assessment limit;
// once at the limit the function rejects instead of incrementing, so a
// user cannot inflate their own history by calling this directly without
// going through the client-side start gate.
//
// Idempotency: the client supplies a per-assessment-attempt `completionId`
// (a fresh UUID generated once per begin-assessment session, reused on any
// client-side retry of that same attempt). That id is used as the
// assessmentHistory document id. If a document with that id already exists,
// this call is a retry of an already-recorded completion — the function
// returns the current state without incrementing again, so a client retry
// after a dropped response can never double-count.
//
// Only minimal metadata is stored (assessment type + a server timestamp)
// in users/{uid}/assessmentHistory — no student names, responses, or scores.
exports.recordAssessmentCompletion = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to record an assessment.');
  }

  const assessmentType = request.data?.assessmentType;
  if (!ASSESSMENT_TYPES.has(assessmentType)) {
    throw new HttpsError('invalid-argument', 'Unknown assessment type.');
  }

  const completionId = request.data?.completionId;
  if (typeof completionId !== 'string' || !completionId || completionId.length > 200) {
    throw new HttpsError('invalid-argument', 'Missing or invalid completion id.');
  }

  const userRef = db.collection('users').doc(uid);
  const historyRef = userRef.collection('assessmentHistory').doc(completionId);

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, historySnap] = await Promise.all([tx.get(userRef), tx.get(historyRef)]);
    const data = userSnap.exists() ? userSnap.data() : {};
    const plan = data.plan;
    const currentUses = typeof data.assessmentUses === 'number' ? data.assessmentUses : 0;
    const unlimited = UNLIMITED_ASSESSMENT_PLANS.has(plan);

    if (historySnap.exists()) {
      // Retry of an attempt that was already recorded — return the current
      // state instead of incrementing a second time.
      return {
        recorded: true,
        uses: currentUses,
        plan: plan || 'free',
        unlimited,
        alreadyRecorded: true,
      };
    }

    if (!unlimited && currentUses >= FREE_ASSESSMENT_LIMIT) {
      return { recorded: false, uses: currentUses, plan: plan || 'free' };
    }

    const nextUses = currentUses + 1;
    tx.set(userRef, { assessmentUses: nextUses }, { merge: true });
    tx.set(historyRef, {
      assessmentType,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return { recorded: true, uses: nextUses, plan: plan || 'free', unlimited };
  });

  logger.info('Recorded Literacy Arcade assessment completion.', {
    uid,
    assessmentType,
    completionId,
    recorded: result.recorded,
    uses: result.uses,
    plan: result.plan,
    alreadyRecorded: Boolean(result.alreadyRecorded),
  });

  if (!result.recorded) {
    throw new HttpsError('resource-exhausted', 'Free assessment limit reached.');
  }

  return { uses: result.uses, plan: result.plan, unlimited: Boolean(result.unlimited) };
});
