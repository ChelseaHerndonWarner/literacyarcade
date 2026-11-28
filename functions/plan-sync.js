// Keeps users/{uid}.plan equal to the best of the account's Stripe subscriptions and its manual
// grant (see entitlements.js). Dependencies are passed in so this can be tested directly.
//
// This code never creates grants. Only an administrator does, so an account that paid through
// Stripe can never become a permanent manual member on its own. A plan typed straight onto
// users/{uid} is not a grant: the next sync replaces it.
const { rank, resolveEntitlement } = require('./entitlements');

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
  if (explicitPlan && rank(explicitPlan) > rank('free')) {
    return explicitPlan;
  }

  const priceIds = collectPriceIds(subscription);
  let bestPlan = null;

  priceIds.forEach((priceId) => {
    const plan = PRICE_TO_PLAN[priceId];
    if (!plan) return;
    if (!bestPlan || rank(plan) > rank(bestPlan)) {
      bestPlan = plan;
    }
  });

  return bestPlan;
}

function bestStripeSubscription(docs) {
  let best = { plan: 'free', subscriptionId: null, priceId: null, status: null };
  docs.forEach((subscriptionDoc) => {
    const subscription = subscriptionDoc.data();
    const plan = getBestPlanFromSubscription(subscription);
    if (!plan || rank(plan) <= rank(best.plan)) return;
    const priceIds = Array.from(collectPriceIds(subscription));
    best = {
      plan,
      subscriptionId: subscriptionDoc.id,
      priceId: priceIds.find((priceId) => PRICE_TO_PLAN[priceId] === plan) || priceIds[0] || null,
      status: subscription.status || null,
    };
  });
  return best;
}

function createPlanSync({ db, FieldValue, logger, now = () => Date.now() }) {
  async function recomputeUserPlan(userId) {
    const userRef = db.collection('users').doc(userId);
    const grantRef = db.collection('planGrants').doc(userId);
    const subscriptionsRef = db.collection('customers').doc(userId).collection('subscriptions');

    // One transaction, so a webhook and an administrator's grant change cannot overwrite each other.
    const result = await db.runTransaction(async (tx) => {
      const [grantSnap, subscriptionsSnap] = await Promise.all([tx.get(grantRef), tx.get(subscriptionsRef)]);
      const grant = grantSnap.exists ? grantSnap.data() : null;

      const stripe = bestStripeSubscription(subscriptionsSnap);
      const entitlement = resolveEntitlement({
        stripePlan: stripe.plan,
        hasStripeRecords: !subscriptionsSnap.empty,
        grant,
        nowMs: now(),
      });
      const orDelete = (value) => (value === null ? FieldValue.delete() : value);
      const fromStripe = stripe.plan !== 'free';

      tx.set(userRef, {
        plan: entitlement.plan,
        planSource: entitlement.planSource,
        planUpdatedAt: FieldValue.serverTimestamp(),
        planExpiresAt: orDelete(entitlement.planExpiresAt),
        planAfterExpiry: orDelete(entitlement.planAfterExpiry),
        // These always describe the Stripe subscription, even when a manual grant is higher.
        stripePriceId: orDelete(fromStripe ? stripe.priceId : null),
        stripeSubscriptionId: orDelete(fromStripe ? stripe.subscriptionId : null),
        stripeStatus: orDelete(fromStripe ? stripe.status : null),
      }, { merge: true });

      return { plan: entitlement.plan, planSource: entitlement.planSource, stripePlan: stripe.plan, grantState: entitlement.grantState };
    });

    if (result.grantState === 'invalid') {
      logger.warn('Manual plan grant is invalid and gives no access. Check plan and expiresAt.', { userId });
    }
    logger.info('Synced Literacy Arcade plan.', { userId, ...result });
    return result;
  }

  // Rewrites accounts whose manual grant has ended. Safe to run repeatedly.
  async function sweepExpiredGrants({ batchSize = 200 } = {}) {
    const due = await db.collection('users').where('planExpiresAt', '<=', new Date(now())).limit(batchSize).get();
    let updated = 0;
    let failed = 0;
    for (const userSnap of due.docs) {
      try {
        await recomputeUserPlan(userSnap.id);
        updated += 1;
      } catch (error) {
        failed += 1;
        logger.error('Could not expire a manual plan grant.', { userId: userSnap.id, message: error.message });
      }
    }
    return { due: due.docs.length, updated, failed };
  }

  return { recomputeUserPlan, sweepExpiredGrants };
}

module.exports = { PRICE_TO_PLAN, createPlanSync, getBestPlanFromSubscription };
