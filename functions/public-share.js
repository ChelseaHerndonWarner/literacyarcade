// Builds the PUBLIC copy of a saved activity for a student share link (sharedActivities).
//
// Share links are readable by anyone who has them, so the copy is an allowlist, not "everything
// except a few private fields": only what students need to play is published, and anything a
// tool might later store on the saved activity (teacher notes, class names, ...) stays private.
//
// Settings are kept as saved (word lists, rounds, hints, toggles are all needed to play), except
// Read & Race / Magic Word Road playerSetup: teachers can type real names into the player boxes
// (e.g. student names), which are not needed to play. Names become "Player 1/2"; colors are kept.

const PUBLIC_TOP_LEVEL_KEYS = ['title', 'toolType', 'activityType', 'words', 'sentences', 'settings'];

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sanitizePublicSettings(settings) {
  const clean = { ...settings };
  if (Array.isArray(clean.playerSetup)) {
    clean.playerSetup = clean.playerSetup.map((player, i) => ({
      name: `Player ${i + 1}`,
      color: player && typeof player.color === 'string' ? player.color : '',
    }));
  }
  return clean;
}

function buildPublicFields(activity) {
  const out = {};
  PUBLIC_TOP_LEVEL_KEYS.forEach((key) => {
    if (activity && activity[key] !== undefined) out[key] = activity[key];
  });
  if (isPlainObject(out.settings)) out.settings = sanitizePublicSettings(out.settings);
  return out;
}

module.exports = { PUBLIC_TOP_LEVEL_KEYS, buildPublicFields, sanitizePublicSettings };
