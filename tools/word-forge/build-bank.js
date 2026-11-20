// Builds word-forge-bank.js from the curated families below, then run validate-bank.js.
//   node tools/word-forge/build-bank.js [--dict path/to/dictionary-ok.txt]
// Every family lists the exact part sequences we accept. Nothing is inferred from a dictionary:
// the optional --dict file (one word per line, e.g. from a spell-checker) is only a safety net that
// drops and reports any generated word the dictionary does not know.
const fs = require('fs');
const path = require('path');

/* ── parts ─────────────────────────────────────────────────────────────── */
// kind: 'derivational' (builds a new word or meaning) or 'inflectional' (grammatical ending). Prefixes are derivational.
const PREFIX = {
  re: ['again', 1], pre: ['before', 1], un: ['not; the opposite of; to undo', 1], dis: ['not; the opposite of', 2],
  mis: ['wrongly; badly', 2], over: ['too much; above', 2], under: ['too little; below', 2],
  out: ['more than; beyond', 3], trans: ['across', 3, 'latin']
};
const SUFFIX = {
  ed: ['happened in the past', 1, null, 'inflectional'], ing: ['happening now; ongoing', 1, null, 'inflectional'], er: ['one who; something that', 1],
  s: ['more than one; he/she/it does', 1, null, 'inflectional'], es: ['more than one; he/she/it does (after s, x, z, ch, sh)', 1, null, 'inflectional'],
  ful: ['full of', 2], less: ['without', 2], ness: ['state or quality of being', 3], ly: ['in a way that is', 3],
  ment: ['the act or result of', 3], ion: ['the act or result of', 3, 'latin'], ation: ['the act or result of', 3, 'latin']
};
// free English bases (no spelling change needed for the endings we use); port is a bound Latin root
const ROOT = {
  play: 'to play', work: 'to work', read: 'to read', build: 'to build', heat: 'to make hot', view: 'to look at',
  cook: 'to cook', school: 'a place for learning', pack: 'to put into a container', fill: 'to make full',
  load: 'to put a load on', jump: 'to jump', kick: 'to kick', lock: 'to fasten with a lock', paint: 'to paint',
  wash: 'to wash', print: 'to print', test: 'to test', check: 'to check', start: 'to begin', point: 'to point',
  order: 'to put in order; to ask for', call: 'to call', count: 'to count', match: 'to go together', spell: 'to spell',
  trust: 'to believe in', use: 'to use', care: 'to care', hope: 'to wish for', help: 'to help', thank: 'to give thanks',
  delight: 'great pleasure', connect: 'to join together', cover: 'to put over', discover: 'to find out (treated as one base)',
  form: 'shape', port: 'to carry', act: 'to do', place: 'to put', agree: 'to think alike', appear: 'to come into view',
  obey: 'to follow orders', like: 'to enjoy', fold: 'to bend over on itself', dress: 'to put on clothes',
  clean: 'to make clean', fair: 'just; equal', kind: 'caring', sure: 'certain', safe: 'free from harm',
  clear: 'easy to see; to make clear', usual: 'common; expected', real: 'true', happy: 'glad', lucky: 'having good luck'
};
const ORIGIN = { port: ['latin', false], act: ['latin', true], form: ['latin', true] };

/* ── families (DSL) ─────────────────────────────────────────────────────
   token  = [prefix ':'] [suffix ('+' suffix)*]
     'ed'        root+ed          're:'      re+root          're:ed'  re+root+ed
     'ful+ness'  root+ful+ness    'un:ful'   un+root+ful
   Macro V(...) adds the ordinary verb forms. 's' becomes 'es' after s, x, z, ch, sh. */
const sib = (r) => /(s|x|z|ch|sh)$/.test(r);
function V(root, prefixes = [], opts = {}) {
  const infl = opts.infl || 'ed ing s';
  const toks = [...infl.split(' ')];
  if (opts.er) toks.push('er', 'er+s');
  for (const p of prefixes) {
    const [pre, only] = p.split('@'); // 'over@s' = only the -s form
    toks.push(pre + ':');
    for (const i of (only ? only.split(',') : infl.split(' '))) toks.push(pre + ':' + i);
  }
  return { root, toks: toks.concat((opts.extra || '').split(' ').filter(Boolean)) };
}
const F = (root, extra) => ({ root, toks: extra.split(' ').filter(Boolean) }); // explicit list only

const FAMILIES = [
  // verbs with ordinary endings
  V('play', ['re', 'over', 'out'], { er: true }), V('work', ['re', 'over', 'out'], { er: true }),
  V('read', ['re', 'mis'], { er: true, infl: 'ing s' }), V('build', ['re', 'over'], { er: true, infl: 'ing s' }), // irregular past (read, built): no -ed form
  V('heat', ['pre', 're', 'over'], { er: true }), V('view', ['pre', 're', 'over@s'], { er: true }),
  V('cook', ['pre', 're', 'over', 'under']), F('school', 'ed ing s pre: pre:er pre:er+s pre:s'),
  V('pack', ['re', 'un', 'over']), V('fill', ['re', 'over'], { er: true }),
  V('load', ['re', 'un', 'pre', 'over'], { er: true }), V('jump', [], { er: true }), V('kick', [], { er: true }),
  V('lock', ['un'], { er: true }), V('paint', ['re', 'over'], { er: true, extra: 'un:ed' }),
  V('wash', ['re'], { er: true, extra: 'un:ed' }), V('print', ['re', 'mis'], { er: true }),
  V('test', ['pre', 're']), V('check', ['re'], { er: true }), V('start', ['re'], { er: true }),
  V('point', [], { er: true }), V('order', ['re', 'pre']), V('call', [], { er: true }),
  V('count', ['mis', 're', 'under']), V('match', ['mis', 're'], { extra: 'un:ed' }), V('spell', ['mis']),
  V('trust', ['dis', 'mis']), V('fold', ['re', 'un'], { er: true }), V('dress', ['un', 'over']),
  V('clean', [], { er: true, extra: 'un:' }), V('clear', [], { extra: 'un: ly' }),
  V('appear', ['dis', 're']), V('obey', ['dis']),
  // roots that end in a silent e: only endings that need no spelling change
  F('use', 's ful less ful+ness less+ness ful+ly less+ly re: re:s mis: mis:s over: over:s dis:'),
  F('care', 's ful less ful+ness less+ness ful+ly less+ly'),
  F('hope', 's ful less ful+ness less+ness ful+ly less+ly'),
  F('place', 's ment ment+s re: re:s re:ment re:ment+s mis: mis:s mis:ment'),
  F('agree', 's ing ment ment+s dis: dis:s dis:ing dis:ment dis:ment+s'),
  F('like', 's ness dis: dis:s'),
  // -ful / -less families
  V('help', [], { er: true, extra: 'ful less ful+ness less+ness ful+ly less+ly un:ful un:ful+ness un:ful+ly' }),
  V('thank', [], { extra: 'ful less ful+ness less+ness ful+ly un:ful un:ful+ness' }),
  V('delight', [], { extra: 'ful ful+ness ful+ly' }),
  // Latin-flavoured chains
  V('connect', ['re', 'dis'], { extra: 'un:ed ion ion+s re:ion dis:ion' }),
  V('cover', ['un']), V('discover', ['re']),
  V('form', ['re', 'trans'], { extra: 'ation ation+s re:ation trans:ation trans:ation+s' }),
  F('port', 'trans: trans:ed trans:ing trans:s trans:ation'),
  V('act', ['re', 'over'], { extra: 'ion ion+s re:ion re:ion+s' }),
  // adjectives
  F('fair', 'un: ly ness un:ly un:ness'), F('kind', 'un: ly ness un:ly un:ness'), F('sure', 'un: ly'),
  F('safe', 'un: ly'), F('usual', 'un: ly un:ly'), F('real', 'un: ly'), F('happy', 'un:'), F('lucky', 'un:')
];

// words an adult would pause on: flagged ⚑ in the review sheet (kept, but need your yes/no)
// words flagged ⚑ for review (none outstanding: all earlier flags were decided)
const FLAGS = {};
const NOTES = {
  rereading: 're + read + ing (one prefix, not re+re+ading)', misspell: 'the double s comes from the two parts meeting',
  transform: 'trans (across) + form (shape)', transport: 'trans (across) + port (carry): a bound Latin root',
  rediscover: 're + discover; discover is treated as one base rune (not dis + cover)',
  unwashed: 'adjective use: un + wash + ed', unpainted: 'adjective use: un + paint + ed',
  unmatched: 'adjective use: un + match + ed', unconnected: 'adjective use: un + connect + ed',
  preload: 'computing sense', likeness: 'like + ness'
};
// excluded on purpose (meaning not transparent enough, or accidental): kept here so the review sheet can show them
const EXCLUDED = {
  discount: 'dis + count: meaning not transparent', discounted: 'as above', discounting: 'as above', discounts: 'as above',
  discover: 'dis + cover: meaning not transparent (only re + discover with one base rune is allowed)',
  recover: 're + cover: two meanings, not transparent', recovered: 'as above', recovering: 'as above', recovers: 'as above',
  report: 're + port: not transparent', reported: 'as above', reporting: 'as above', reports: 'as above',
  transact: 'trans + act: meaning not transparent (excluded for now)', transacted: 'as above', transacting: 'as above', transacts: 'as above',
  transaction: 'as above', transactions: 'as above',
  transportations: 'rare plural', reformations: 'rare plural',
  reed: 're + ed: accidental', unless: 'un + less: accidental', remove: 're + move: not "move again"',
  running: 'run + ing needs a spelling change', writing: 'write + ing needs a spelling change', hoped: 'hope + ed needs a spelling change'
};

/* ── expand ─────────────────────────────────────────────────────────────── */
function expand(fam) {
  const out = [];
  for (const tok of fam.toks) {
    let pre = null, rest = tok;
    if (tok.includes(':')) { [pre, rest] = tok.split(':'); }
    const sfx = rest ? rest.split('+') : [];
    if (sfx.length && sfx[0] === 's' && sib(fam.root)) sfx[0] = 'es';
    const seq = [...(pre ? [pre] : []), fam.root, ...sfx];
    if (seq.length >= 2) out.push(seq);
  }
  return out;
}

// real words a spell-checker is known to miss; kept on purpose (you asked to keep unhelpfulness)
const DICT_KEEP = new Set(['unhelpfulness']);
const dictArg = process.argv.indexOf('--dict');
const dictOk = dictArg > 0 ? new Set(fs.readFileSync(process.argv[dictArg + 1], 'utf8').split('\n')) : null;

const wordMap = new Map();
const dropped = [];
for (const fam of FAMILIES) {
  for (const seq of expand(fam)) {
    const w = seq.join('');
    if (dictOk && !dictOk.has(w) && !DICT_KEEP.has(w)) { dropped.push(w); continue; }
    if (wordMap.has(w)) continue;
    wordMap.set(w, seq);
  }
}

/* ── recipes: rune sets sized for the 1/2/3-minute timers ─────────────── */
const R = (id, vault, tier, title, focus, parts) => ({ id, vault, tier, title, focus, parts: parts.split(' ') });
const RECIPES = [
  R('WB-1', 'builders', 1, 're- builders', 'Build familiar words with re- and common endings', 're play work read ed ing er s'),
  R('WB-2', 'builders', 1, 'a fresh start', 'Make new words from check, start, paint and print', 're check start paint print ed ing er s'),
  R('WB-3', 'builders', 2, 'pre- and re- builders', 'Build words with pre- and re- plus suffix options', 'pre re heat view cook school ed ing er s'),
  R('WB-4', 'builders', 2, 'pack, fill, load', 'Build words from container and filling words', 're over pack fill load ed ing er s'),
  R('WB-5', 'builders', 2, 'lock, wash, load', 'Build words with re- and un-', 're un lock wash load ed ing er s'),
  R('WB-6', 'builders', 3, 'play/work family', 'Build word families with more than one prefix', 're over out play work cook heat ed ing er s'),
  R('WC-1', 'changers', 1, 'dis-/mis- meaning shifts', 'Notice how prefixes change meaning', 'dis mis re trust spell count match ed ing s es'),
  R('WC-2', 'changers', 1, '-ful / -less contrasts', 'Compare suffixes that change meaning', 'un help care hope use ful less ly s ness'),
  R('WC-3', 'changers', 1, 'un- and the opposite', 'Flip meanings with un- and -ly', 'un fair kind usual sure safe clear happy ly ness'),
  R('WC-4', 'changers', 2, 'over-/under- degree changes', 'Change meaning by amount or degree', 'over under cook fill work count ed ing er s'),
  R('WC-5', 'changers', 3, 'undoing and disagreeing', 'Build words that undo or oppose', 'un dis fold dress agree obey like ed ing s es ment'),
  R('WC-6', 'changers', 3, 'misplace and disappear', 'Build words with dis-, mis- and re-', 'dis mis re place appear obey use ed ing s ment'),
  R('WCH-1', 'chains', 1, '-ful to -fulness chains', 'Extend bases into adjectives and nouns', 'un help thank care hope ful less ness ly'),
  R('WCH-2', 'chains', 2, 'connect-and-disconnect chains', 'Extend words through prefix and suffix chains', 're dis un connect cover appear ed ing s ion'),
  R('WCH-3', 'chains', 2, 'agree and disagree chains', 'Chain prefixes and -ment onto longer words', 'dis re agree place appear ing s ed ment'),
  R('WCH-4', 'chains', 3, 'longer academic chains', 'Build longer transparent 3-part words', 'trans re form port act ed ing s ation ion'),
  R('WCH-5', 'chains', 3, 'delight and thank chains', 'Build long chains with -ful, -ness and -ly', 'un help thank delight care ful less ness ly ed s'),
  R('WM-1', 'masters', 2, 'out-, over- and re- masters', 'Chain 3+ parts for rare words', 'over out re under play work load cook ed ing er s'),
  R('WM-2', 'masters', 3, 'connect and cover masters', 'Chain prefixes onto longer roots', 're dis un connect cover fold discover ed ing s ion'),
  R('WM-3', 'masters', 3, 'help, care and thank masters', 'Chain prefixes and endings for the longest words', 'un help care thank hope ful less ness ly s'),
  R('WM-4', 'masters', 3, 'transform and transport masters', 'Chain Latin-flavoured parts', 'trans re dis form port appear agree ed ing s ation ment')
];

/* ── write the bank file ─────────────────────────────────────────────── */
const partsOut = [];
for (const [id, [meaning, level, origin]] of Object.entries(PREFIX)) partsOut.push({ id, text: id, type: 'prefix', kind: 'derivational', meaning, level, origin: origin || 'english', free: false });
for (const [id, meaning] of Object.entries(ROOT)) {
  const [origin, free] = ORIGIN[id] || ['english', true];
  partsOut.push({ id, text: id, type: 'root', kind: 'base', meaning, level: 1, origin, free });
}
for (const [id, [meaning, level, origin, kind]] of Object.entries(SUFFIX)) partsOut.push({ id, text: id, type: 'suffix', kind: kind || 'derivational', meaning, level, origin: origin || 'english', free: false });

// word level: 1 = two parts, 2 = three, 3 = four, 4 = five or more
const wordsOut = [...wordMap.entries()].map(([w, seq]) => {
  const o = { w, parts: seq, level: Math.min(4, seq.length - 1) };
  if (FLAGS[w]) { o.review = true; o.note = FLAGS[w]; }
  else if (NOTES[w]) o.note = NOTES[w];
  return o;
});

const header = fs.readFileSync(path.join(__dirname, 'bank-header.txt'), 'utf8').trimEnd();
const body = `
(function (root) {
  'use strict';
  var bank = ${JSON.stringify({ version: 1, status: 'draft-for-review', parts: partsOut, words: wordsOut, recipes: RECIPES.map((r) => ({ ...r, minWords: 15 })) }, null, 0).replace(/\},\{/g, '},\n{')};
  if (typeof module !== 'undefined' && module.exports) module.exports = bank;
  else root.WORD_FORGE_BANK = bank;
})(typeof window !== 'undefined' ? window : this);
`;
fs.writeFileSync(path.join(__dirname, '../../word-forge-bank.js'), header + '\n' + body);
fs.writeFileSync(path.join(__dirname, 'excluded.json'), JSON.stringify(EXCLUDED, null, 1));
const emit = process.argv.indexOf('--emit'); // optional: write the generated words for a dictionary check
if (emit > 0) fs.writeFileSync(process.argv[emit + 1], [...wordMap.keys()].join('\n'));
console.log(`words ${wordsOut.length}, parts ${partsOut.length}, recipes ${RECIPES.length}` + (dictOk ? `, dropped by dictionary: ${dropped.length}${dropped.length ? ' → ' + dropped.join(', ') : ''}` : ' (no dictionary filter)'));
