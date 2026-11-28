const { onDocumentWritten, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { logger } = require('firebase-functions');
const { computeCreateDecision, computeDeleteSeed, isEditLocked } = require('./activity-credits');
const { buildPublicFields } = require('./public-share');
const { effectivePlan, isPaidPlan } = require('./entitlements');
const { createPlanSync } = require('./plan-sync');
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
const FREE_ASSESSMENT_LIMIT = 5;

// Plans come from Stripe subscriptions and manual grants (planGrants/{uid}); the two are kept
// independent and combined in plan-sync.js. See entitlements.js for the rules.
const { recomputeUserPlan, sweepExpiredGrants } = createPlanSync({ db, FieldValue, logger });

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

exports.syncUserPlanFromManualGrant = onDocumentWritten('planGrants/{userId}', async (event) => {
  const { userId } = event.params;
  if (!userId) return;
  logger.info('Manual plan grant changed; recomputing user plan.', { userId });
  await recomputeUserPlan(userId);
});

// Grants end without any document changing, so look for them on a schedule. Server checks use
// effectivePlan() and stop at the exact expiry time; this updates what pages and rules read.
exports.expireManualPlanGrants = onSchedule('every 15 minutes', async () => {
  const result = await sweepExpiredGrants();
  logger.info('Checked for expired manual plan grants.', result);
});

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
    const data = userSnap.exists ? userSnap.data() : {};
    const plan = effectivePlan(data);
    const currentUses = typeof data.assessmentUses === 'number' ? data.assessmentUses : 0;
    const unlimited = isPaidPlan(plan);

    if (historySnap.exists) {
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
      completedAt: FieldValue.serverTimestamp(),
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

// Shared-link expiration. Teachers pick 7, 14, or 30 days (default 14); anything else falls back
// to the default rather than erroring, since this is a convenience choice, not a security
// boundary. A link's expiresAt is fixed at mint/renew time; firestore.rules is what actually
// enforces it on every read (see sharedActivities rule), not this value by itself.
const ALLOWED_SHARE_DAYS = new Set([7, 14, 30]);
const DEFAULT_SHARE_DAYS = 14;
function resolveShareDays(days) {
  return ALLOWED_SHARE_DAYS.has(days) ? days : DEFAULT_SHARE_DAYS;
}
function computeExpiresAt(days) {
  return Timestamp.fromMillis(Date.now() + resolveShareDays(days) * 24 * 60 * 60 * 1000);
}

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

  const result = await db.runTransaction(async (tx) => {
    const [userSnap, activitySnap] = await Promise.all([tx.get(userRef), tx.get(activityRef)]);

    // Same request id again (double click, retry): return what was already created.
    if (activitySnap.exists) {
      return { id: requestId, shareId: activitySnap.data().shareId || null, alreadyCreated: true };
    }

    const data = userSnap.exists ? userSnap.data() : {};
    const decision = computeCreateDecision({
      plan: effectivePlan(data),
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
    const publicFields = buildPublicFields(activity);
    const privateDoc = { ...activity, userId: uid, createdAt: now, updatedAt: now };
    if ('ownerUid' in privateDoc) privateDoc.ownerUid = uid;
    if (url) privateDoc.url = url;
    ['shareId', 'public'].forEach((key) => delete privateDoc[key]);

    let shareId = null;
    let expiresAtMillis = null;
    if (share === true) {
      const sharedRef = db.collection('sharedActivities').doc();
      shareId = sharedRef.id;
      const expiresAt = computeExpiresAt(request.data?.shareDays);
      expiresAtMillis = expiresAt.toMillis();
      tx.create(sharedRef, {
        ...publicFields, public: true, ownerUid: uid, activityId: requestId, expiresAt, createdAt: now, updatedAt: now
      });
      privateDoc.shareEnabled = true;
      privateDoc.sharedSetup = true;
      privateDoc.shareId = shareId;
      privateDoc.shareIds = [shareId];
    }

    tx.create(activityRef, privateDoc);
    if (decision.nextCounter !== null) {
      tx.set(userRef, { activitiesCreated: decision.nextCounter }, { merge: true });
    }
    tx.set(historyRef, { toolType: toolType.slice(0, 80), counted: decision.counted, shared: share === true, createdAt: now });
    return { id: requestId, shareId, expiresAtMillis, counted: decision.counted };
  });

  logger.info('createActivity', { uid, requestId, toolType, ...result });

  if (result.limitReached) {
    throw new HttpsError('resource-exhausted', 'Free activity creation limit reached.', { count: result.count });
  }
  return {
    id: result.id,
    shareId: result.shareId || null,
    expiresAtMillis: result.expiresAtMillis ?? null,
    alreadyCreated: Boolean(result.alreadyCreated)
  };
});

// Shares an activity the user ALREADY saved. Uses no credit and is allowed even after the
// Free credits are used up (saved activities are read-only then, but can still be shared).
// The public copy is built here from the saved activity, never from client-supplied content,
// so a read-only account cannot publish changed words/settings through this path. Only an
// allowlist of fields is published (see public-share.js).
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

  // action: 'renew' extends the expiration of the existing live link (same URL, so a Google
  // Classroom assignment never needs updating); 'new' mints a replacement link and invalidates
  // the old one; anything else (or omitted) just ensures a link exists, reusing the current one
  // if it's still live. `forceNew` is kept as an alias for 'new' for backward compatibility.
  // 'new' is honored only while the account can still edit (same gate as content edits); a
  // read-only account keeps whatever link it already has, same as before this field existed.
  const action = request.data?.action === 'renew' ? 'renew'
    : (request.data?.action === 'new' || request.data?.forceNew === true) ? 'new'
    : 'share';
  const days = resolveShareDays(request.data?.days);
  const userRef = db.collection('users').doc(uid);
  const activityRef = userRef.collection('activities').doc(activityId);

  const result = await db.runTransaction(async (tx) => {
    const [snap, userSnap] = await Promise.all([tx.get(activityRef), tx.get(userRef)]);
    if (!snap.exists) return { notFound: true };
    const activity = snap.data();
    const toolType = activity.toolType || activity.activityType;
    if (typeof toolType !== 'string' || UNSHAREABLE_TOOLS.has(toolType)) return { unshareable: true };

    const currentShareId = typeof activity.shareId === 'string' && activity.shareId ? activity.shareId : null;
    const currentRef = currentShareId ? db.collection('sharedActivities').doc(currentShareId) : null;
    const currentSnap = currentRef ? await tx.get(currentRef) : null;
    const currentLive = Boolean(currentSnap && currentSnap.exists && currentSnap.data().ownerUid === uid);
    const now = FieldValue.serverTimestamp();

    if (action === 'renew') {
      if (!currentLive) return { noActiveLink: true };
      const expiresAt = computeExpiresAt(days);
      tx.update(currentRef, { expiresAt, updatedAt: now });
      return { shareId: currentShareId, renewed: true, expiresAtMillis: expiresAt.toMillis() };
    }

    // Reuse the existing live link unless this is a non-locked 'new' request, which always mints
    // a fresh one and invalidates the old. A locked account's 'new' request behaves like 'share'.
    const owner = userSnap.exists ? userSnap.data() : {};
    const mintFresh = action === 'new' && !isEditLocked({ ...owner, plan: effectivePlan(owner) });
    if (!mintFresh && currentLive) {
      const existingExpiresAt = currentSnap.data().expiresAt;
      return {
        shareId: currentShareId,
        alreadyShared: true,
        expiresAtMillis: existingExpiresAt ? existingExpiresAt.toMillis() : null
      };
    }

    const publicFields = buildPublicFields(activity);
    const sharedRef = db.collection('sharedActivities').doc();
    const expiresAt = computeExpiresAt(days);
    tx.create(sharedRef, {
      ...publicFields, public: true, ownerUid: uid, activityId, expiresAt, createdAt: now, updatedAt: now
    });
    // Old shareId's public doc is invalidated (deleted), not just unreferenced, so a replacement
    // link actually stops the previous URL from working, as required.
    if (mintFresh && currentLive) tx.delete(currentRef);
    const priorShareIds = Array.isArray(activity.shareIds)
      ? activity.shareIds
      : (currentShareId ? [currentShareId] : []);
    tx.update(activityRef, {
      shareEnabled: true,
      sharedSetup: true,
      shareId: sharedRef.id,
      shareIds: [...new Set([...priorShareIds, sharedRef.id])]
    });
    return {
      shareId: sharedRef.id,
      replaced: Boolean(mintFresh && currentLive),
      expiresAtMillis: expiresAt.toMillis()
    };
  });

  if (result.notFound) throw new HttpsError('not-found', 'Activity not found.');
  if (result.unshareable) throw new HttpsError('failed-precondition', 'This activity type cannot be shared.');
  if (result.noActiveLink) {
    throw new HttpsError('failed-precondition', 'There is no active link to renew. Generate a new link instead.');
  }
  logger.info('shareActivity', { uid, activityId, action, ...result });
  return {
    shareId: result.shareId,
    alreadyShared: Boolean(result.alreadyShared),
    renewed: Boolean(result.renewed),
    replaced: Boolean(result.replaced),
    expiresAtMillis: result.expiresAtMillis ?? null
  };
});

// Lets an owner revoke their current shared link immediately, without waiting for expiration.
// Deliberately not a plain client-side delete of the sharedActivities doc: clearing the owning
// activity's own shareId/shareEnabled afterward (so a later Renew can't resurrect it, and the
// dashboard stops offering to copy a dead link) is an update to users/{uid}/activities/{id},
// which firestore.rules blocks for a read-only (limit-reached) Free account — but revoking must
// work regardless of plan state, so this goes through the Admin SDK instead. Revoked links must
// not become active again through the ordinary Renew action: Renew requires a live shareId on
// the activity doc, and this clears it.
exports.revokeSharedLink = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to revoke a shared link.');
  }
  const activityId = request.data?.activityId;
  if (typeof activityId !== 'string' || !activityId || activityId.length > 200 || activityId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Missing or invalid activity id.');
  }

  const activityRef = db.collection('users').doc(uid).collection('activities').doc(activityId);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(activityRef);
    if (!snap.exists) return { notFound: true };
    const activity = snap.data();
    const shareId = typeof activity.shareId === 'string' && activity.shareId ? activity.shareId : null;
    if (!shareId) return { noActiveLink: true };

    const sharedRef = db.collection('sharedActivities').doc(shareId);
    const sharedSnap = await tx.get(sharedRef);
    if (sharedSnap.exists && sharedSnap.data().ownerUid === uid) tx.delete(sharedRef);

    tx.update(activityRef, {
      shareEnabled: false,
      shareId: FieldValue.delete(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return { revoked: true };
  });

  if (result.notFound) throw new HttpsError('not-found', 'Activity not found.');
  logger.info('revokeSharedLink', { uid, activityId, ...result });
  return { revoked: Boolean(result.revoked), hadNoActiveLink: Boolean(result.noActiveLink) };
});

// Deletes a saved activity AND every shared link it ever produced, in one transaction, so the
// dashboard can confirm "deleted" only once access has actually been revoked — not just once the
// activity doc is gone and an async trigger has merely been scheduled. This is the ONLY code
// path, client or server, that should ever delete users/{uid}/activities/{id}: firestore.rules no
// longer grants clients a direct delete on that collection (see the matching rules change), so
// every deletion funnels through here. cleanupSharedLinksOnActivityDelete (the onDocumentDeleted
// trigger) is left in place as a defense-in-depth fallback: it re-checks the same shareIds
// history and is a safe no-op against docs this function already removed, so it costs nothing to
// keep and still protects against any future code path that deletes the doc another way.
//
// Firestore limits: a transaction holds the same ~500-mutation cap as a batch write. This deletes
// 1 (the activity) + up to N (its shareIds history) documents. N only grows one at a time, from a
// teacher clicking "Generate New Link," so reaching anywhere near that cap is not a realistic
// concern at current usage — flagged here, not solved, since solving it (chunking into multiple
// batches) would cost the all-or-nothing atomicity this function exists to provide.
exports.deleteActivityAndLinks = onCall(async (request) => {
  const uid = request.auth?.uid;
  if (!uid) {
    throw new HttpsError('unauthenticated', 'Sign in to delete an activity.');
  }
  const activityId = request.data?.activityId;
  if (typeof activityId !== 'string' || !activityId || activityId.length > 200 || activityId.includes('/')) {
    throw new HttpsError('invalid-argument', 'Missing or invalid activity id.');
  }

  const activityRef = db.collection('users').doc(uid).collection('activities').doc(activityId);

  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(activityRef);
    if (!snap.exists) return { notFound: true };
    const activity = snap.data();

    const shareIds = new Set(Array.isArray(activity.shareIds) ? activity.shareIds : []);
    if (typeof activity.shareId === 'string' && activity.shareId) shareIds.add(activity.shareId);
    const shareRefs = [...shareIds].map((id) => db.collection('sharedActivities').doc(id));

    // All reads in a Firestore transaction must happen before any write; getAll reads every
    // candidate link in one consistent snapshot alongside the activity read above.
    const shareSnaps = shareRefs.length ? await tx.getAll(...shareRefs) : [];

    let revokedCount = 0;
    shareSnaps.forEach((shareSnap, i) => {
      // Only ever deletes a link this same owner actually owns — defensive, since shareIds is
      // populated only by this owner's own share/renew/new calls in the first place.
      if (shareSnap.exists && shareSnap.data().ownerUid === uid) {
        tx.delete(shareRefs[i]);
        revokedCount += 1;
      }
    });

    tx.delete(activityRef);
    return { deleted: true, revokedCount, linkCount: shareIds.size };
  });

  if (result.notFound) throw new HttpsError('not-found', 'Activity not found.');
  logger.info('deleteActivityAndLinks', { uid, activityId, ...result });
  return { deleted: true, revokedCount: result.revokedCount };
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
        plan: effectivePlan(data),
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

// When an owner deletes a saved activity, every shared link it ever produced must stop working
// too — not just the current one. Clients can't be trusted to enumerate and delete every
// sharedActivities doc themselves (sharedActivities disallows `list`, by design, so students
// can't browse it), so this runs server-side on the delete trigger, from the deleted activity's
// own `shareIds` history (falling back to its single legacy `shareId` for activities saved
// before that array existed). This can only find links this activity's own document still
// remembers: a shareId from a much older re-share, made before `shareIds` existed and since
// overwritten by a later one, was never recorded anywhere and cannot be discovered or cleaned up
// by this (or any) code — a pre-existing gap in the data model, not something this change can
// retroactively fix without a backfill, which was out of scope here.
exports.cleanupSharedLinksOnActivityDelete = onDocumentDeleted(
  'users/{uid}/activities/{activityId}',
  async (event) => {
    const { uid, activityId } = event.params;
    const deleted = event.data?.data() || {};
    const shareIds = new Set(Array.isArray(deleted.shareIds) ? deleted.shareIds : []);
    if (typeof deleted.shareId === 'string' && deleted.shareId) shareIds.add(deleted.shareId);
    if (shareIds.size === 0) return;

    const batch = db.batch();
    let count = 0;
    for (const shareId of shareIds) {
      const ref = db.collection('sharedActivities').doc(shareId);
      // eslint-disable-next-line no-await-in-loop
      const snap = await ref.get();
      if (snap.exists && snap.data().ownerUid === uid) {
        batch.delete(ref);
        count += 1;
      }
    }
    if (count > 0) await batch.commit();
    logger.info('Cleaned up shared links for deleted activity.', { uid, activityId, count });
  }
);
