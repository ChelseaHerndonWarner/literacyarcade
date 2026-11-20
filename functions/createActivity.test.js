// Exercises the createActivity callable against an in-memory fake Firestore (no network).
// Run with: node functions/createActivity.test.js
// This checks the function's logic and its use of one transaction; it does not replace a test
// against the real Firestore emulator/project for concurrency and security rules.
const assert = require('assert');
const Module = require('module');

// ---- minimal in-memory Firestore ----
const store = new Map(); // path -> data
const SERVER_TS = { __serverTimestamp: true };
class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new ColRef(`${this.path}/${name}`); }
}
class ColRef {
  constructor(path) { this.path = path; }
  doc(id) { return new DocRef(`${this.path}/${id || 'auto' + Math.random().toString(36).slice(2, 10)}`); }
  count() {
    const prefix = this.path + '/';
    return { get: async () => ({ data: () => ({ count: [...store.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).length }) }) };
  }
}
const snap = (path) => ({ exists: store.has(path), data: () => store.get(path) });
const fakeDb = {
  collection: (name) => new ColRef(name),
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => snap(ref.path),
      set: (ref, data, opts) => writes.push(() => store.set(ref.path, opts && opts.merge ? { ...(store.get(ref.path) || {}), ...data } : data)),
      create: (ref, data) => writes.push(() => { assert(!store.has(ref.path), 'create on existing doc ' + ref.path); store.set(ref.path, data); }),
      update: (ref, data) => writes.push(() => { assert(store.has(ref.path), 'update on missing doc ' + ref.path); store.set(ref.path, { ...store.get(ref.path), ...data }); }),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  },
};

// ---- stub the Firebase modules index.js requires ----
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const handlers = {};
const stubs = {
  'firebase-admin': {
    initializeApp() {},
    firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => SERVER_TS, delete: () => null } }),
  },
  'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
  'firebase-functions/v2/https': { onCall: (fn) => fn, HttpsError },
  'firebase-functions/v2/firestore': { onDocumentWritten: (_p, fn) => fn, onDocumentDeleted: (_p, fn) => fn },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) { return stubs[request] || origLoad.call(this, request, ...rest); };
const fns = require('./index.js');
Module._load = origLoad;

let n = 0;
const rid = () => 'req' + String(++n).padStart(20, '0');
const call = (uid, data) => fns.createActivity({ auth: uid ? { uid } : null, data });
const act = (extra = {}) => ({ title: 'T', toolType: 'read-and-race', activityType: 'read-and-race', words: ['a'], settings: {}, url: 'read-and-race.html', ...extra });
const user = (uid) => store.get(`users/${uid}`) || {};
const activities = (uid) => [...store.keys()].filter((k) => k.startsWith(`users/${uid}/activities/`)).length;
const rejects = async (p, code) => { try { await p; } catch (e) { assert.strictEqual(e.code, code); return e; } assert.fail('expected ' + code); };

(async () => {
  // Signed-out and bad input are refused.
  await rejects(call(null, { requestId: rid(), activity: act() }), 'unauthenticated');
  await rejects(call('u0', { requestId: 'short', activity: act() }), 'invalid-argument');
  await rejects(call('u0', { requestId: rid(), activity: { title: 'x' } }), 'invalid-argument');

  // Free user: five creations succeed, the sixth is refused, counter stops at 5.
  for (let i = 1; i <= 5; i += 1) {
    const r = await call('free', { requestId: rid(), activity: act({ title: 'A' + i }) });
    assert(r.id && !r.shareId);
    assert.strictEqual(user('free').activitiesCreated, i);
  }
  const err = await rejects(call('free', { requestId: rid(), activity: act() }), 'resource-exhausted');
  assert.strictEqual(err.details.count, 5);
  assert.strictEqual(activities('free'), 5);

  // Deleting an activity does NOT restore a credit.
  const firstId = [...store.keys()].find((k) => k.startsWith('users/free/activities/'));
  store.delete(firstId);
  assert.strictEqual(activities('free'), 4);
  await rejects(call('free', { requestId: rid(), activity: act() }), 'resource-exhausted');
  assert.strictEqual(user('free').activitiesCreated, 5);

  // Server controls timestamps/owner; client-supplied userId is overwritten.
  const created = store.get([...store.keys()].find((k) => k.startsWith('users/free/activities/')));
  assert.strictEqual(created.userId, 'free');

  // Same request id retried: returned, not created or counted twice.
  const rId = rid();
  const a = await call('retry', { requestId: rId, activity: act() });
  const b = await call('retry', { requestId: rId, activity: act() });
  assert.strictEqual(a.id, b.id);
  assert.strictEqual(b.alreadyCreated, true);
  assert.strictEqual(user('retry').activitiesCreated, 1);
  assert.strictEqual(activities('retry'), 1);

  // Share before Save: one new activity + one public share doc + one credit, linked by shareId.
  const s = await call('sharer', { requestId: rid(), share: true, activity: act({ shareEnabled: true, sharedSetup: true, shareId: 'forged', createdAt: 'x' }) });
  assert(s.shareId && s.shareId !== 'forged');
  const priv = store.get(`users/sharer/activities/${s.id}`);
  const pub = store.get(`sharedActivities/${s.shareId}`);
  assert.strictEqual(priv.shareId, s.shareId);
  assert.strictEqual(priv.shareEnabled, true);
  assert.strictEqual(pub.public, true);
  assert.strictEqual(pub.ownerUid, 'sharer');
  assert(!('url' in pub) && !('shareId' in pub) && !('userId' in pub), 'private fields must not leak to the public doc');
  assert.strictEqual(user('sharer').activitiesCreated, 1);

  // Blocked share creates no share doc.
  store.set('users/full', { activitiesCreated: 5 });
  const before = [...store.keys()].filter((k) => k.startsWith('sharedActivities/')).length;
  await rejects(call('full', { requestId: rid(), share: true, activity: act({ shareEnabled: true }) }), 'resource-exhausted');
  assert.strictEqual([...store.keys()].filter((k) => k.startsWith('sharedActivities/')).length, before);

  // Plus / Family: unlimited, never consume Free credits; counter initialised to 0.
  store.set('users/plus', { plan: 'plus' });
  for (let i = 0; i < 8; i += 1) await call('plus', { requestId: rid(), activity: act() });
  assert.strictEqual(activities('plus'), 8);
  assert.strictEqual(user('plus').activitiesCreated, 0);
  store.set('users/fam', { plan: 'family', activitiesCreated: 2 });
  await call('fam', { requestId: rid(), activity: act() });
  assert.strictEqual(user('fam').activitiesCreated, 2);

  // A lapsed Plus user (now Free) keeps credits for Free-era use only.
  store.set('users/lapsed', { plan: 'free', activitiesCreated: 0 });
  for (let i = 0; i < 5; i += 1) await call('lapsed', { requestId: rid(), activity: act() });
  await rejects(call('lapsed', { requestId: rid(), activity: act() }), 'resource-exhausted');

  // Account with no counter is seeded from its live activities (never below what it already has).
  for (let i = 0; i < 6; i += 1) store.set(`users/legacy/activities/old${i}`, { title: 'old' });
  await rejects(call('legacy', { requestId: rid(), activity: act() }), 'resource-exhausted');
  assert.strictEqual(user('legacy').activitiesCreated, 6);

  // ---- shareActivity: existing activities can be shared with no credit, even when read-only ----
  const shareCall = (uid, data) => fns.shareActivity({ auth: uid ? { uid } : null, data });
  store.set('users/ro', { plan: 'free', activitiesCreated: 5 });
  store.set('users/ro/activities/saved1', { title: 'Saved', toolType: 'magic-word-road', activityType: 'magic-word-road', words: ['one', 'two'], settings: { rounds: 3 }, url: 'magic-word-road.html', userId: 'ro' });
  await rejects(shareCall(null, { activityId: 'saved1' }), 'unauthenticated');
  await rejects(shareCall('ro', { activityId: 'nope' }), 'not-found');
  await rejects(shareCall('other', { activityId: 'saved1' }), 'not-found'); // someone else's activity id
  const sh = await shareCall('ro', { activityId: 'saved1' });
  assert(sh.shareId && !sh.alreadyShared);
  const sharedDoc = store.get(`sharedActivities/${sh.shareId}`);
  assert.deepStrictEqual(sharedDoc.words, ['one', 'two']);      // content comes from the saved activity
  assert.strictEqual(sharedDoc.settings.rounds, 3);
  assert.strictEqual(sharedDoc.public, true);
  assert.strictEqual(sharedDoc.ownerUid, 'ro');
  assert(!('url' in sharedDoc) && !('userId' in sharedDoc) && !('shareId' in sharedDoc));
  assert.strictEqual(store.get('users/ro/activities/saved1').shareId, sh.shareId);
  assert.strictEqual(user('ro').activitiesCreated, 5);           // no credit used
  // Sharing again returns the same link; a read-only account cannot force a new one.
  const again = await shareCall('ro', { activityId: 'saved1', forceNew: true });
  assert.strictEqual(again.shareId, sh.shareId);
  assert.strictEqual(again.alreadyShared, true);
  // An account that can still edit may publish a fresh link of its edited content.
  store.set('users/ed', { plan: 'free', activitiesCreated: 2 });
  store.set('users/ed/activities/s1', { title: 'E', toolType: 'robot-word-builder', words: ['a'], settings: {} });
  const first = await shareCall('ed', { activityId: 's1' });
  assert.strictEqual((await shareCall('ed', { activityId: 's1' })).shareId, first.shareId);
  const fresh = await shareCall('ed', { activityId: 's1', forceNew: true });
  assert.notStrictEqual(fresh.shareId, first.shareId);
  // Letterbox lessons are not shareable.
  store.set('users/ed/activities/lb', { title: 'L', toolType: 'letterbox-lesson', words: ['a'] });
  await rejects(shareCall('ed', { activityId: 'lb' }), 'failed-precondition');

  console.log('createActivity: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
