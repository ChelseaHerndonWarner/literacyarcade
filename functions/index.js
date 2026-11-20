const { onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { computeCreateDecision, computeDeleteSeed, isEditLocked } = require('./activity-credits');
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

// ── Free-plan lifetime activity creations ───────────────────────────────────
// Free users get 5 total activity creations; deleting an activity never gives one back.
// Activities are created ONLY here: firestore.rules denies client creates under
// users/{uid}/activities, and this callable checks the plan and counter and creates the
// activity (plus its share link, when requested) in one transaction, so simultaneous saves or a
// modified browser cannot exceed the limit. users/{uid}.activitiesCreated is written only by
// server code (rules block client writes, like plan and assessmentUses). Plus/Family creations
// are logged but not counted. users/{uid}/creationHistory/{activityId} is the audit trail.
// Rules for counting live in activity-credits.js.
const MAX_ACTIVITY_BYTES = 900 * 1024;
// Fields the server controls on the private activity or never copies to the public share doc.
const PRIVATE_ONLY_KEYS = [
  'id', 'url', 'userId', 'ownerUid', 'savedActivityId',
  'createdAt', 'updatedAt', 'shareId', 'shareEnabled', 'sharedSetup', 'public',
];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

exports.createActivity = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to save an activity.');
  }

  const { requestId, activity, share } = request.data || {};
  if (typeof requestId !== 'string' || !/^[A-Za-z0-9_-]{16,64}$/.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Missing or invalid request id.');
  }
  if (!isPlainObject(activity)) {
    throw new HttpsError('invalid-argument', 'Missing activity.');
  }
  const toolType = activity.toolType || activity.activityType;
  if (typeof toolType !== 'string' || !toolType || toolType.length > 80) {
    throw new HttpsError('invalid-argument', 'Activity needs a toolType.');
  }
  if (Buffer.byteLength(JSON.stringify(activity), 'utf8') > MAX_ACTIVITY_BYTES) {
    throw new HttpsError('invalid-argument', 'Activity is too large.');
  }
  const url = typeof activity.url === 'string' && activity.url.length <= 200 ? activity.url : null;

  const userRef = db.collection('users').doc(uid);
  const activityRef = userRef.collection('activities').doc(requestId);
  const historyRef = userRef.collection('creationHistory').doc(requestId);
  // Only used to seed accounts that have no counter yet.
  const liveCount = (await userRef.collection('activities').count().get()).data().count;
  const FieldValue = admin.firestore.FieldValue;

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, activitySnap] = await Promise.all([tx.get(userRef), tx.get(activityRef)]);

    // Same request id again (double click, retry): return what was already created.
    if (activitySnap.exists) {
      return { id: requestId, shareId: activitySnap.data().shareId || null, alreadyCreated: true };
    }

    const data = userSnap.exists ? userSnap.data() : {};
    const decision = computeCreateDecision({
      plan: data.plan,
      activitiesCreated: data.activitiesCreated,
      liveCount,
    });

    if (!decision.allowed) {
      if (decision.seedCounter !== null && decision.seedCounter !== undefined) {
        tx.set(userRef, { activitiesCreated: decision.seedCounter }, { merge: true });
      }
      return { limitReached: true, count: decision.count };
    }

    const now = FieldValue.serverTimestamp();
    const publicFields = { ...activity };
    PRIVATE_ONLY_KEYS.forEach((key) => delete publicFields[key]);
    const privateDoc = { ...activity, userId: uid, createdAt: now, updatedAt: now };
    if ('ownerUid' in privateDoc) privateDoc.ownerUid = uid;
    if (url) privateDoc.url = url;
    ['shareId', 'public'].forEach((key) => delete privateDoc[key]);

    let shareId = null;
    if (share === true) {
      const sharedRef = db.collection('sharedActivities').doc();
      shareId = sharedRef.id;
      tx.create(sharedRef, { ...publicFields, public: true, ownerUid: uid, createdAt: now, updatedAt: now });
      privateDoc.shareEnabled = true;
      privateDoc.sharedSetup = true;
      privateDoc.shareId = shareId;
    }

    tx.create(activityRef, privateDoc);
    if (decision.nextCounter !== null) {
      tx.set(userRef, { activitiesCreated: decision.nextCounter }, { merge: true });
    }
    tx.set(historyRef, { toolType: toolType.slice(0, 80), counted: decision.counted, shared: share === true, createdAt: now });
    return { id: requestId, shareId, counted: decision.counted };
  });

  logger.info('createActivity', { uid, requestId, toolType, ...result });

  if (result.limitReached) {
    throw new HttpsError('resource-exhausted', 'Free activity creation limit reached.', { count: result.count });
  }
  return { id: result.id, shareId: result.shareId || null, alreadyCreated: Boolean(result.alreadyCreated) };
});

// Shares an activity the user ALREADY saved. Uses no credit and is allowed even after the
// Free credits are used up (saved activities are read-only then, but can still be shared).
// The public copy is built here from the saved activity, never from client-supplied content,
// so a read-only account cannot publish changed words/settings through this path.
// firestore.rules denies client creates on sharedActivities, so this and createActivity are
// the only ways a share link is made.
const UNSHAREABLE_TOOLS = new Set(['letterbox-lesson']);

exports.shareActivity = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to share an activity.');
  }
  const activityId = request.data?.activityId;
  if (typeof activityId !== 'string' || !activityId || activityId.length > 200 || activityId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Missing or invalid activity id.');
  }

  // forceNew: publish a fresh link of the (just edited) saved content. Honored only while the
  // account can still edit; a read-only account always gets its existing link.
  const forceNew = request.data?.forceNew === true;
  const userRef = db.collection('users').doc(uid);
  const activityRef = userRef.collection('activities').doc(activityId);
  const FieldValue = admin.firestore.FieldValue;

  const result = await db.runTransaction(async (tx) => {
    const [snap, userSnap] = await Promise.all([tx.get(activityRef), tx.get(userRef)]);
    if (!snap.exists) return { notFound: true };
    const wantNew = forceNew && !isEditLocked(userSnap.exists ? userSnap.data() : {});
    const activity = snap.data();
    const toolType = activity.toolType || activity.activityType;
    if (typeof toolType !== 'string' || UNSHAREABLE_TOOLS.has(toolType)) return { unshareable: true };

    // Already shared and the link still exists: return it unchanged.
    if (!wantNew && typeof activity.shareId === 'string' && activity.shareId) {
      const existingRef = db.collection('sharedActivities').doc(activity.shareId);
      const existing = await tx.get(existingRef);
      if (existing.exists && existing.data().ownerUid === uid) {
        return { shareId: activity.shareId, alreadyShared: true };
      }
    }

    const publicFields = { ...activity };
    PRIVATE_ONLY_KEYS.forEach((key) => delete publicFields[key]);
    const sharedRef = db.collection('sharedActivities').doc();
    const now = FieldValue.serverTimestamp();
    tx.create(sharedRef, { ...publicFields, public: true, ownerUid: uid, createdAt: now, updatedAt: now });
    tx.update(activityRef, { shareEnabled: true, sharedSetup: true, shareId: sharedRef.id });
    return { shareId: sharedRef.id };
  });

  if (result.notFound) throw new HttpsError('not-found', 'Activity not found.');
  if (result.unshareable) throw new HttpsError('failed-precondition', 'This activity type cannot be shared.');
  logger.info('shareActivity', { uid, activityId, ...result });
  return { shareId: result.shareId, alreadyShared: Boolean(result.alreadyShared) };
});

// Safety net for accounts that have no counter yet: if one deletes an activity
// before ever creating another, seed the counter now so the deleted activity
// still counts. Accounts that already have a counter are left alone.
exports.seedActivityCounterOnDelete = onDocumentDeleted(
  'users/{uid}/activities/{activityId}',
  async (event) => {
    const { uid, activityId } = event.params;
    const userRef = db.collection('users').doc(uid);
    const liveCountAfter = (await userRef.collection('activities').count().get()).data().count;

    const seeded = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      const data = userSnap.exists ? userSnap.data() : {};
      const seed = computeDeleteSeed({
        plan: data.plan,
        activitiesCreated: data.activitiesCreated,
        liveCountAfter,
      });
      if (seed === null) return null;
      tx.set(userRef, { activitiesCreated: seed }, { merge: true });
      return seed;
    });

    if (seeded !== null) {
      logger.info('Seeded activity-creation counter on delete.', { uid, activityId, seeded });
    }
  }
);
