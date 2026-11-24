// Firestore security-rules tests for the Free-plan creation limit and read-only activities.
// Needs the Firestore emulator (Java) and @firebase/rules-unit-testing + firebase (not project deps):
//   firebase emulators:exec --only firestore --project demo-literacy "node tests/firestore-rules/rules.test.js"
// (run from the repo root so firebase.json points at firestore.rules).
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection } = require('firebase/firestore');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(['ok', name]); } catch (e) { results.push(['FAIL', name, e.message]); }
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId: 'demo-literacy',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '../../firestore.rules'), 'utf8') },
  });

  const seed = async (uid, user, activities = 1) => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      if (user) await setDoc(doc(db, 'users', uid), user);
      for (let i = 0; i < activities; i += 1) {
        await setDoc(doc(db, `users/${uid}/activities`, 'a' + i), { title: 'T', toolType: 'read-and-race', words: ['one'], settings: { rounds: 3 } });
      }
    });
  };
  await seed('locked', { plan: 'free', activitiesCreated: 5 }, 2);
  await seed('lockedNoPlan', { activitiesCreated: 7 }, 1);
  await seed('freeOk', { plan: 'free', activitiesCreated: 3 }, 1);
  await seed('plus', { plan: 'plus', activitiesCreated: 5 }, 1);
  await seed('family', { plan: 'family', activitiesCreated: 0 }, 1);
  await seed('lapsed', { plan: 'free', activitiesCreated: 2 }, 1);
  await seed('legacy', null, 1);            // no user doc at all
  await seed('noCounter', { plan: 'free' }, 1);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'sharedActivities/existing'), { title: 'S', toolType: 'read-and-race', words: ['one'], public: true, ownerUid: 'locked' });
    const { Timestamp } = require('firebase/firestore');
    await setDoc(doc(ctx.firestore(), 'sharedActivities/notExpired'), {
      title: 'Still good', toolType: 'read-and-race', words: ['one'], public: true, ownerUid: 'locked',
      expiresAt: Timestamp.fromMillis(Date.now() + 14 * 24 * 60 * 60 * 1000)
    });
    await setDoc(doc(ctx.firestore(), 'sharedActivities/expiredLink'), {
      title: 'Gone', toolType: 'read-and-race', words: ['one'], public: true, ownerUid: 'locked',
      expiresAt: Timestamp.fromMillis(Date.now() - 1000)
    });
  });

  const as = (uid) => env.authenticatedContext(uid).firestore();
  const act = (db, uid, id = 'a0') => doc(db, `users/${uid}/activities/${id}`);

  // ---- Free account at the limit: read-only, but can read, delete and keep shared links ----
  await check('locked: can read own activity', () => assertSucceeds(getDoc(act(as('locked'), 'locked'))));
  await check('locked: CANNOT edit words/settings', () => assertFails(updateDoc(act(as('locked'), 'locked'), { words: ['changed'], 'settings.rounds': 9 })));
  await check('locked: CANNOT rename', () => assertFails(updateDoc(act(as('locked'), 'locked'), { title: 'New' })));
  await check('locked (no plan field): CANNOT edit', () => assertFails(updateDoc(act(as('lockedNoPlan'), 'lockedNoPlan'), { words: ['x'] })));
  // Direct client deletion is blocked: deleting must also revoke every shared link atomically,
  // which only the deleteActivityAndLinks Cloud Function (Admin SDK) can do.
  await check('locked: CANNOT delete an activity directly (must go through deleteActivityAndLinks)', () => assertFails(deleteDoc(act(as('locked'), 'locked', 'a1'))));
  await check('an account that CAN edit also CANNOT delete directly', () => assertFails(deleteDoc(act(as('freeOk'), 'freeOk'))));
  await check('locked: CANNOT create an activity directly', () => assertFails(setDoc(act(as('locked'), 'locked', 'new1'), { title: 'x', toolType: 'read-and-race' })));
  await check('locked: CANNOT addDoc an activity', () => assertFails(addDoc(collection(as('locked'), 'users/locked/activities'), { title: 'x' })));

  // ---- sharedActivities: no direct client creates, students keep reading, owners can revoke ----
  await check('locked: CANNOT create a shared game directly', () => assertFails(addDoc(collection(as('locked'), 'sharedActivities'), { title: 'New', toolType: 'read-and-race', words: ['x'], public: true, ownerUid: 'locked' })));
  await check('plus: CANNOT create a shared doc directly either (server only)', () => assertFails(addDoc(collection(as('plus'), 'sharedActivities'), { title: 'New', public: true, ownerUid: 'plus' })));
  await check('freeOk: CANNOT create a shared doc directly', () => assertFails(addDoc(collection(as('freeOk'), 'sharedActivities'), { title: 'New', public: true, ownerUid: 'freeOk' })));
  await check('signed-out student CAN read an existing shared link', () => assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'sharedActivities/existing'))));
  await check('shared links cannot be listed', () => assertFails(require('firebase/firestore').getDocs(collection(env.unauthenticatedContext().firestore(), 'sharedActivities'))));
  await check('shared doc cannot be edited by its owner', () => assertFails(updateDoc(doc(as('locked'), 'sharedActivities/existing'), { words: ['hack'] })));
  await check('other user cannot delete the shared doc', () => assertFails(deleteDoc(doc(as('plus'), 'sharedActivities/existing'))));
  await check('owner CAN delete (revoke) the shared doc', () => assertSucceeds(deleteDoc(doc(as('locked'), 'sharedActivities/existing'))));

  // ---- expiration: enforced by the rule itself, not just hidden in the frontend ----
  await check('legacy link with no expiresAt field: still readable (grandfathered)', () =>
    assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'sharedActivities/notExpired'))));
  await check('non-expired link: signed-out student CAN read it', () =>
    assertSucceeds(getDoc(doc(env.unauthenticatedContext().firestore(), 'sharedActivities/notExpired'))));
  await check('expired link: signed-out student CANNOT read it', () =>
    assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'sharedActivities/expiredLink'))));
  await check('expired link: even the owner CANNOT read it directly (same as anonymous)', () =>
    assertFails(getDoc(doc(as('locked'), 'sharedActivities/expiredLink'))));
  await check('owner CANNOT extend expiresAt by a direct client update (must go through the Cloud Function)', () =>
    assertFails(updateDoc(doc(as('locked'), 'sharedActivities/notExpired'), { expiresAt: require('firebase/firestore').Timestamp.fromMillis(Date.now() + 999 * 24 * 60 * 60 * 1000) })));

  // ---- accounts that can still edit ----
  await check('free with credits left: CAN edit', () => assertSucceeds(updateDoc(act(as('freeOk'), 'freeOk'), { words: ['two'] })));
  await check('plus (counter 5): CAN edit', () => assertSucceeds(updateDoc(act(as('plus'), 'plus'), { words: ['two'] })));
  await check('family: CAN edit', () => assertSucceeds(updateDoc(act(as('family'), 'family'), { words: ['two'] })));
  await check('lapsed (free, counter 2): CAN edit', () => assertSucceeds(updateDoc(act(as('lapsed'), 'lapsed'), { words: ['two'] })));
  await check('no user doc: CAN edit', () => assertSucceeds(updateDoc(act(as('legacy'), 'legacy'), { words: ['two'] })));
  await check('no counter yet: CAN edit', () => assertSucceeds(updateDoc(act(as('noCounter'), 'noCounter'), { words: ['two'] })));
  await check('free with credits left: still CANNOT create directly', () => assertFails(setDoc(act(as('freeOk'), 'freeOk', 'zzz'), { title: 'x' })));

  // ---- the counter and plan cannot be tampered with from the browser ----
  await check('locked user CANNOT reset own counter', () => assertFails(updateDoc(doc(as('locked'), 'users/locked'), { activitiesCreated: 0 })));
  await check('locked user CANNOT upgrade own plan', () => assertFails(updateDoc(doc(as('locked'), 'users/locked'), { plan: 'plus' })));
  await check('new user doc cannot include a counter', () => assertFails(setDoc(doc(as('fresh1'), 'users/fresh1'), { activitiesCreated: 0 })));
  await check('user can still update harmless profile fields', () => assertSucceeds(updateDoc(doc(as('locked'), 'users/locked'), { displayName: 'Ms. T' })));
  await check('creationHistory is server-only', () => assertFails(getDoc(doc(as('locked'), 'users/locked/creationHistory/x'))));

  // ---- isolation ----
  await check('another user CANNOT read my activity', () => assertFails(getDoc(act(as('plus'), 'locked'))));
  await check('another user CANNOT edit my activity', () => assertFails(updateDoc(act(as('plus'), 'freeOk'), { words: ['x'] })));

  await env.cleanup();
  let failed = 0;
  results.forEach(([status, name, msg]) => { if (status !== 'ok') failed += 1; console.log(status.padEnd(5), name, msg ? '— ' + msg : ''); });
  console.log(`\n${results.length - failed}/${results.length} rules checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
