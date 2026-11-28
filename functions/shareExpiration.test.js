// Exercises shared-link expiration, renewal, replacement, revocation, and the activity-delete
// cascade against an in-memory fake Firestore (no network/emulator). Mirrors the harness in
// createActivity.test.js, extended with direct (non-transaction) get() and a batch(), since the
// delete-cascade trigger reads/deletes outside a transaction.
// Run with: node functions/shareExpiration.test.js
const assert = require('assert');
const Module = require('module');

// ---- minimal in-memory Firestore ----
const store = new Map(); // path -> data
const SERVER_TS = { __serverTimestamp: true };
class FakeTimestamp {
  constructor(millis) { this._millis = millis; }
  toMillis() { return this._millis; }
  static fromMillis(millis) { return new FakeTimestamp(millis); }
}
class DocRef {
  constructor(path) { this.path = path; this.id = path.split('/').pop(); }
  collection(name) { return new ColRef(`${this.path}/${name}`); }
  async get() { return snap(this.path); }
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
  batch() {
    const ops = [];
    return {
      delete: (ref) => ops.push(() => store.delete(ref.path)),
      commit: async () => { ops.forEach((op) => op()); },
    };
  },
  async runTransaction(fn) {
    const writes = [];
    const tx = {
      get: async (ref) => snap(ref.path),
      getAll: async (...refs) => {
        // Test-only failure injection: a shareId of '__THROW__' simulates a mid-transaction
        // Firestore error (e.g. a transient read failure) to verify atomicity — nothing should be
        // written if the transaction's callback throws before any write is committed.
        if (refs.some((ref) => ref.path.endsWith('/__THROW__'))) throw new Error('simulated transient Firestore error');
        return refs.map((ref) => snap(ref.path));
      },
      set: (ref, data, opts) => writes.push(() => store.set(ref.path, opts && opts.merge ? { ...(store.get(ref.path) || {}), ...data } : data)),
      create: (ref, data) => writes.push(() => { assert(!store.has(ref.path), 'create on existing doc ' + ref.path); store.set(ref.path, data); }),
      update: (ref, data) => writes.push(() => {
        assert(store.has(ref.path), 'update on missing doc ' + ref.path);
        const next = { ...store.get(ref.path) };
        Object.entries(data).forEach(([k, v]) => { if (v && v.__fieldDelete) delete next[k]; else next[k] = v; });
        store.set(ref.path, next);
      }),
      delete: (ref) => writes.push(() => store.delete(ref.path)),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  },
};

// ---- stub the Firebase modules index.js requires ----
class HttpsError extends Error { constructor(code, message, details) { super(message); this.code = code; this.details = details; } }
const deletedTriggers = {};
const stubs = {
  'firebase-admin': {
    initializeApp() {},
    firestore: Object.assign(() => fakeDb, {
      FieldValue: { serverTimestamp: () => SERVER_TS, delete: () => ({ __fieldDelete: true }) },
      Timestamp: FakeTimestamp,
    }),
  },
  'firebase-functions': { logger: { info() {}, warn() {}, error() {} } },
  'firebase-functions/v2/https': { onCall: (fn) => fn, HttpsError },
  'firebase-functions/v2/firestore': {
    onDocumentWritten: (_p, fn) => fn,
    onDocumentDeleted: (path, fn) => { deletedTriggers[path] = fn; return fn; },
  },
};
// index.js imports FieldValue/Timestamp from the modular entry point and registers a schedule.
stubs['firebase-admin/firestore'] = {
  FieldValue: stubs['firebase-admin'].firestore.FieldValue,
  Timestamp: stubs['firebase-admin'].firestore.Timestamp,
};
stubs['firebase-functions/v2/scheduler'] = { onSchedule: (_schedule, fn) => fn };
const origLoad = Module._load;
Module._load = function (request, ...rest) { return stubs[request] || origLoad.call(this, request, ...rest); };
const fns = require('./index.js');
Module._load = origLoad;

let n = 0;
const rid = () => 'req' + String(++n).padStart(20, '0');
const createCall = (uid, data) => fns.createActivity({ auth: uid ? { uid } : null, data });
const shareCall = (uid, data) => fns.shareActivity({ auth: uid ? { uid } : null, data });
const revokeCall = (uid, data) => fns.revokeSharedLink({ auth: uid ? { uid } : null, data });
const deleteCall = (uid, data) => fns.deleteActivityAndLinks({ auth: uid ? { uid } : null, data });
const act = (extra = {}) => ({ title: 'T', toolType: 'read-and-race', activityType: 'read-and-race', words: ['a'], settings: {}, url: 'read-and-race.html', ...extra });
const rejects = async (p, code) => { try { await p; } catch (e) { assert.strictEqual(e.code, code); return e; } assert.fail('expected ' + code); };
const user = (uid) => store.get(`users/${uid}`) || {};
const DAY_MS = 24 * 60 * 60 * 1000;

(async () => {
  // ---- createActivity(share:true) writes expiresAt/activityId/shareIds ----
  const created = await createCall('t1', { requestId: rid(), share: true, activity: act() });
  const pub1 = store.get(`sharedActivities/${created.shareId}`);
  assert.strictEqual(pub1.activityId, created.id);
  assert(pub1.expiresAt instanceof FakeTimestamp);
  assert(Math.abs(pub1.expiresAt.toMillis() - (Date.now() + 14 * DAY_MS)) < 5000, 'defaults to 14 days');
  assert.strictEqual(created.expiresAtMillis, pub1.expiresAt.toMillis());
  const priv1 = store.get(`users/t1/activities/${created.id}`);
  assert.deepStrictEqual(priv1.shareIds, [created.shareId]);

  // Custom shareDays (7/30) honored; an invalid value falls back to the default.
  const c7 = await createCall('t1', { requestId: rid(), share: true, shareDays: 7, activity: act() });
  assert(Math.abs(store.get(`sharedActivities/${c7.shareId}`).expiresAt.toMillis() - (Date.now() + 7 * DAY_MS)) < 5000);
  const cBad = await createCall('t1', { requestId: rid(), share: true, shareDays: 999, activity: act() });
  assert(Math.abs(store.get(`sharedActivities/${cBad.shareId}`).expiresAt.toMillis() - (Date.now() + 14 * DAY_MS)) < 5000);

  // ---- shareActivity default action: reuse-or-mint, with expiresAt ----
  store.set('users/s1', { plan: 'free', activitiesCreated: 2 });
  store.set('users/s1/activities/a1', act({ userId: 's1' }));
  const s1 = await shareCall('s1', { activityId: 'a1' });
  assert(s1.shareId && !s1.alreadyShared);
  assert(s1.expiresAtMillis > Date.now());
  const again = await shareCall('s1', { activityId: 'a1' });
  assert.strictEqual(again.shareId, s1.shareId);
  assert.strictEqual(again.alreadyShared, true);
  assert.strictEqual(again.expiresAtMillis, s1.expiresAtMillis);

  // ---- renew: same shareId, pushed-out expiry; fails with no active link ----
  const beforeRenewExpiry = store.get(`sharedActivities/${s1.shareId}`).expiresAt.toMillis();
  const renewed = await shareCall('s1', { activityId: 'a1', action: 'renew', days: 30 });
  assert.strictEqual(renewed.shareId, s1.shareId, 'renew keeps the same URL');
  assert.strictEqual(renewed.renewed, true);
  assert(renewed.expiresAtMillis > beforeRenewExpiry, 'renew pushes expiry forward');
  store.set('users/noLink', { plan: 'free', activitiesCreated: 0 });
  store.set('users/noLink/activities/a1', act({ userId: 'noLink' }));
  await rejects(shareCall('noLink', { activityId: 'a1', action: 'renew' }), 'failed-precondition');

  // ---- generate new link: fresh shareId, old one deleted (invalidated), shareIds history grows ----
  const beforeNewShareId = s1.shareId;
  const fresh = await shareCall('s1', { activityId: 'a1', action: 'new' });
  assert.notStrictEqual(fresh.shareId, beforeNewShareId);
  assert.strictEqual(fresh.replaced, true);
  assert(!store.has(`sharedActivities/${beforeNewShareId}`), 'old link must be deleted, not just unreferenced');
  assert(store.has(`sharedActivities/${fresh.shareId}`));
  const privAfterNew = store.get('users/s1/activities/a1');
  assert.deepStrictEqual(new Set(privAfterNew.shareIds), new Set([beforeNewShareId, fresh.shareId]));
  // forceNew is kept as a backward-compatible alias for action:'new'.
  const beforeAliasShareId = fresh.shareId;
  const viaAlias = await shareCall('s1', { activityId: 'a1', forceNew: true });
  assert.notStrictEqual(viaAlias.shareId, beforeAliasShareId);
  assert(!store.has(`sharedActivities/${beforeAliasShareId}`));

  // A read-only (limit-reached) account's 'new' request behaves like 'share': keeps its link.
  store.set('users/ro2', { plan: 'free', activitiesCreated: 5 });
  store.set('users/ro2/activities/a1', act({ userId: 'ro2' }));
  const roFirst = await shareCall('ro2', { activityId: 'a1' });
  const roSecond = await shareCall('ro2', { activityId: 'a1', action: 'new' });
  assert.strictEqual(roSecond.shareId, roFirst.shareId);
  assert.strictEqual(roSecond.alreadyShared, true);

  // ---- revokeSharedLink: deletes the public doc and clears the private shareId; idempotent ----
  store.set('users/rv', { plan: 'free', activitiesCreated: 0 });
  store.set('users/rv/activities/a1', act({ userId: 'rv' }));
  const toRevoke = await shareCall('rv', { activityId: 'a1' });
  const rev = await revokeCall('rv', { activityId: 'a1' });
  assert.strictEqual(rev.revoked, true);
  assert(!store.has(`sharedActivities/${toRevoke.shareId}`));
  assert.strictEqual(store.get('users/rv/activities/a1').shareEnabled, false);
  assert(!('shareId' in store.get('users/rv/activities/a1')));
  // Revoked links must not reactivate via ordinary Renew.
  await rejects(shareCall('rv', { activityId: 'a1', action: 'renew' }), 'failed-precondition');
  // Revoking again is a no-op, not an error.
  const rev2 = await revokeCall('rv', { activityId: 'a1' });
  assert.strictEqual(rev2.hadNoActiveLink, true);

  // Someone else's activity can't be revoked by a different uid.
  await rejects(revokeCall('someoneElse', { activityId: 'a1' }), 'not-found');

  // ---- Anonymous access to a live, non-expired link still works (no signed-out gate) ----
  store.set('users/anon', { plan: 'free', activitiesCreated: 0 });
  store.set('users/anon/activities/a1', act({ userId: 'anon' }));
  const anonLink = await shareCall('anon', { activityId: 'a1' });
  assert(store.get(`sharedActivities/${anonLink.shareId}`).public === true, 'public flag lets anonymous rule-based reads succeed');

  // ---- Legacy link (no expiresAt field at all): treated as never-expiring (not this module's
  // concern at the function layer — this documents the data shape firestore.rules relies on). ----
  store.set('sharedActivities/legacyNoExpiry', { public: true, ownerUid: 'legacy', toolType: 'read-and-race', words: ['a'] });
  assert(!('expiresAt' in store.get('sharedActivities/legacyNoExpiry')));

  // ---- Delete-cascade trigger: removes every shareId in history, plus a legacy singular shareId,
  // but only docs this owner actually owns; ignores ids it doesn't recognize. ----
  store.set('users/del', { plan: 'free', activitiesCreated: 1 });
  store.set('users/del/activities/a1', act({ userId: 'del' }));
  const first = await shareCall('del', { activityId: 'a1' });
  const second = await shareCall('del', { activityId: 'a1', action: 'new' });
  const deletedDoc = store.get('users/del/activities/a1'); // shareIds: [first, second]; shareId: second
  assert(store.has(`sharedActivities/${second.shareId}`));
  store.delete('users/del/activities/a1'); // simulates the client's deleteDoc()
  await deletedTriggers['users/{uid}/activities/{activityId}']({
    params: { uid: 'del', activityId: 'a1' },
    data: { data: () => deletedDoc },
  });
  assert(!store.has(`sharedActivities/${second.shareId}`), 'current link removed on activity delete');
  assert(!store.has(`sharedActivities/${first.shareId}`), 'superseded link in shareIds history also removed');

  // Legacy doc with only a singular shareId (no shareIds array) is still fully cleaned up.
  store.set('users/legacy2', { plan: 'free', activitiesCreated: 1 });
  store.set('users/legacy2/activities/a1', act({ userId: 'legacy2' }));
  const legacyShare = await shareCall('legacy2', { activityId: 'a1' });
  const legacyDoc = { ...store.get('users/legacy2/activities/a1') };
  delete legacyDoc.shareIds; // simulate a pre-this-feature activity doc
  store.delete('users/legacy2/activities/a1');
  await deletedTriggers['users/{uid}/activities/{activityId}']({
    params: { uid: 'legacy2', activityId: 'a1' },
    data: { data: () => legacyDoc },
  });
  assert(!store.has(`sharedActivities/${legacyShare.shareId}`), 'legacy singular shareId is still cleaned up');

  // ---- deleteActivityAndLinks: atomic delete + revoke, owner-only, handles legacy and failure ----
  // Success, multiple historical links: both the superseded and the current link are gone.
  store.set('users/dal', { plan: 'free', activitiesCreated: 3 });
  store.set('users/dal/activities/a1', act({ userId: 'dal' }));
  const dalFirst = await shareCall('dal', { activityId: 'a1' });
  const dalSecond = await shareCall('dal', { activityId: 'a1', action: 'new' });
  const delResult = await deleteCall('dal', { activityId: 'a1' });
  assert.strictEqual(delResult.deleted, true);
  assert.strictEqual(delResult.revokedCount, 1, 'only the current link is still live (the superseded one was already deleted by action:new)');
  assert(!store.has('users/dal/activities/a1'), 'activity doc removed');
  assert(!store.has(`sharedActivities/${dalFirst.shareId}`));
  assert(!store.has(`sharedActivities/${dalSecond.shareId}`));
  assert.strictEqual(user('dal').activitiesCreated, 3, 'deleting never restores a Free creation credit');

  // Legacy single-link activity (shareId only, no shareIds array) is still fully cleaned up.
  store.set('users/dalLegacy', { plan: 'free', activitiesCreated: 1 });
  const legacyPriv = act({ userId: 'dalLegacy', shareEnabled: true, sharedSetup: true });
  store.set('users/dalLegacy/activities/a1', { ...legacyPriv, shareId: 'legacyShareX' });
  store.set('sharedActivities/legacyShareX', { public: true, ownerUid: 'dalLegacy', toolType: 'read-and-race', words: ['a'] });
  const delLegacy = await deleteCall('dalLegacy', { activityId: 'a1' });
  assert.strictEqual(delLegacy.revokedCount, 1);
  assert(!store.has('sharedActivities/legacyShareX'));
  assert(!store.has('users/dalLegacy/activities/a1'));

  // Unauthorized: a different uid cannot delete someone else's activity (and nothing is touched).
  store.set('users/dalOwner', { plan: 'free', activitiesCreated: 1 });
  store.set('users/dalOwner/activities/a1', act({ userId: 'dalOwner' }));
  const ownerShare = await shareCall('dalOwner', { activityId: 'a1' });
  await rejects(deleteCall('intruder', { activityId: 'a1' }), 'not-found');
  assert(store.has('users/dalOwner/activities/a1'), 'activity untouched by the unauthorized attempt');
  assert(store.has(`sharedActivities/${ownerShare.shareId}`), 'link untouched by the unauthorized attempt');

  // Missing activity: not-found, no side effects.
  await rejects(deleteCall('dalOwner', { activityId: 'doesNotExist' }), 'not-found');

  // Simulated failed transaction: nothing is deleted when the transaction throws partway through
  // (mirrors Firestore's real all-or-nothing transaction guarantee — see the getAll stub above).
  store.set('users/dalFail', { plan: 'free', activitiesCreated: 1 });
  store.set('users/dalFail/activities/a1', act({ userId: 'dalFail', shareId: '__THROW__', shareIds: ['__THROW__'] }));
  store.set('sharedActivities/__THROW__', { public: true, ownerUid: 'dalFail', toolType: 'read-and-race', words: ['a'] });
  await assert.rejects(deleteCall('dalFail', { activityId: 'a1' }), /simulated transient Firestore error/);
  assert(store.has('users/dalFail/activities/a1'), 'activity doc must survive a failed transaction');
  assert(store.has('sharedActivities/__THROW__'), 'link doc must survive a failed transaction');

  console.log('shareExpiration: all checks passed');
})().catch((e) => { console.error(e); process.exit(1); });
