// Run with: node functions/public-share.test.js
const assert = require('assert');
const { buildPublicFields } = require('./public-share');

const base = (toolType, settings, extra = {}) => ({
  title: 'T', toolType, activityType: toolType, words: ['one', 'two'], settings,
  url: toolType + '.html', userId: 'u1', ownerUid: 'u1', shareEnabled: true, sharedSetup: true, shareId: 's',
  createdAt: 1, updatedAt: 2, ...extra,
});

// ---- Read & Race / Magic Word Road: player names are NOT published, colors and gameplay are ----
for (const tool of ['read-and-race', 'magic-word-road']) {
  const settings = {
    studentCanEdit: false, listType: 'custom', level: '', customText: 'one\ntwo', selectedWords: ['one', 'two'], playerCount: 2,
    playerSetup: [{ name: 'Maria Lopez', color: '#e63946' }, { name: 'Jaden P.', color: '#457b9d' }],
  };
  const pub = buildPublicFields(base(tool, settings));
  assert.deepStrictEqual(pub.settings.playerSetup, [{ name: 'Player 1', color: '#e63946' }, { name: 'Player 2', color: '#457b9d' }]);
  assert(!JSON.stringify(pub).includes('Maria') && !JSON.stringify(pub).includes('Jaden'));
  // everything needed to play survives
  ['studentCanEdit', 'listType', 'level', 'customText', 'selectedWords', 'playerCount'].forEach((k) => assert.deepStrictEqual(pub.settings[k], settings[k], tool + ' ' + k));
  assert.deepStrictEqual(pub.words, ['one', 'two']);
}

// ---- Only the allowlisted top-level fields are published; unknown/private ones never are ----
const leaky = buildPublicFields(base('read-and-race', {}, {
  teacherNotes: 'Jaden needs support', className: 'Period 3 - Ms. Lee', editorState: { x: 1 }, studentRoster: ['a'], collections: ['c1'],
}));
assert.deepStrictEqual(Object.keys(leaky).sort(), ['activityType', 'settings', 'title', 'toolType', 'words']);
['url', 'userId', 'ownerUid', 'shareId', 'shareEnabled', 'sharedSetup', 'createdAt', 'updatedAt', 'teacherNotes', 'className', 'editorState', 'studentRoster', 'collections']
  .forEach((k) => assert(!(k in leaky), k + ' must not be public'));

// ---- Gameplay settings for the other tools pass through untouched ----
const cases = {
  'word-wizard-custom': { wordMode: 'custom', wordLength: 5, rounds: 4, customWords: ['frog', 'duck'], magicHints: false },
  'robot-word-builder': { tab: 'fry', level: 'a', phonicsGroup: '', phonicsPattern: '', studentCanEdit: false, selectedWords: ['one'], wordEntries: [{ word: 'one', source: 'fry' }] },
  'word-spinner': { tab: 'custom', level: '', customWords: ['one'], selectedWords: ['one'], wheelEntries: [{ word: 'one', source: 'custom' }] },
  'vocabulary-flashcards': { tab: 'custom', deckTitle: 'Deck', customText: 'one | 1', cards: [{ word: 'one', definition: '1' }], countdownEnabled: true, soundEnabled: true },
  'digital-reading-flashcards': { tab: 'custom', customText: 'one', selectedWords: ['one'], customWords: ['one'], countdownEnabled: true, soundEnabled: true, studentCanEdit: false },
};
Object.entries(cases).forEach(([tool, settings]) => {
  assert.deepStrictEqual(buildPublicFields(base(tool, settings)).settings, settings, tool);
});

// Sentence Spinner keeps its sentences (top-level and in settings).
const sentence = buildPublicFields(base('sentence-spinner', { studentCanEdit: false, sentences: ['A cat sat.'] }, { sentences: ['A cat sat.'] }));
assert.deepStrictEqual(sentence.sentences, ['A cat sat.']);
assert.deepStrictEqual(sentence.settings.sentences, ['A cat sat.']);

// Does not mutate the saved activity.
const saved = base('read-and-race', { playerSetup: [{ name: 'Maria', color: 'c' }] });
buildPublicFields(saved);
assert.strictEqual(saved.settings.playerSetup[0].name, 'Maria');

console.log('public-share: all checks passed');
