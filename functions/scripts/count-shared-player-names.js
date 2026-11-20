// READ-ONLY count of existing Read & Race / Magic Word Road share links whose saved player names
// are something other than "Player 1" / "Player 2" (teachers can type real names, e.g. students').
// Before the allowlist fix in functions/public-share.js those names were published on public links.
//
// Prints counts only — never any name or other personal information — and writes nothing.
//   node functions/scripts/count-shared-player-names.js
// Needs Admin credentials for the literacy-arcade project (GOOGLE_APPLICATION_CREDENTIALS), the same
// approach as backfill-activities-created.js.
const admin = require('firebase-admin');

const TOOLS = ['read-and-race', 'magic-word-road'];
const DEFAULT_NAMES = new Set(['player 1', 'player 2']);

admin.initializeApp({ projectId: 'literacy-arcade' });
const db = admin.firestore();

// A name counts as "custom" when it is non-empty and not one of the defaults.
function hasCustomName(settings) {
  const setup = settings && Array.isArray(settings.playerSetup) ? settings.playerSetup : [];
  return setup.some((player) => {
    const name = player && typeof player.name === 'string' ? player.name.trim().toLowerCase() : '';
    return name !== '' && !DEFAULT_NAMES.has(name);
  });
}

(async () => {
  const counts = {};
  TOOLS.forEach((tool) => { counts[tool] = { sharedLinks: 0, withCustomPlayerNames: 0 }; });

  const snap = await db.collection('sharedActivities').where('toolType', 'in', TOOLS).get();
  snap.forEach((docSnap) => {
    const data = docSnap.data();
    const bucket = counts[data.toolType];
    if (!bucket) return;
    bucket.sharedLinks += 1;
    if (hasCustomName(data.settings)) bucket.withCustomPlayerNames += 1;
  });

  const total = TOOLS.reduce((sum, tool) => sum + counts[tool].withCustomPlayerNames, 0);
  const totalLinks = TOOLS.reduce((sum, tool) => sum + counts[tool].sharedLinks, 0);
  console.log(JSON.stringify({ byGame: counts, totalLinks, totalWithCustomPlayerNames: total }, null, 2));
  console.log('(read-only: nothing was written, no names were printed)');
})().catch((err) => { console.error(err); process.exit(1); });
