// End-to-end tests of plan access, saved activities, sharing and student links against LOCAL
// Firebase emulators only. Run with: bash tests/e2e/run.sh
// Uses the real functions and firestore.rules, unmodified.
const assert = require('assert');
const crypto = require('crypto');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '../..');
const fromFunctions = createRequire(path.join(ROOT, 'functions/package.json'));
const { createPlanSync } = fromFunctions('./plan-sync');
const PROJECT = 'demo-literacy-arcade';
const { FIRESTORE_EMULATOR_HOST: FS, FIREBASE_AUTH_EMULATOR_HOST: AUTH } = process.env;
for (const [name, host] of Object.entries({ FS, AUTH })) {
  assert(host && /^(127\.0\.0\.1|localhost):\d+$/.test(host), `refusing to run: ${name} is not a local emulator (${host})`);
}
const admin = fromFunctions('firebase-admin');
const { FieldValue, Timestamp } = fromFunctions('firebase-admin/firestore');
admin.initializeApp({ projectId: PROJECT });
const db = admin.firestore();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
async function test(group, name, fn) {
  try { await fn(); results.push([group, name, 'PASS']); }
  catch (error) { results.push([group, name, 'FAIL: ' + error.message.split('\n')[0]]); }
}

let sequence = 0;
const nextId = (label) => `${label}-${Date.now()}-${(sequence += 1)}`;
async function signUp(label) {
  const res = await fetch(`http://${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${nextId(label)}@example.com`, password: crypto.randomBytes(12).toString('hex'), returnSecureToken: true }),
  });
  const json = await res.json();
  assert(json.idToken, 'emulator sign-up failed');
  return { uid: json.localId, token: json.idToken };
}

async function callable(name, user, data) {
  const headers = { 'Content-Type': 'application/json' };
  if (user) headers.Authorization = `Bearer ${user.token}`;
  const res = await fetch(`http://127.0.0.1:5001/${PROJECT}/us-central1/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  const json = await res.json().catch(() => ({}));
  return { status: json.error?.status || (res.ok ? 'OK' : 'HTTP_' + res.status), result: json.result };
}

// Browser-style Firestore requests, checked by firestore.rules.
const str = (v) => ({ stringValue: v });
const firestore = (user, method, docPath, fields, query = '') => fetch(
  `http://${FS}/v1/projects/${PROJECT}/databases/(default)/documents/${docPath}${query}`,
  { method, headers: { ...(user ? { Authorization: `Bearer ${user.token}` } : {}), 'Content-Type': 'application/json' }, body: fields && JSON.stringify({ fields }) });

const userData = async (uid) => (await db.doc(`users/${uid}`).get()).data();
const plan = async (uid) => (await userData(uid))?.plan;
const grantExists = async (uid) => (await db.doc(`planGrants/${uid}`).get()).exists;
const activity = { title: 'Game', toolType: 'read-and-race', activityType: 'read-and-race', words: ['cat'], settings: {} };

// An account whose Free allowances are used up, so only a paid plan can edit or run assessments.
async function account(label, fields = {}) {
  const u = await signUp(label);
  await db.doc(`users/${u.uid}`).set({ activitiesCreated: 5, assessmentUses: 5, ...fields });
  await db.doc(`users/${u.uid}/activities/probe`).set(activity);
  return u;
}
async function expectAccess(u, paid, label = '') {
  const edit = await firestore(u, 'PATCH', `users/${u.uid}/activities/probe`, { title: str('edited') }, '?updateMask.fieldPaths=title');
  assert.strictEqual(edit.status, paid ? 200 : 403, `${label} edit saved activity`);
  const assessment = await callable('recordAssessmentCompletion', u, { assessmentType: 'quick-letter-knowledge', completionId: nextId('done') });
  assert.strictEqual(assessment.status, paid ? 'OK' : 'RESOURCE_EXHAUSTED', `${label} assessment`);
  const created = await callable('createActivity', u, { requestId: nextId('request').padEnd(20, '0').slice(0, 60), activity });
  assert.strictEqual(created.status, paid ? 'OK' : 'RESOURCE_EXHAUSTED', `${label} create activity`);
}

// Writes a Stripe-extension-shaped record (or a grant) and waits for the real trigger to run.
const PRICE = { plus: 'price_1TqmEJ3PzX3bHrbQ2cWDevb5', founding: 'price_1TqmEK3PzX3bHrbQEkK6vaes', family: 'price_1TssAC3PzX3bHrbQg4qIhxOH' };
async function waitFor(what, check) {
  for (let i = 0; i < 160; i += 1) { if (await check()) return; await sleep(250); }
  throw new Error('timed out waiting for ' + what);
}
async function waitForSync(uid, change) {
  const stamp = async () => (await userData(uid))?.planUpdatedAt?.toMillis() || 0;
  const before = await stamp();
  await change();
  await waitFor('plan sync', async () => (await stamp()) > before);
}
const setSub = (uid, id, status, price = PRICE.plus, extra = {}) => waitForSync(uid, () =>
  db.doc(`customers/${uid}/subscriptions/${id}`).set({ status, items: [{ price: { id: price } }], stamp: nextId('s'), ...extra }));
const setGrant = (uid, data) => waitForSync(uid, () => db.doc(`planGrants/${uid}`).set(data));
const INACTIVE = ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

(async () => {
  await test('0 Runtime', `test process runs on Node ${process.versions.node}`, async () => {
    assert.strictEqual(process.versions.node.split('.')[0], process.env.EXPECT_NODE || fromFunctions('./package.json').engines.node);
  });

  // ── Stripe customers ──
  await test('1 Stripe', 'a current paying customer keeps access before any sync runs', async () => {
    const u = await account('current', { plan: 'plus', planSource: 'stripe' });
    await expectAccess(u, true);
    assert.strictEqual(await grantExists(u.uid), false);
  });
  for (const [label, price, expected] of [['Plus', PRICE.plus, 'plus'], ['founding price', PRICE.founding, 'plus'], ['Family', PRICE.family, 'family']]) {
    await test('1 Stripe', `new ${label} subscription gives ${expected} and no grant`, async () => {
      const u = await account('new');
      await expectAccess(u, false, 'before');
      await setSub(u.uid, 's1', 'active', price);
      assert.strictEqual(await plan(u.uid), expected); await expectAccess(u, true);
      assert.strictEqual(await grantExists(u.uid), false);
    });
  }
  await test('1 Stripe', 'trial and scheduled cancellation keep access; deletion ends it', async () => {
    const u = await account('life');
    await setSub(u.uid, 's1', 'trialing'); await expectAccess(u, true, 'trial');
    await setSub(u.uid, 's1', 'active', PRICE.plus, { cancel_at_period_end: true }); await expectAccess(u, true, 'cancels later');
    await waitForSync(u.uid, () => db.doc(`customers/${u.uid}/subscriptions/s1`).delete());
    await expectAccess(u, false, 'deleted');
  });
  for (const status of INACTIVE) {
    await test('1 Stripe', `${status} ends access with no grant`, async () => {
      const u = await account('ends');
      await setSub(u.uid, 's1', 'active'); await setSub(u.uid, 's1', status);
      assert.strictEqual(await plan(u.uid), 'free'); await expectAccess(u, false);
      assert.strictEqual(await grantExists(u.uid), false);
    });
  }
  await test('1 Stripe', 'an old canceled record beside a new active one keeps access', async () => {
    const u = await account('resub');
    await setSub(u.uid, 's2', 'active'); await setSub(u.uid, 's1', 'canceled');
    await expectAccess(u, true);
  });
  await test('1 Stripe', 'source label missing: cancellation still ends access, no grant', async () => {
    const u = await account('unlabelled', { plan: 'plus', stripeSubscriptionId: 's1' });
    await setSub(u.uid, 's1', 'canceled');
    assert.strictEqual(await plan(u.uid), 'free'); await expectAccess(u, false);
    assert.strictEqual(await grantExists(u.uid), false);
  });

  // ── Typed-in manual plans moved to grants ──
  const levels = ['family', 'family', 'plus', 'plus'];
  const members = [];
  for (const level of levels) members.push([await account('manual', { plan: level }), level]);
  await test('2 Manual move', 'typed plans work with the new code before their grants exist', async () => {
    for (const [u, level] of members) { assert.strictEqual(await plan(u.uid), level); await expectAccess(u, true, level); }
  });
  await test('2 Manual move', 'creating undated grants keeps each level', async () => {
    for (const [u, level] of members) {
      await setGrant(u.uid, { plan: level });
      const data = await userData(u.uid);
      assert.deepStrictEqual([data.plan, data.planSource, data.planExpiresAt], [level, 'manual', undefined]);
      assert.strictEqual(data.assessmentUses >= 5, true);
      await expectAccess(u, true, level);
    }
  });
  await test('2 Manual move', 'Stripe records of any status do not change their levels', async () => {
    for (const [index, [u, level]] of members.entries()) {
      await setSub(u.uid, 's1', INACTIVE[index]); assert.strictEqual(await plan(u.uid), level);
      await setSub(u.uid, 's1', 'active'); assert.strictEqual(await plan(u.uid), level);
      await setSub(u.uid, 's1', 'canceled'); assert.strictEqual(await plan(u.uid), level);
      await expectAccess(u, true, level);
    }
  });
  await test('2 Manual move', 'Stripe Family over manual Plus, then back to Plus', async () => {
    const [u] = members[3];
    await setSub(u.uid, 's9', 'active', PRICE.family); assert.strictEqual(await plan(u.uid), 'family');
    await setSub(u.uid, 's9', 'canceled', PRICE.family); assert.strictEqual(await plan(u.uid), 'plus');
  });
  await test('2 Manual move', 'removing a grant removes access', async () => {
    const [u] = members[2];
    await waitForSync(u.uid, () => db.doc(`planGrants/${u.uid}`).delete());
    assert.strictEqual(await plan(u.uid), 'free'); await expectAccess(u, false);
  });
  await test('2 Manual move', 'a typed plan with no grant is not turned into one', async () => {
    const u = await account('missed', { plan: 'family' });
    await setSub(u.uid, 's1', 'canceled');
    assert.strictEqual(await plan(u.uid), 'free'); assert.strictEqual(await grantExists(u.uid), false);
  });

  await test('3 Expiry', 'a dated grant stops at its end time; the sweep then updates the plan', async () => {
    const u = await account('dated');
    const ends = Date.now() + 9000;
    await setGrant(u.uid, { plan: 'family', expiresAt: Timestamp.fromMillis(ends) });
    await expectAccess(u, true, 'while granted');
    await sleep(Math.max(0, ends - Date.now()) + 750);
    assert.strictEqual(await plan(u.uid), 'family', 'stored plan has not been swept yet');
    await expectAccess(u, false, 'after end');
    const sweep = await createPlanSync({ db, FieldValue, logger: { info() {}, warn() {}, error() {} } }).sweepExpiredGrants();
    assert(sweep.updated >= 1 && sweep.failed === 0, JSON.stringify(sweep));
    const after = await userData(u.uid);
    assert.deepStrictEqual([after.plan, after.planExpiresAt, after.planAfterExpiry], ['free', undefined, undefined]);
  });
  await test('3 Expiry', 'a misspelled grant gives no access', async () => {
    const u = await account('typo');
    await setGrant(u.uid, { plan: 'Family' });
    await expectAccess(u, false);
  });

  // ── Browser protections ──
  await test('4 Protection', 'browsers cannot read or write grants, plan fields or Stripe records', async () => {
    const u = await account('attacker', { plan: 'free' });
    const attempts = [
      await firestore(u, 'PATCH', `planGrants/${u.uid}`, { plan: str('family') }),
      await firestore(u, 'GET', `planGrants/${u.uid}`),
      await firestore(u, 'PATCH', `customers/${u.uid}/subscriptions/fake`, { status: str('active') }),
    ];
    for (const field of ['plan', 'planSource', 'planUpdatedAt', 'planExpiresAt', 'planAfterExpiry', 'stripeStatus', 'stripePriceId', 'stripeSubscriptionId', 'activitiesCreated', 'assessmentUses']) {
      attempts.push(await firestore(u, 'PATCH', `users/${u.uid}`, { [field]: str('family') }, `?updateMask.fieldPaths=${field}`));
    }
    const fresh = await signUp('selfmade');
    attempts.push(await firestore(fresh, 'PATCH', `users/${fresh.uid}`, { plan: str('plus') }));
    assert.deepStrictEqual(attempts.map((r) => r.status), attempts.map(() => 403));
  });
  await test('4 Protection', 'sign-in profile writes still work, including on a paid account', async () => {
    const u = await signUp('profile');
    const when = { timestampValue: new Date().toISOString() };
    const first = await firestore(u, 'PATCH', `users/${u.uid}`, { displayName: str('t'), email: str('t@example.com'), createdAt: when, lastLoginAt: when, lastSeenAt: when });
    assert.strictEqual(first.status, 200, 'first sign-in');
    await db.doc(`users/${u.uid}`).set({ plan: 'plus', planSource: 'stripe' }, { merge: true });
    const later = await firestore(u, 'PATCH', `users/${u.uid}`, { lastSeenAt: when }, '?updateMask.fieldPaths=lastSeenAt');
    assert.strictEqual(later.status, 200, 'later sign-in');
    assert.strictEqual((await firestore(u, 'GET', `users/${u.uid}`)).status, 200, 'owner reads own plan');
    assert.strictEqual((await firestore(await signUp('other'), 'GET', `users/${u.uid}`)).status, 403, 'others cannot');
  });
  await test('4 Protection', 'signed-out callers are refused by every function', async () => {
    for (const name of ['createActivity', 'shareActivity', 'revokeSharedLink', 'deleteActivityAndLinks', 'recordAssessmentCompletion']) {
      assert.strictEqual((await callable(name, null, {})).status, 'UNAUTHENTICATED', name);
    }
  });

  // ── Saving, sharing and student links ──
  const student = async (shareId) => (await firestore(null, 'GET', `sharedActivities/${shareId}`)).status;
  const stripePaid = await signUp('saved-stripe');
  await setSub(stripePaid.uid, 's1', 'active');
  const manualPaid = members[0][0];
  const underLimit = await signUp('saved-free');
  await db.doc(`users/${underLimit.uid}`).set({ plan: 'free', activitiesCreated: 1 });
  const atLimit = await account('saved-limit', { plan: 'free' });
  for (const [label, u, editable] of [['Stripe Plus', stripePaid, true], ['manual Family', manualPaid, true], ['Free under limit', underLimit, true], ['Free at limit', atLimit, false]]) {
    await test('5 Saving and sharing', `${label}: save, share, students open, renew, replace, revoke, delete`, async () => {
      let id = 'probe';
      let first;
      if (editable) {
        const made = await callable('createActivity', u, { requestId: nextId('save').padEnd(20, '0'), share: true, activity });
        assert.strictEqual(made.status, 'OK', made.status);
        id = made.result.id; first = made.result.shareId;
      } else {
        const shared = await callable('shareActivity', u, { activityId: id });
        assert.strictEqual(shared.status, 'OK', shared.status);
        first = shared.result.shareId;
      }
      assert.strictEqual(await student(first), 200, 'student link');
      const edit = await firestore(u, 'PATCH', `users/${u.uid}/activities/${id}`, { title: str('edited') }, '?updateMask.fieldPaths=title');
      assert.strictEqual(edit.status, editable ? 200 : 403, 'edit');
      const renewed = await callable('shareActivity', u, { activityId: id, action: 'renew', days: 30 });
      assert.deepStrictEqual([renewed.status, renewed.result.shareId], ['OK', first]);
      const replaced = await callable('shareActivity', u, { activityId: id, action: 'new' });
      assert.strictEqual(replaced.status, 'OK');
      assert.strictEqual(replaced.result.shareId !== first, editable, 'only an editable account may replace a link');
      if (editable) assert.notStrictEqual(await student(first), 200, 'replaced link stops');
      const live = replaced.result.shareId;
      assert.strictEqual((await callable('revokeSharedLink', u, { activityId: id })).status, 'OK');
      assert.notStrictEqual(await student(live), 200, 'revoked link');
      const again = await callable('shareActivity', u, { activityId: id });
      assert.strictEqual(again.status, 'OK');
      assert.strictEqual((await firestore(u, 'DELETE', `users/${u.uid}/activities/${id}`)).status, 403, 'browser delete stays blocked');
      assert.strictEqual((await callable('deleteActivityAndLinks', u, { activityId: id })).status, 'OK');
      assert.notStrictEqual(await student(again.result.shareId), 200, 'link after delete');
      assert.strictEqual((await db.doc(`users/${u.uid}/activities/${id}`).get()).exists, false);
    });
  }
  await test('5 Saving and sharing', 'Free account gets exactly five creations', async () => {
    const u = await signUp('five');
    await db.doc(`users/${u.uid}`).set({ plan: 'free', activitiesCreated: 0 });
    const outcomes = [];
    for (let i = 0; i < 6; i += 1) outcomes.push((await callable('createActivity', u, { requestId: nextId('count').padEnd(20, '0'), activity })).status);
    assert.deepStrictEqual(outcomes, ['OK', 'OK', 'OK', 'OK', 'OK', 'RESOURCE_EXHAUSTED']);
  });
  await test('5 Saving and sharing', 'an expired student link stops; a legacy link without a date still opens', async () => {
    const base = { public: true, ownerUid: 'x', title: 't' };
    await db.doc('sharedActivities/expired-link').set({ ...base, expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
    await db.doc('sharedActivities/legacy-link').set(base);
    assert.deepStrictEqual([await student('expired-link'), await student('legacy-link')], [403, 200]);
    assert.strictEqual((await firestore(null, 'GET', 'sharedActivities')).status, 403, 'links cannot be listed');
  });
  await test('5 Saving and sharing', 'delete triggers still clean up links and seed the counter', async () => {
    const u = await signUp('triggers');
    await db.doc('sharedActivities/orphan-link').set({ public: true, ownerUid: u.uid, activityId: 'old' });
    await db.doc(`users/${u.uid}/activities/old`).set({ ...activity, shareId: 'orphan-link', shareIds: ['orphan-link'] });
    await db.doc(`users/${u.uid}/activities/old`).delete();
    await waitFor('link cleanup', async () => !(await db.doc('sharedActivities/orphan-link').get()).exists);
    await waitFor('counter seed', async () => (await userData(u.uid))?.activitiesCreated === 1);
  });

  let group = '';
  for (const [g, name, outcome] of results) { if (g !== group) { group = g; console.log(`\n${g}`); } console.log(`  ${outcome}  ${name}`); }
  const failed = results.filter((r) => r[2] !== 'PASS').length;
  console.log(`\nE2E: ${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
