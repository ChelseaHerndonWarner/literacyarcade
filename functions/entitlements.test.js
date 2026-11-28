// Regression tests for Stripe-only, manual-only and combined plan access.
// Run with: node functions/entitlements.test.js   (in-memory fake Firestore, no network)
const assert = require('assert');
const { effectivePlan, readGrant } = require('./entitlements');
const { createPlanSync } = require('./plan-sync');

const DELETE = Symbol('delete');
let clock = 1_000_000;
const stamp = (ms) => ({ toMillis: () => ms });
const store = new Map();
const snapshot = (path) => ({ id: path.split('/').pop(), exists: store.has(path), data: () => store.get(path) });
const children = (path) => [...store.keys()].filter((k) => k.startsWith(path + '/') && !k.slice(path.length + 1).includes('/'));

const collection = (path) => ({
  doc: (id) => ({ path: `${path}/${id}`, collection: (name) => collection(`${path}/${id}/${name}`) }),
  async get() {
    const docs = children(path).map(snapshot);
    return { empty: docs.length === 0, docs, forEach: (fn) => docs.forEach(fn) };
  },
  where: (field, op, value) => ({
    limit: (n) => ({
      get: async () => {
        assert.strictEqual(op, '<=');
        const docs = children(path).filter((k) => store.get(k)[field]?.toMillis?.() <= value.getTime()).slice(0, n).map(snapshot);
        return { docs };
      },
    }),
  }),
});
const db = {
  collection,
  async runTransaction(fn) {
    const writes = [];
    const result = await fn({
      get: async (ref) => (ref.get ? ref.get() : snapshot(ref.path)),
      create: (ref) => assert.fail('the sync must never create a record: ' + ref.path),
      set: (ref, data, options) => writes.push(() => {
        assert(ref.path.startsWith('users/'), 'the sync may only write user documents: ' + ref.path);
        assert(options?.merge, 'user documents must be merged, not replaced');
        const next = { ...(store.get(ref.path) || {}) };
        Object.entries(data).forEach(([k, v]) => { if (v === DELETE) delete next[k]; else next[k] = v; });
        store.set(ref.path, next);
      }),
    });
    writes.forEach((write) => write());
    return result;
  },
};
const FieldValue = { delete: () => DELETE, serverTimestamp: () => stamp(clock) };
const logger = { info() {}, warn() {}, error() {} };
const sync = createPlanSync({ db, FieldValue, logger, now: () => clock });

const PRICE = {
  plus: 'price_1TqmEJ3PzX3bHrbQ2cWDevb5',
  founding: 'price_1TqmEK3PzX3bHrbQEkK6vaes',
  family: 'price_1TssAC3PzX3bHrbQg4qIhxOH',
};
const user = (uid) => store.get(`users/${uid}`) || {};
const grantDoc = (uid) => store.get(`planGrants/${uid}`);
const run = (uid) => sync.recomputeUserPlan(uid);
const grantIds = () => [...store.keys()].filter((k) => k.startsWith('planGrants/')).sort();
const subscribe = async (uid, status, price = PRICE.plus, id = 's1', extra = {}) => {
  store.set(`customers/${uid}/subscriptions/${id}`, { status, items: [{ price: { id: price } }], ...extra });
  await run(uid);
};
const unsubscribe = async (uid, id = 's1') => { store.delete(`customers/${uid}/subscriptions/${id}`); await run(uid); };
const grant = async (uid, plan, expiresAt) => {
  store.set(`planGrants/${uid}`, expiresAt === undefined ? { plan } : { plan, expiresAt });
  await run(uid);
};
const revoke = async (uid) => { store.delete(`planGrants/${uid}`); await run(uid); };
const expect = (uid, plan, source) => {
  assert.strictEqual(user(uid).plan, plan, `${uid}: plan is ${user(uid).plan}, expected ${plan}`);
  if (source) assert.strictEqual(user(uid).planSource, source, `${uid}: source`);
  assert.strictEqual(effectivePlan(user(uid), clock), plan, `${uid}: effective plan`);
};
const INACTIVE = ['canceled', 'past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'paused'];

let passed = 0;
const test = async (name, fn) => { store.clear(); clock = 1_000_000; await fn(); passed += 1; console.log('  ok  ' + name); };

(async () => {
  console.log('Stripe only');
  await test('active, trialing and scheduled cancellation give access', async () => {
    await subscribe('a', 'active'); expect('a', 'plus', 'stripe');
    await subscribe('a', 'trialing'); expect('a', 'plus', 'stripe');
    await subscribe('a', 'active', PRICE.plus, 's1', { cancel_at_period_end: true }); expect('a', 'plus', 'stripe');
    await subscribe('b', 'active', PRICE.founding); expect('b', 'plus');
    assert.strictEqual(grantDoc('a'), undefined);
  });
  for (const status of INACTIVE) {
    await test(`${status} ends access and creates no manual grant`, async () => {
      await subscribe('a', 'active'); await subscribe('a', status); expect('a', 'free', 'stripe');
      assert.strictEqual(user('a').stripeSubscriptionId, undefined);
      await subscribe('a', status); expect('a', 'free');
      assert.strictEqual(grantDoc('a'), undefined);
    });
  }
  await test('upgrade, downgrade and deletion', async () => {
    await subscribe('a', 'active'); await subscribe('a', 'active', PRICE.family, 's2'); expect('a', 'family', 'stripe');
    assert.strictEqual(user('a').stripeSubscriptionId, 's2');
    await subscribe('a', 'canceled', PRICE.family, 's2'); expect('a', 'plus');
    await unsubscribe('a', 's1'); expect('a', 'free', 'stripe');
    await unsubscribe('a', 's2'); expect('a', 'free', 'none');
  });
  await test('a new account with an incomplete checkout stays Free', async () => {
    await subscribe('new', 'incomplete'); expect('new', 'free', 'stripe');
  });

  console.log('Manual only');
  await test('grants without an end date, upgrade, downgrade and removal', async () => {
    await grant('m', 'plus'); expect('m', 'plus', 'manual'); assert.strictEqual(user('m').planExpiresAt, undefined);
    await grant('m', 'family'); expect('m', 'family', 'manual');
    await grant('m', 'plus'); expect('m', 'plus', 'manual');
    await revoke('m'); expect('m', 'free', 'none'); assert.strictEqual(grantDoc('m'), undefined);
  });
  await test('a dated grant stops at its expiry, before and after the sweep', async () => {
    await grant('m', 'family', stamp(clock + 100)); expect('m', 'family', 'manual');
    assert.strictEqual(user('m').planAfterExpiry, 'free');
    clock += 99; assert.strictEqual(effectivePlan(user('m'), clock), 'family');
    assert.deepStrictEqual(await sync.sweepExpiredGrants(), { due: 0, updated: 0, failed: 0 });
    clock += 1; assert.strictEqual(effectivePlan(user('m'), clock), 'free');
    assert.strictEqual(user('m').plan, 'family', 'stored value waits for the sweep');
    assert.deepStrictEqual(await sync.sweepExpiredGrants(), { due: 1, updated: 1, failed: 0 });
    expect('m', 'free', 'none'); assert.strictEqual(user('m').planExpiresAt, undefined);
    assert.deepStrictEqual(await sync.sweepExpiredGrants(), { due: 0, updated: 0, failed: 0 });
    await run('m'); expect('m', 'free');
  });
  await test('extending a grant, or removing its end date', async () => {
    await grant('m', 'plus', stamp(clock + 10)); await grant('m', 'plus', stamp(clock + 1000));
    clock += 500; expect('m', 'plus', 'manual');
    await grant('m', 'plus', null); clock += 10_000; expect('m', 'plus'); assert.strictEqual(user('m').planExpiresAt, undefined);
  });
  await test('an already expired grant gives nothing', async () => {
    await grant('m', 'family', stamp(clock - 1)); expect('m', 'free');
  });
  await test('invalid grants give nothing (typed date, unknown plan)', async () => {
    for (const bad of [{ plan: 'Plus' }, { plan: 'free' }, { plan: 'constructor' }, {}, { plan: 'plus', expiresAt: '2030-01-01' }, { plan: 'plus', expiresAt: 4102444800000 }]) {
      store.set('planGrants/m', bad); await run('m'); expect('m', 'free');
      assert.strictEqual(readGrant(bad, clock).state, 'invalid');
    }
  });
  await test('the sweep handles more than one batch and continues past a failure', async () => {
    for (const id of ['a', 'b', 'c']) await grant(id, 'plus', stamp(clock + 1));
    clock += 5;
    assert.strictEqual((await sync.sweepExpiredGrants({ batchSize: 2 })).updated, 2);
    assert.strictEqual((await sync.sweepExpiredGrants({ batchSize: 2 })).updated, 1);
    ['a', 'b', 'c'].forEach((id) => expect(id, 'free'));
  });

  console.log('Moving typed-in manual plans to grants (created by an administrator)');
  // Accounts with a typed plan, no source label and no Stripe records.
  const members = [['m1', 'family'], ['m2', 'family'], ['m3', 'plus'], ['m4', 'plus']];
  const seedMembers = () => members.forEach(([id, plan]) => store.set(`users/${id}`, { plan, activitiesCreated: 4, displayName: id }));
  await test('before any change, the typed plans already work with the new checks', async () => {
    seedMembers();
    members.forEach(([id, plan]) => assert.strictEqual(effectivePlan(user(id), clock), plan));
    assert.deepStrictEqual(await sync.sweepExpiredGrants(), { due: 0, updated: 0, failed: 0 });
    members.forEach(([id, plan]) => expect(id, plan));
  });
  await test('creating undated grants and syncing keeps every level and other data', async () => {
    seedMembers();
    for (const [id, plan] of members) {
      await grant(id, plan); expect(id, plan, 'manual');
      assert.strictEqual(user(id).planExpiresAt, undefined);
      assert.strictEqual(user(id).activitiesCreated, 4); assert.strictEqual(user(id).displayName, id);
    }
    clock += 10 * 365 * 864e5; await sync.sweepExpiredGrants(); members.forEach(([id, plan]) => expect(id, plan));
    assert.strictEqual(grantIds().length, members.length);
  });
  await test('after the move, no Stripe event can change their levels', async () => {
    seedMembers();
    for (const [id, plan] of members) {
      await grant(id, plan);
      for (const status of [...INACTIVE, 'active', 'trialing', 'canceled']) { await subscribe(id, status); expect(id, plan); }
      await subscribe(id, 'active', PRICE.family, 's2'); expect(id, 'family');
      await subscribe(id, 'canceled', PRICE.family, 's2'); expect(id, plan);
      await unsubscribe(id, 's1'); await unsubscribe(id, 's2'); expect(id, plan, 'manual');
    }
    assert.strictEqual(grantIds().length, members.length);
  });
  await test('an end date can be added later to one account without touching the others', async () => {
    seedMembers();
    for (const [id, plan] of members) await grant(id, plan);
    await grant('m1', 'family', stamp(clock + 100)); expect('m1', 'family', 'manual');
    clock += 101; assert.strictEqual((await sync.sweepExpiredGrants()).updated, 1);
    expect('m1', 'free'); members.slice(1).forEach(([id, plan]) => expect(id, plan));
  });
  await test('a typed plan WITHOUT a grant is replaced by a Stripe event, and no grant appears', async () => {
    store.set('users/missed', { plan: 'family' });
    await subscribe('missed', 'canceled'); expect('missed', 'free', 'stripe');
    assert.deepStrictEqual(grantIds(), []);
  });

  console.log('Stripe-only customers never become permanent members');
  for (const [label, record] of [
    ['normal synced account', { plan: 'plus', planSource: 'stripe' }],
    ['source label missing, Stripe fields present', { plan: 'plus', stripeSubscriptionId: 's1', stripeStatus: 'active' }],
    ['plan only, nothing else', { plan: 'family' }],
  ]) {
    for (const status of INACTIVE) {
      await test(`${label}: ${status} ends access with no grant`, async () => {
        store.set('users/s', { ...record });
        await subscribe('s', status); expect('s', 'free', 'stripe');
        assert.deepStrictEqual(grantIds(), []);
      });
    }
  }
  await test('a full Stripe lifecycle leaves no grant behind', async () => {
    for (const status of ['trialing', 'active', ...INACTIVE, 'active']) await subscribe('life', status);
    await unsubscribe('life'); expect('life', 'free', 'none'); assert.deepStrictEqual(grantIds(), []);
  });

  console.log('Stripe and manual together');
  await test('the higher plan wins and neither source lowers the other', async () => {
    await grant('c', 'family'); await subscribe('c', 'active'); expect('c', 'family', 'manual');
    assert.strictEqual(user('c').stripeSubscriptionId, 's1');
    for (const status of INACTIVE) { await subscribe('c', status); expect('c', 'family', 'manual'); }
    await revoke('c'); expect('c', 'free', 'stripe');
    await grant('d', 'plus'); await subscribe('d', 'active', PRICE.family); expect('d', 'family', 'stripe');
    await revoke('d'); expect('d', 'family', 'stripe');
  });
  await test('dated Family grant over Stripe Plus falls back to Plus', async () => {
    await subscribe('c', 'active'); await grant('c', 'family', stamp(clock + 100)); expect('c', 'family', 'manual');
    assert.strictEqual(user('c').planAfterExpiry, 'plus');
    clock += 101; assert.strictEqual(effectivePlan(user('c'), clock), 'plus');
    await sync.sweepExpiredGrants(); expect('c', 'plus', 'stripe');
    await subscribe('c', 'canceled'); expect('c', 'free');
  });
  await test('Stripe cancels while a dated grant is still running', async () => {
    await subscribe('c', 'active'); await grant('c', 'family', stamp(clock + 100));
    await subscribe('c', 'canceled'); expect('c', 'family'); assert.strictEqual(user('c').planAfterExpiry, 'free');
    clock += 101; assert.strictEqual(effectivePlan(user('c'), clock), 'free');
  });
  await test('equal plans: Stripe covers it, and the dated grant takes over if Stripe ends', async () => {
    await subscribe('c', 'active'); await grant('c', 'plus', stamp(clock + 100)); expect('c', 'plus', 'stripe');
    assert.strictEqual(user('c').planExpiresAt, undefined);
    await subscribe('c', 'canceled'); expect('c', 'plus', 'manual'); assert(user('c').planExpiresAt);
    clock += 101; await sync.sweepExpiredGrants(); expect('c', 'free', 'stripe');
  });
  await test('buying Stripe after a grant expired works normally', async () => {
    await grant('c', 'plus', stamp(clock - 1)); await subscribe('c', 'active'); expect('c', 'plus', 'stripe');
    await subscribe('c', 'canceled'); expect('c', 'free');
  });

  console.log('Enforcement helper');
  await test('effectivePlan can only lower the stored plan', async () => {
    const past = stamp(clock - 1);
    assert.strictEqual(effectivePlan(undefined, clock), 'free');
    assert.strictEqual(effectivePlan({ plan: 'free', planExpiresAt: past, planAfterExpiry: 'family' }, clock), 'free');
    assert.strictEqual(effectivePlan({ plan: 'plus', planExpiresAt: past, planAfterExpiry: 'family' }, clock), 'plus');
    assert.strictEqual(effectivePlan({ plan: 'plus', planExpiresAt: 'soon' }, clock), 'free');
    assert.strictEqual(effectivePlan({ plan: 'plus', planExpiresAt: null }, clock), 'plus');
  });

  console.log(`entitlements: ${passed} tests passed`);
})().catch((error) => { console.error(error); process.exit(1); });
