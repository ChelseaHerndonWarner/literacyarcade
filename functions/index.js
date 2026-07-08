const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { logger } = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const db = admin.firestore();

const ACTIVE_STATUSES = new Set(['active', 'trialing']);
const PRICE_TO_PLAN = {
  price_1TqmEK3PzX3bHrbQEkK6vaes: 'founding',
  price_1TqmEJ3PzX3bHrbQ2cWDevb5: 'plus',
  price_1TqmEM3PzX3bHrbQh3wylsSF: 'plus',
  price_1TqY6k4Gz51pZDtQR6oFrYDp: 'founding',
  price_1TqY5P4Gz51pZDtQOiymXQZ4: 'plus',
  price_1TqY444Gz51pZDtQmTMOq3Gv: 'plus',
};
const PLAN_PRIORITY = {
  free: 0,
  plus: 1,
  founding: 2,
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
