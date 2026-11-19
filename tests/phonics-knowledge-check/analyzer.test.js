// Regression tests for the Phonics Knowledge Check analyzer, report layout and Print Report reliability (Phases 1-5).
// No dependencies. Run from the repo root:
//   node tests/phonics-knowledge-check/analyzer.test.js
// The page script is executed in a vm with a stubbed DOM, so the real analyzer code is tested.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ------------------------------ harness ------------------------------ */
// PHONICS_HTML can point at another copy of the page (for example an older commit) to compare behavior.
const html = fs.readFileSync(process.env.PHONICS_HTML || path.join(__dirname, '..', '..', 'phonics-knowledge-check.html'), 'utf8');
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const pageScript = scripts.reduce((a, b) => (b.length > a.length ? b : a), '');
function stub(){
  const f = function(){};
  return new Proxy(f, {
    get(t, k){
      if(k === Symbol.toPrimitive) return () => '';
      if(k === 'classList') return { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
      if(k === 'style' || k === 'dataset') return {};
      if(k === 'children' || k === 'options') return [];
      if(k === 'value' || k === 'textContent' || k === 'innerHTML') return t['_' + String(k)] || '';
      if(k === 'checked') return false;
      if(k === 'querySelector' || k === 'closest') return () => stub();
      if(k === 'querySelectorAll' || k === 'getElementsByClassName') return () => [];
      return t[k] || (t[k] = stub());
    },
    set(t, k, v){ t['_' + String(k)] = v; return true; },
    apply(){ return stub(); }
  });
}
const ctx = { document: stub(), window: {}, localStorage: { getItem(){ return null; }, setItem(){} }, sessionStorage: { getItem(){ return null; }, setItem(){} },
  console, setTimeout: () => 0, clearTimeout(){}, requestAnimationFrame: () => 0, cancelAnimationFrame(){}, navigator: {}, location: { search: '', href: '' },
  Intl, Date, Math, Object, Array, JSON, Set, Map, String, Number, Promise, performance: { now: () => 0 }, addEventListener(){},
  matchMedia: () => ({ matches: false, addEventListener(){} }), URLSearchParams, Image: function(){}, history: {} };
ctx.window = ctx;
vm.createContext(ctx);
let code = pageScript.replace(/import\(\s*['"][^'"]+['"]\s*\)/g, 'Promise.resolve(new Proxy({}, { get: () => () => {} }))');
const end = code.lastIndexOf('})();');
code = code.slice(0, end) + ';globalThis.__api={state,PHONICS_WORDS,ALL_WORDS,scoreData,renderPatternNotes,patternPrintRows,buildFocusAreas,analyzeError,areaLabel,areaPieces,bucketHeading,bucketNotes,createReportPrintController};\n' + code.slice(end);
vm.runInContext(code, ctx);
const api = ctx.__api;
const { state, ALL_WORDS, PHONICS_WORDS } = api;

/* ------------------------------ helpers ------------------------------ */
const SKIP = '__SKIP__';
const FAMILY_CAUTION = 'Pattern family: related spellings in the same family were missed; this does not mean every spelling in the family is unknown.';
const BROAD_CAUTION = 'Broader skill family: the misses involve different vowel sounds or consonant clusters that share one spelling convention or decoding skill. This points to possible difficulty with that shared convention; it does not show repeated difficulty with any single vowel or cluster.';
const NONSENSE_NOTE = 'Nonsense words are supplemental transfer evidence: one unfamiliar-word response may also reflect lexicalization or task familiarity.';
function find(sec, word){ const w = ALL_WORDS.find(x => x.sectionId === sec && x.word === word); assert(w, `unknown word ${sec}:${word}`); return w; }
// marks: { 'section:word': response | SKIP }
function run(marks){
  const secs = [...new Set(Object.keys(marks).map(k => k.split(':')[0]))];
  state.marks = {}; state.notAdministered = new Set();
  state.adminSecs = PHONICS_WORDS.filter(s => secs.includes(s.sectionId)); state.sections = secs;
  for(const [k, r] of Object.entries(marks)){
    const [sec, word] = k.split(':');
    state.marks[find(sec, word).id] = r === SKIP ? { wrong:true, response:'', skipped:true } : { wrong:true, response:r, skipped:false };
  }
  const score = api.scoreData();
  // `print` is the sentence-form text of the focus data (the format used through Stage B), kept so the wording and
  // grouping tests keep exercising the shared data; `printC` is the actual Stage C printed layout.
  return { score, buckets: api.buildFocusAreas(score.details), screen: api.renderPatternNotes(score.details), print: legacyPrint(score.details), printC: api.patternPrintRows(score.details) };
}
const escH = x => String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
function legacyPrint(details){
  if(!details.length) return '<p>No miscues to analyze.</p>';
  return api.buildFocusAreas(details).map(bucket => {
    const rows = bucket.areas.map(area => {
      const p = api.areaPieces(bucket, area);
      const title = p.focus ? `${p.label}: ${p.focus}` : (p.realWords || p.nonsenseWords);
      const parts = [];
      if(p.focus) parts.push(p.realWords || p.nonsenseWords);
      if(p.breakdown) parts.push(p.breakdown);
      if(p.sharedNote) parts.push(p.sharedNote);
      if(p.realWords && p.nonsenseWords) parts.push(p.focus ? `Supporting nonsense-word evidence: ${p.nonsenseWords}` : `Nonsense words: ${p.nonsenseWords}`);
      return `<div><strong>${escH(title)}</strong>${parts.length ? `<span>${escH(parts.join(' · '))}</span>` : ''}</div>`;
    }).join('');
    return `<div><h3>${escH(api.bucketHeading(bucket))}</h3><p>${escH(bucket.def.guide)}</p>${rows}${api.bucketNotes(bucket).map(n => `<p>${escH(n)}</p>`).join('')}</div>`;
  }).join('');
}
const text = h => h.replace(/<br>/g, ' | ').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
const bucket = (r, tag) => r.buckets.find(b => b.tag === tag);
const areaWords = a => [...new Set(a.real.map(e => e.word))];
const areaLabel = a => a; // (kept for readability below)
const label = (r, tag, i = 0) => { const b = bucket(r, tag); return b.areas[i]; };
const S1 = 'short-vowels-cvc', S2 = 'blends-short-vowels', S3 = 'digraphs-trigraphs-short-vowels', S4 = 'r-controlled-vowels',
  S5 = 'long-vowel-spellings', S6 = 'variant-vowels', S7 = 'low-frequency-spellings', S8 = 'multisyllabic-words';
const analyze = (sec, word, resp) => api.analyzeError(find(sec, word), resp, false);

let passed = 0, failed = 0;
const asyncTests = [];
function atest(name, fn){ asyncTests.push([name, fn]); }   // run one after another before the summary
function test(name, fn){
  try { fn(); passed++; console.log('ok    ' + name); }
  catch(e){ failed++; console.log('FAIL  ' + name + '\n      ' + (e.message || e).split('\n')[0]); }
}

/* ------------------- assessment data and scoring are unchanged ------------------- */
const SCRIPTS = {
  [S1]: { marks:{ cat:'cot', map:'mop', bed:'bid', pig:'big', dog:SKIP, cup:'cu', zab:'zeb', zop:'zot' }, correct:7, total:15, errors:8, real:[4,10], non:[3,5] },
  [S2]: { marks:{ spin:'span', split:'splat', milk:'mil', jump:'jum', plug:'pug', pond:'pand', quill:SKIP, glep:'gep', stog:'steg' }, correct:9, total:18, errors:9, real:[6,13], non:[3,5] },
  [S3]: { marks:{ badge:'bad', nudge:'nud', shed:'sed', dish:'did', chat:'chit', this:'dis', notch:'not', datch:'dat', phip:SKIP }, correct:9, total:18, errors:9, real:[6,13], non:[3,5] },
  [S4]: { marks:{ card:'cord', bark:'bork', varm:'vorm', fern:'farn', curl:'carl', bird:'burt', fork:'fort', surf:SKIP }, correct:7, total:15, errors:8, real:[3,10], non:[4,5] },
  [S5]: { marks:{ cake:'cack', bike:'bik', zide:'zid', rain:'ran', feet:'fet', leaf:'leep', cry:'cray', play:'pay', rope:'robe' }, correct:11, total:20, errors:9, real:[7,15], non:[4,5] },
  [S6]: { marks:{ few:'foo', grew:'grow', moon:'mon', cook:'kook', coin:'con', toy:'tie', hawk:'hock', fault:SKIP, noit:'nit' }, correct:7, total:16, errors:9, real:[4,12], non:[3,4] },
  [S7]: { marks:{ phone:'pone', knee:'kunee', lamb:'lambuh', gem:'jam', cell:'kell', cemp:'kemp', wrab:'rap', gnome:SKIP }, correct:6, total:14, errors:8, real:[4,10], non:[2,4] },
  [S8]: { marks:{ inhale:'inhal', reptile:'reptil', repnate:'repnat', velvet:'velvit', catfish:'catfis', report:'ruhport', table:'tabul', tornado:SKIP, rimpo:'rimp' }, correct:9, total:18, errors:9, real:[7,14], non:[2,4] }
};
const keyed = (sec, marks) => Object.fromEntries(Object.entries(marks).map(([w, r]) => [`${sec}:${w}`, r]));

test('section order and word counts are unchanged', () => {
  const j = x => JSON.stringify(x);
  assert.strictEqual(j(PHONICS_WORDS.map(s => s.sectionId)), j([S1, S2, S3, S4, S5, S6, S7, S8]));
  assert.strictEqual(j(PHONICS_WORDS.map(s => s.words.length)), j([15, 18, 18, 15, 20, 16, 14, 18]));
  assert.strictEqual(j(PHONICS_WORDS.map(s => s.words.filter(w => w.type === 'nonsense').length)), j([5, 5, 5, 5, 5, 4, 4, 4]));
});
for(const [sec, sc] of Object.entries(SCRIPTS)){
  test(`scoring totals unchanged: ${sec}`, () => {
    const r = run(keyed(sec, sc.marks)).score;
    assert.strictEqual(r.correct, sc.correct); assert.strictEqual(r.total, sc.total); assert.strictEqual(r.errors, sc.errors);
    assert.deepStrictEqual([r.realCorrect, r.realTotal], sc.real); assert.deepStrictEqual([r.nonCorrect, r.nonTotal], sc.non);
  });
  test(`every miscue appears in a focus area, on screen and in print: ${sec}`, () => {
    const r = run(keyed(sec, sc.marks));
    const seen = new Set(); r.buckets.forEach(b => b.areas.forEach(a => [...a.real, ...a.nonsense].forEach(e => seen.add(e.word))));
    assert.strictEqual(seen.size, r.score.errors);
    r.score.details.forEach(d => { assert(text(r.print).includes(d.word), 'screen ' + d.word); assert(text(r.print).includes(d.word), 'print ' + d.word); });
    const heads = h => [...text(h).matchAll(/(\d+) focus areas?(?: \((\d+) findings?\))?/g)].map(m => m[0]);
    assert.deepStrictEqual(heads(r.screen), heads(r.print));
  });
}

/* ------------------------------ Phase 1 ------------------------------ */
test('P1: real and nonsense evidence stay in separate lists; nonsense never raises strength', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S1}:zab`]: 'zeb' });
  const a = label(r, 'phonics_vowel');
  assert.strictEqual(a.real.length, 1); assert.strictEqual(a.nonsense.length, 1);
  assert(/Observed once/.test(text(r.print)) && !/Repeated/.test(text(r.print)));
});
test('P1: two real words repeat; cat/map/zab shows the specific focus and no family caution', () => {
  const r = run(keyed(S1, { cat:'cot', map:'mop', zab:'zeb' }));
  const t = text(r.print);
  assert(/Repeated possible focus: a spelling for short a \/ă\/ in a CVC word/.test(t));
  assert(/Supporting nonsense-word evidence: zab → zeb/.test(t));
  assert(!/Related spellings in this family/.test(t));
});
test('P1: nonsense-only evidence is never Repeated, even with two words', () => {
  const mk = w => ({ word:w, response:'x', type:'nonsense', focus:'F in a nonsense word', tag:'phonics_vowel', skipped:false, patternNote:null });
  const h = text(legacyPrint([mk('a'), mk('b')]));
  assert(!/Repeated/.test(h)); assert(/Supplemental nonsense-word evidence: F in a nonsense word/.test(h)); assert(!/Observed once/.test(h));
});
test('P1: grouped findings carry per-word notes, not the first word\'s note', () => {
  const mk = (word, note) => ({ word, response:'x', type:'real', focus:'F', tag:'phonics_vowel', skipped:false, patternNote:note });
  const t = text(legacyPrint([mk('aaa', 'first note'), mk('bbb', 'second note')]));
  assert(/aaa → x \(first note\), bbb → x \(second note\)/.test(t));
  const same = text(legacyPrint([mk('aaa', 'shared'), mk('bbb', 'shared')]));
  assert(same.split('shared').length === 2, 'identical notes appear once');
  // double misses keep each word\'s own "also differed" note
  const d = analyze(S2, 'spin', 'pan'); assert(d.findings.every(f => /also differed in this word/.test(f.patternNote)));
});

test('P1: heading shows focus areas first, with findings secondary, and "N words" otherwise', () => {
  const t = text(run(keyed(S1, SCRIPTS[S1].marks)).print);
  assert(/Vowel\/spelling patterns to review · 2 focus areas \(4 findings\)/.test(t));
  assert(/Skipped \/ no attempt · 1 word/.test(t)); assert(/Other miscues not tied to the target pattern · 2 words/.test(t));
});
test('P1: a skipped nonsense word is marked and listed under "Pattern tested"', () => {
  const t = text(run(keyed(S3, { phip:SKIP })).print);
  assert(/Pattern tested: ph spelling for \/f\/ · i spelling for short i \/ĭ\//.test(t)); assert(/phip \(skipped\) \(nonsense word\)/.test(t));
  assert(t.includes(NONSENSE_NOTE)); assert(!/Target pattern/.test(t));
});

/* ------------------------------ Phase 2 ------------------------------ */
test('P2: vowel nucleus ignores silent e, qu, and a typed schwa', () => {
  for(const [w, r] of [['badge', 'bad'], ['nudge', 'nud']]){ const f = analyze(S3, w, r).findings; assert.strictEqual(f.length, 1, w); assert(/final dge/.test(f[0].focus)); assert.strictEqual(f[0].patternNote, null); }
  assert(analyze(S2, 'quill', 'kwil').findings.every(f => !/short i/.test(f.focus)));
  const lamb = analyze(S7, 'lamb', 'lambuh'); assert.strictEqual(lamb.findings.length, 1); assert(/final mb/.test(lamb.findings[0].focus));
  assert.notStrictEqual(analyze(S1, 'cat', 'catuh').tag, 'phonics_vowel');
  assert.strictEqual(analyze(S1, 'cat', 'cate').tag, 'phonics_vowel');
});
test('P2: sound equivalence keeps the sound when only the spelling differs', () => {
  assert.strictEqual(analyze(S4, 'bird', 'burt').tag, 'other');
  assert.strictEqual(analyze(S5, 'leaf', 'leep').tag, 'other');
  assert.notStrictEqual(analyze(S5, 'rain', 'rane').tag, 'phonics_vowel');
  assert.notStrictEqual(analyze(S6, 'coin', 'coyn').tag, 'phonics_vowel');
  assert.strictEqual(analyze(S7, 'gem', 'jem').tag, 'other');
});
test('P2: genuine misses are still flagged', () => {
  for(const [s, w, r] of [[S4, 'bird', 'bard'], [S4, 'fern', 'farn'], [S5, 'feet', 'fet'], [S5, 'rain', 'ran'], [S6, 'coin', 'con'], [S6, 'moon', 'mon'], [S6, 'few', 'foo'], [S5, 'cake', 'cack'], [S5, 'bike', 'bik'], [S1, 'cat', 'cot']])
    assert.strictEqual(analyze(s, w, r).tag, 'phonics_vowel', `${w}→${r}`);
});
test('P2: soft g, final y, and a voiced silent b', () => {
  assert.strictEqual(analyze(S7, 'gem', 'jam').findings[0].tag, 'phonics_vowel');
  assert.strictEqual(analyze(S7, 'gem', 'jam').findings[0].patternNote, null);
  assert.strictEqual(analyze(S5, 'cry', 'cray').tag, 'phonics_vowel');
  assert.strictEqual(analyze(S5, 'cry', 'kry').tag, 'other');
  assert.notStrictEqual(analyze(S7, 'lamb', 'lam').tag, 'phonics_consonant');
});
test('P2: every missed target is reported as its own finding', () => {
  const a = analyze(S2, 'spin', 'pan');
  assert.strictEqual(a.findings.length, 2);
  assert.strictEqual(a.findings[0].focus, 'initial sp blend'); assert(/short i/.test(a.findings[1].focus));
  assert(a.findings.every(f => /also differed/.test(f.patternNote)));
  assert.strictEqual(analyze(S2, 'spin', 'span').findings.length, 1);
});

/* ------------------------------ Phase 3 ------------------------------ */
test('P3: ambiguous multi-sound spellings cannot be confirmed from letters (Teacher check)', () => {
  assert.strictEqual(analyze(S6, 'cook', 'kook').tag, 'teacher_check');
  assert.strictEqual(analyze(S6, 'cook', 'cooks').tag, 'teacher_check');
  assert.strictEqual(analyze(S6, 'moon', 'mon').tag, 'phonics_vowel');
  assert.strictEqual(analyze(S5, 'leaf', 'leep').tag, 'other');
});
test('P3: dialect-sensitive responses are cautious, clear misses are not', () => {
  const h = analyze(S6, 'hawk', 'hock'); assert.strictEqual(h.tag, 'teacher_check'); assert(/dialect/.test(h.patternNote));
  assert.strictEqual(analyze(S6, 'hawk', 'hack').tag, 'phonics_vowel');
  assert.strictEqual(analyze(S6, 'fault', 'folt').tag, 'teacher_check');
  assert.notStrictEqual(analyze(S3, 'whip', 'wip').tag, 'phonics_consonant');
  assert.strictEqual(analyze(S3, 'whip', 'hip').tag, 'phonics_consonant');
});
test('P3: multisyllabic errors are localized and error kinds stay apart', () => {
  assert.strictEqual(analyze(S8, 'inhale', 'inhal').focus, 'VCe syllable decoding · letters omitted');
  assert.strictEqual(analyze(S8, 'reptile', 'reptil').focus, 'VCe syllable decoding · letters omitted');
  assert.strictEqual(analyze(S8, 'catfish', 'catfis').focus, 'Closed syllable decoding · letters omitted');
  assert.strictEqual(analyze(S8, 'velvet', 'velfet').focus, 'Closed syllable decoding · letters changed');
  assert.strictEqual(analyze(S8, 'inhale', 'inhul').tag, 'multisyllabic');
  assert(/multisyllabic decoding$/.test(analyze(S8, 'catfish', 'dogcat').focus));
});
test('P3: unstressed vowel reduction is a Teacher check, not a finding', () => {
  for(const [w, r] of [['table', 'tabul'], ['report', 'ruhport'], ['velvet', 'velvit']]) assert.strictEqual(analyze(S8, w, r).tag, 'teacher_check', w);
  assert.strictEqual(analyze(S8, 'report', 'rport').tag, 'multisyllabic');
});
test('P3: inhale + reptile repeat (real); repnate only supports; velvet/catfish do not repeat', () => {
  const r = run(keyed(S8, SCRIPTS[S8].marks)); const t = text(r.print);
  assert(/Repeated possible focus: VCe syllable decoding · letters omitted/.test(t));
  assert(/Supporting nonsense-word evidence: repnate → repnat/.test(t));
  assert(/Observed once: Closed syllable decoding · letters omitted/.test(t));
  assert(!/Repeated possible focus: Closed/.test(t));
});
test('P3: skipped multisyllabic word names its pattern', () => {
  assert.strictEqual(api.analyzeError(find(S8, 'tornado'), '', true).focus, 'R-Controlled + Open + Open multisyllabic decoding');
});

/* ------------------------------ Phase 4: families ------------------------------ */
function familyCase(name, marks, tag, familyLabel, words, specifics, broad){
  test(`P4 family: ${name}`, () => {
    const r = run(marks); const b = bucket(r, tag);
    assert.strictEqual(b.areas.length, 1, 'one focus area'); const a = b.areas[0];
    assert.strictEqual(a.focus, familyLabel); assert(a.spansFamily);
    assert.deepStrictEqual(areaWords(a).sort(), words.slice().sort());
    const t = text(r.print);
    assert(t.includes(`${broad ? 'Possible broader pattern' : 'Repeated possible focus'} (pattern family): ${familyLabel}`), 'family status label');
    for(const [word, spelling, kind] of specifics) assert(t.includes(`${word} → ${marks[Object.keys(marks).find(k => k.endsWith(':' + word))]} (${spelling} · ${kind}`), `specifics for ${word}`);
    assert(t.includes(broad ? BROAD_CAUTION : FAMILY_CAUTION)); assert(broad ? !t.includes(FAMILY_CAUTION) : !t.includes(BROAD_CAUTION));
    assert.strictEqual(b.findings, words.length);
  });
}
familyCase('/er/ (fern, curl)', keyed(S4, { fern:'farn', curl:'carl' }), 'phonics_vowel', 'r-controlled /er/ (er, ir, ur)', ['fern', 'curl'],
  [['fern', 'er spelling for /er/', 'vowel changed'], ['curl', 'ur spelling for /er/', 'vowel changed']]);
familyCase('/oi/ (coin, toy)', keyed(S6, { coin:'con', toy:'tie' }), 'phonics_vowel', '/oi/ diphthong (oi, oy)', ['coin', 'toy'],
  [['coin', 'oi spelling for /oi/', 'letters omitted'], ['toy', 'oy spelling for /oi/', 'letters changed']]);
familyCase('final blends (milk, jump)', keyed(S2, { milk:'mil', jump:'jum' }), 'phonics_consonant', 'Final consonant blends (different clusters)', ['milk', 'jump'],
  [['milk', 'final lk blend', 'letters omitted'], ['jump', 'final mp blend', 'letters omitted']], true);
familyCase('silent e (cake, bike)', keyed(S5, { cake:'cack', bike:'bik' }), 'phonics_vowel', 'Silent-e (VCe) spelling convention across vowel sounds', ['cake', 'bike'],
  [['cake', 'a-consonant-e spelling for long a /ā/', 'letters changed'], ['bike', 'i-consonant-e spelling for long i /ī/', 'letters omitted']], true);

test('P4 family: nonsense words support a family finding but never raise it', () => {
  const one = run(keyed(S4, { fern:'farn', lerp:'larp', jirn:'jarn' }));
  assert(/Observed once/.test(text(one.print))); assert(!/Repeated/.test(text(one.print)));
  const two = run(keyed(S5, { cake:'cack', bike:'bik', zide:'zid' }));
  assert(/Supporting nonsense-word evidence: zide → zid/.test(text(two.print)));
  assert.strictEqual(label(two, 'phonics_vowel').real.length, 2);
  const lone = run(keyed(S6, { coin:'con', noit:'nit' }));
  assert(/Observed once/.test(text(lone.print)) && !/Repeated/.test(text(lone.print)));
});
test('P4 family: one real word in a family is Observed once with its own spelling, no family caution', () => {
  const r = run(keyed(S4, { fern:'farn' })); const t = text(r.print);
  assert(/Observed once: er spelling for \/er\//.test(t)); assert(!t.includes(FAMILY_CAUTION));
});
test('P4 family: skipped words do not count toward a family repeat', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:surf`]: SKIP });
  const a = label(r, 'phonics_vowel'); assert.strictEqual(areaWords(a).length, 1);
  assert(/Observed once/.test(text(r.print))); assert(!/Repeated/.test(text(r.print)));
  assert(bucket(r, 'skipped')); assert(/surf \(skipped\)/.test(text(r.print)));
});
test('P4 family: Teacher check findings do not count toward a family repeat', () => {
  const r = run({ [`${S6}:hawk`]: 'hock', [`${S6}:fault`]: 'fat' });
  const a = label(r, 'phonics_vowel'); assert.strictEqual(areaWords(a).join(), 'fault');
  assert(/Observed once/.test(text(r.print))); assert(!/Repeated/.test(text(r.print)));
  assert.strictEqual(label(r, 'teacher_check').real[0].word, 'hawk');
  const r2 = run({ [`${S6}:cook`]: 'kook', [`${S4}:bird`]: 'burt', [`${S4}:fern`]: 'farn' });
  assert(!/Repeated/.test(text(r2.print)));
});
test('P4 family: unrelated or merely similar spellings are not merged', () => {
  const rIn = run(keyed(S2, { spin:'pin', plug:'pug' }));              // initial s-blend vs initial l-blend
  assert.strictEqual(bucket(rIn, 'phonics_consonant').areas.length, 2);
  const rEw = run(keyed(S6, { few:'foo', grew:'grow' }));                 // same letters, different sounds
  assert.strictEqual(bucket(rEw, 'phonics_vowel').areas.length, 2); assert(!/Repeated/.test(text(rEw.print)));
  const rAr = run(keyed(S4, { card:'cord', fern:'farn' }));               // ar is not in the /er/ family
  assert.strictEqual(bucket(rAr, 'phonics_vowel').areas.length, 2);
  const rFin = run({ [`${S3}:notch`]: 'not', [`${S3}:badge`]: 'bad' });   // -tch and -dge stay separate
  assert.strictEqual(bucket(rFin, 'phonics_consonant').areas.length, 2);
});
test('P4 family: same-spelling repeats keep their specific focus (no family relabeling)', () => {
  const r = run(keyed(S3, { badge:'bad', nudge:'nud' }));
  const a = label(r, 'phonics_consonant'); assert(!a.spansFamily);
  assert(/Repeated possible focus: final dge spelling for \/j\/ after a short vowel/.test(text(r.print)));
});
test('P4 family: heading counts follow focus areas and findings', () => {
  const t = text(run(keyed(S4, { fern:'farn', curl:'carl' })).print);
  assert(/Vowel\/spelling patterns to review · 1 focus area \(2 findings\)/.test(t));
});
test('P4 family: print report carries the same family content as the screen', () => {
  const r = run(keyed(S6, { coin:'con', toy:'tie', noit:'nit' }));
  const p = text(r.print);
  assert(p.includes('Repeated possible focus (pattern family): /oi/ diphthong (oi, oy)'));
  assert(p.includes('coin → con (oi spelling for /oi/ · letters omitted)')); assert(p.includes('toy → tie (oy spelling for /oy/'.replace('/oy/', '/oi/') + ' · letters changed)'));
  assert(p.includes('Supporting nonsense-word evidence: noit → nit'));
});


/* -------- Phase 4 corrections: same correspondence vs different correspondences in a family -------- */
const MULTI_CORR_LABEL_RE = /related spellings in the same family/i;
function sameCorrCase(name, marks, tag, corrLabel, words, specifics){
  test(`P4 same correspondence: ${name}`, () => {
    const r = run(marks); const b = bucket(r, tag);
    assert.strictEqual(b.areas.length, 1, 'one focus area'); const a = b.areas[0];
    assert.strictEqual(a.focus, `${corrLabel} (across positions or contexts)`);
    assert(!a.spansFamily, 'not framed as a family');
    assert.strictEqual(new Set(a.real.map(e => e.corr)).size, 1); assert(a.real.every(e => e.corr));
    assert.deepStrictEqual(areaWords(a).sort(), words.slice().sort());
    const t = text(r.print), p = text(r.print);
    assert(t.includes(`Repeated possible focus: ${corrLabel} (across positions or contexts)`), 'repeated label (print)');
    assert(p.includes(`Repeated possible focus: ${corrLabel} (across positions or contexts)`), 'repeated label (print)');
    assert(!MULTI_CORR_LABEL_RE.test(t) && !MULTI_CORR_LABEL_RE.test(p), 'no family caution');
    for(const [word, resp, spelling, kind] of specifics){ assert(t.includes(`${word} → ${resp} (${spelling} · ${kind}`), `screen specifics ${word}`); assert(p.includes(`${word} → ${resp} (${spelling} · ${kind}`), `print specifics ${word}`); }
    assert.strictEqual(b.findings, words.length);
  });
}
sameCorrCase('sh in initial and final position (shed, dish)', keyed(S3, { shed:'sed', dish:'did' }), 'phonics_consonant', 'sh spelling for /sh/', ['shed', 'dish'],
  [['shed', 'sed', 'sh spelling for /sh/', 'letters omitted'], ['dish', 'did', 'final sh spelling for /sh/', 'letters changed']]);
sameCorrCase('ch in initial and final position (chat, such)', keyed(S3, { chat:'cat', such:'sut' }), 'phonics_consonant', 'ch spelling for /ch/', ['chat', 'such'],
  [['chat', 'cat', 'ch spelling for /ch/', 'letters omitted'], ['such', 'sut', 'final ch spelling for /ch/', 'letters changed']]);
sameCorrCase('th in initial and final position (thud, bath)', keyed(S3, { thud:'tud', bath:'bat' }), 'phonics_consonant', 'th spelling for /th/', ['thud', 'bath'],
  [['thud', 'tud', 'th spelling for /th/', 'letters omitted'], ['bath', 'bat', 'final th spelling for /th/', 'letters omitted']]);
sameCorrCase('short a across Sections 1, 2 and 3 (cat, grab, chat)', { [`${S1}:cat`]: 'cot', [`${S2}:grab`]: 'grub', [`${S3}:chat`]: 'chit' }, 'phonics_vowel', 'a spelling for short a /ă/', ['cat', 'chat', 'grab'],
  [['cat', 'cot', 'a spelling for short a /ă/ in a CVC word', 'vowel changed'], ['grab', 'grub', 'a spelling for short a /ă/', 'vowel changed'], ['chat', 'chit', 'a spelling for short a /ă/', 'vowel changed']]);
sameCorrCase('short e across Sections 1 and 2 (bed, sled)', { [`${S1}:bed`]: 'bid', [`${S2}:sled`]: 'slid' }, 'phonics_vowel', 'e spelling for short e /ĕ/', ['bed', 'sled'],
  [['bed', 'bid', 'e spelling for short e /ĕ/ in a CVC word', 'vowel changed'], ['sled', 'slid', 'e spelling for short e /ĕ/', 'vowel changed']]);
test('P4 same correspondence: nonsense words still only support (zab with cat across sections)', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S2}:grab`]: 'grub', [`${S1}:zab`]: 'zeb' }); const t = text(r.print);
  assert(/Repeated possible focus: a spelling for short a \/ă\/ \(across positions or contexts\)/.test(t));
  assert(/Supporting nonsense-word evidence: zab → zeb/.test(t)); assert(!MULTI_CORR_LABEL_RE.test(t));
  const one = run({ [`${S1}:cat`]: 'cot', [`${S1}:zab`]: 'zeb' }); assert(!/Repeated/.test(text(one.print)));
});
test('P4 same correspondence: skipped and Teacher check words do not make a correspondence repeat', () => {
  const r = run({ [`${S3}:shed`]: 'sed', [`${S3}:dish`]: SKIP });
  assert(/Observed once: sh spelling for \/sh\//.test(text(r.print))); assert(!/Repeated/.test(text(r.print)));
  const r2 = run({ [`${S6}:hawk`]: 'hock', [`${S6}:fault`]: 'fat' }); assert(!/Repeated/.test(text(r2.print)));
});
test('P4 same correspondence: the same grapheme for different sounds is never one correspondence', () => {
  const pairs = [[S6, 'few', 'foo', S6, 'grew', 'grow'],      // ew /ū/ vs ew /ōō/
                 [S6, 'moon', 'mon', S6, 'cook', 'cuk'],      // oo /ōō/ vs oo /oo/
                 [S5, 'low', 'lo', S6, 'down', 'dun'],        // ow /ō/ vs ow /ow/
                 [S5, 'leaf', 'lef', S7, 'bread', 'brad']];   // ea /ē/ vs ea /ĕ/
  for(const [s1, w1, r1, s2, w2, r2] of pairs){
    const r = run({ [`${s1}:${w1}`]: r1, [`${s2}:${w2}`]: r2 });
    const areas = bucket(r, 'phonics_vowel').areas;
    assert.strictEqual(areas.length, 2, `${w1}/${w2} stay separate`); assert(!/Repeated/.test(text(r.print)), `${w1}/${w2} not repeated`);
  }
});
test('P4 family: different correspondences within a family use family framing and the caution; same-corr repeats inside it stay visible', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:curl`]: 'carl', [`${S4}:term`]: 'tarm' });
  const a = bucket(r, 'phonics_vowel').areas; assert.strictEqual(a.length, 1);
  assert(a[0].spansFamily); assert.strictEqual(a[0].focus, 'r-controlled /er/ (er, ir, ur)');
  assert.strictEqual(new Set(a[0].real.map(e => e.corr)).size, 2);
  const t = text(r.print);
  assert(/Repeated possible focus \(pattern family\): r-controlled \/er\/ \(er, ir, ur\)/.test(t)); assert(t.includes(FAMILY_CAUTION));
  for(const w of ['fern → farn (er spelling for /er/', 'term → tarm (er spelling for /er/', 'curl → carl (ur spelling for /er/']) assert(t.includes(w), w);
});
test('P4 family: one real word per correspondence is still a family repeat only with two correspondences and two words', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:term`]: 'tarm' });   // same correspondence (er) twice, same focus text
  const a = bucket(r, 'phonics_vowel').areas[0]; assert(!a.spansFamily);
  assert(/Repeated possible focus: er spelling for \/er\//.test(text(r.print))); assert(!text(r.print).includes(FAMILY_CAUTION));
});

/* ------------------------------ Phase 4 corrections: layout ------------------------------ */
test('P4 layout (print): the family explanation is its own paragraph, not appended to a word list', () => {
  const r = run(keyed(S6, { coin:'con', toy:'tie', noit:'nit' }));
  assert(r.print.includes(`<p>${FAMILY_CAUTION}</p>`), 'family note in its own paragraph');
  assert(!text(r.print).includes(` · ${FAMILY_CAUTION}`), 'no separator before the note');
  const rs = run(keyed(S3, { shed:'sed', dish:'did' })); assert(!MULTI_CORR_LABEL_RE.test(rs.print));
});
/* ------------------------------ Stage A: wording and clarity ------------------------------ */
const ALL_SCRIPT_MARKS = Object.entries(SCRIPTS).map(([sec, sc]) => keyed(sec, sc.marks));
test('A: nonsense-only evidence is labelled "Supplemental nonsense-word evidence"; real words keep Observed once / Repeated', () => {
  const t = text(run(keyed(S4, { varm:'vorm' })).print);
  assert(/Supplemental nonsense-word evidence: ar spelling for \/ar\/ in a nonsense word/.test(t)); assert(!/Observed once/.test(t));
  assert(/Observed once: ar spelling for \/ar\//.test(text(run(keyed(S4, { card:'cord' })).print)));
  assert(/Repeated possible focus: ar spelling for \/ar\//.test(text(run(keyed(S4, { card:'cord', bark:'bork' })).print)));
});
test('A: nonsense and family explanations appear once per category, never per focus area', () => {
  const r = run(keyed(S5, { cake:'cack', bike:'bik', zide:'zid', soat:'sot', pabe:'pab', rain:'ran', feet:'fet' }));
  const t = text(r.screen), p = text(r.print), count = (h, k) => h.split(k).length - 1;
  const b = bucket(r, 'phonics_vowel'); assert(b.areas.length >= 4);
  assert.strictEqual(count(t, NONSENSE_NOTE), 1); assert.strictEqual(count(p, NONSENSE_NOTE), 1);
  const rf = run({ ...keyed(S6, { coin:'con', toy:'tie' }), ...keyed(S4, { fern:'farn', curl:'carl' }) });
  assert.strictEqual(count(text(rf.print), FAMILY_CAUTION), 1); assert.strictEqual(count(text(rf.print), FAMILY_CAUTION), 1);
  assert(!/Supplemental transfer evidence/.test(t));
});
test('A: no explanations appear when they do not apply', () => {
  const t = text(run(keyed(S1, { cat:'cot', map:'mop' })).print);
  assert(!t.includes(NONSENSE_NOTE)); assert(!MULTI_CORR_LABEL_RE.test(t));
  const t2 = text(run(keyed(S3, { shed:'sed', dish:'did' })).print); assert(!MULTI_CORR_LABEL_RE.test(t2));
});
test('A: family areas carry a concise marker; correspondence-level repeats do not', () => {
  assert(/Possible broader pattern \(pattern family\): Final consonant blends \(different clusters\)/.test(text(run(keyed(S2, { milk:'mil', jump:'jum' })).print)));
  assert(/Repeated possible focus \(pattern family\): r-controlled \/er\/ \(er, ir, ur\)/.test(text(run(keyed(S4, { fern:'farn', curl:'carl' })).print)));
  const t = text(run(keyed(S3, { shed:'sed', dish:'did' })).print);
  assert(/Repeated possible focus: sh spelling for \/sh\/ \(across positions or contexts\)/.test(t)); assert(!/pattern family/i.test(t));
});
test('A: skipped words use "Pattern tested"; Teacher check and Skipped stay separate categories', () => {
  const r = run({ [`${S6}:cook`]: 'kook', [`${S6}:fault`]: SKIP }); const t = text(r.print);
  assert(/Skipped \/ no attempt · 1 word/.test(t)); assert(/Pattern tested: au spelling for \/aw\//.test(t));
  assert(/Teacher check: target sound can't be confirmed · 1 word/.test(t)); assert(/Pattern to check: oo spelling for \/oo\/ as in cook/.test(t));
  assert(!/Target pattern/.test(t));
});
test('A: heading counts: focus areas are primary, findings appear only when they differ', () => {
  const same = text(run(keyed(S1, { bed:'bid' })).print); assert(/Vowel\/spelling patterns to review · 1 focus area(?! \()/.test(same));
  const diff = text(run(keyed(S4, { fern:'farn', curl:'carl' })).print); assert(/Vowel\/spelling patterns to review · 1 focus area \(2 findings\)/.test(diff));
  assert(!/focus areas? · \d+ finding/.test(same + diff));
});
test('A: no statement claims a pattern was retained, preserved or produced correctly', () => {
  for(const marks of ALL_SCRIPT_MARKS){
    const r = run(marks);
    for(const h of [text(r.print), text(r.print)]){
      assert(!/preserved/i.test(h), 'mentions preserved'); assert(!/as expected in (the typed )?response/i.test(h), 'as expected in response');
      assert(!/was read as expected|read correctly|produced correctly|pronounced correctly/i.test(h));
    }
  }
  // retained letters generate no per-word note at all
  for(const [s, w, r] of [[S2, 'spin', 'span'], [S7, 'gem', 'gam'], [S3, 'chat', 'chit'], [S3, 'badge', 'bad'], [S2, 'milk', 'mil']])
    assert.strictEqual(analyze(s, w, r).findings[0].patternNote, null, `${w} → ${r}`);
});
test('A: gem → gam reports only the actual error (the vowel) and makes no claim about the soft g', () => {
  const a = analyze(S7, 'gem', 'gam');
  assert.strictEqual(a.findings.length, 1); assert.strictEqual(a.findings[0].tag, 'phonics_vowel');
  assert.strictEqual(a.findings[0].focus, 'e spelling for short e /ĕ/'); assert.strictEqual(a.findings[0].errorKind, 'vowel changed');
  const r = run({ [`${S7}:gem`]: 'gam' });
  for(const h of [text(r.print), text(r.print)]){
    assert(h.includes('gem → gam (e spelling for short e /ĕ/ in a CVC word'.replace(' in a CVC word', '')) || h.includes('gem → gam'), 'word evidence');
    assert(/e spelling for short e \/ĕ\//.test(h)); assert(!/soft g/i.test(h), 'no soft g claim');
  }
  // the assessed soft g target is still reported as a skipped target and when it is actually missed
  assert(/soft g spelling for \/j\/ before e/.test(text(run({ [`${S7}:gem`]: SKIP }).print)));
  assert.strictEqual(analyze(S7, 'gem', 'em').findings[0].focus, 'soft g spelling for /j/ before e');
});
test('A: the Other and Ending categories describe the difference without vouching for the pattern', () => {
  const r = run({ [`${S5}:rope`]: 'robe', [`${S1}:cup`]: 'cu' }); const t = text(r.print);
  assert(/Other miscues not tied to the target pattern · 1 word/.test(t)); assert(/rope → robe/.test(t));
  assert(/Ending or word-level miscues \(target pattern not the apparent source\) · 1 word/.test(t)); assert(/cup → cuThe ending was omitted or shortened/.test(t));
  assert(/The typed response cannot confirm how the student pronounced the pattern/.test(t));
});
test('A: all miscue evidence is still listed (nothing dropped by the wording changes)', () => {
  for(const marks of ALL_SCRIPT_MARKS){
    const r = run(marks); const t = text(r.screen), p = text(r.print);
    r.score.details.forEach(d => { assert(t.includes(d.word), 'screen ' + d.word); assert(p.includes(d.word), 'print ' + d.word); });
  }
});

/* ------------------------------ Phase 4: short vowels across Sections 1-3 ------------------------------ */
test('P4 short vowels: different short vowels stay separate; nonsense words support', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S1}:bed`]: 'bid', [`${S1}:zab`]: 'zeb' });
  const areas = bucket(r, 'phonics_vowel').areas; assert.strictEqual(areas.length, 2);
  assert(/Observed once: e spelling for short e/.test(text(r.print)));
  assert(/Observed once: a spelling for short a/.test(text(r.print)) && !/Repeated/.test(text(r.print)));
});
test('P4 short vowels: a long-vowel target is not in a short-vowel family', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S7}:ghost`]: 'gust' });
  assert.strictEqual(bucket(r, 'phonics_vowel').areas.length, 2);
});


/* ------------------------------ Stage B: on-screen layout ------------------------------ */
const crypto = require('crypto');
const blocks = h => h.split('<div class="fa ').slice(1);
const cls = b => b.slice(0, b.indexOf('"'));
const MIXED = { ...keyed(S2, { milk:'mil', jump:'jum', vust:'vus', plug:'pug', glep:'gep', pond:'pand', stog:'steg', split:'slit', strap:'trap', quill:SKIP }), ...keyed(S3, { shed:'sed', dish:'did', notch:'not', datch:'dat' }), ...keyed(S6, { cook:'kook', hawk:'hock', fault:SKIP, coin:'con', toy:'tie', noit:'nit' }), [`${S1}:cat`]: 'cot', [`${S1}:map`]: 'mop', [`${S1}:zab`]: 'zeb', [`${S4}:varm`]: 'vorm' };
test('B: focus areas are blocks, not pills', () => {
  const r = run(MIXED); assert(!r.screen.includes('pattern-chip')); assert(blocks(r.screen).length >= 10);
  const css = html.slice(html.indexOf('/* Stage B:'));
  assert(/\.fa\{[^}]*border-radius:10px/.test(css)); assert(!/999px/.test(css));
});
test('B: each focus area follows the hierarchy status → correspondence/family → words → supporting evidence', () => {
  const r = run(MIXED);
  for(const b of blocks(r.screen)){
    if(cls(b).startsWith('fa-plain')) continue;
    const pos = k => b.indexOf(k);
    assert(pos('class="fa-head"') >= 0 && pos('class="fa-head"') < pos('class="fa-title"'), 'status before title');
    assert(pos('class="fa-title"') < pos('class="fa-list"'), 'title before words');
    if(b.includes('class="fa-support"')) assert(pos('class="fa-list"') < pos('class="fa-support"'), 'words before supporting evidence');
    assert(/class="fa-status">(Repeated possible focus|Possible broader pattern|Observed once|Supplemental nonsense-word evidence|Pattern to check|Pattern tested)</.test(b), 'status text: ' + b.slice(0, 120));
  }
});
test('B: pattern-family, same-correspondence and single findings are visually distinct', () => {
  const fam = blocks(run(keyed(S2, { milk:'mil', jump:'jum' })).screen)[0];
  assert(/^fa-broad fa-family"/.test(fam)); assert(fam.includes('<span class="fa-tag">Pattern family</span>')); assert(fam.includes('class="fa-title">Final consonant blends (different clusters)<'));
  const er = blocks(run(keyed(S4, { fern:'farn', curl:'carl' })).screen)[0];
  assert(/^fa-repeated fa-family"/.test(er));
  const same = blocks(run(keyed(S3, { shed:'sed', dish:'did' })).screen)[0];
  assert(/^fa-repeated fa-single"/.test(same)); assert(same.includes('<span class="fa-tag">Across words</span>')); assert(!same.includes('Pattern family'));
  const once = blocks(run(keyed(S4, { card:'cord' })).screen)[0];
  assert(/^fa-once fa-single"/.test(once)); assert(!once.includes('class="fa-tag"'));
  const css = html.slice(html.indexOf('/* Stage B:'));
  assert(/\.fa-family\{[^}]*border-left-color/.test(css));   // family blocks carry their own accent, not just a caution line
});
test('B: each word is on its own line; the correspondence is shown once, not repeated per word', () => {
  const r = run(keyed(S1, { cat:'cot', map:'mop' })); const b = blocks(r.screen)[0];
  assert.strictEqual((b.match(/<li class="fa-row">/g) || []).length, 2);
  assert.strictEqual(b.split('a spelling for short a /ă/ in a CVC word').length - 1, 1, 'focus text appears once');
  assert(b.includes('<span class="fa-word">cat → cot</span><span class="fa-detail">vowel changed</span>'));
  const fam = blocks(run(keyed(S4, { fern:'farn', curl:'carl' })).screen)[0];
  assert(fam.includes('<span class="fa-word">fern → farn</span><span class="fa-detail">er spelling for /er/ · vowel changed</span>'));
  assert(fam.includes('<span class="fa-word">curl → carl</span><span class="fa-detail">ur spelling for /er/ · vowel changed</span>'));
});
test('B: supporting nonsense-word evidence sits in its own block below the real-word rows', () => {
  const b = blocks(run(keyed(S2, { milk:'mil', jump:'jum', vust:'vus' })).screen)[0];
  assert(/<div class="fa-support"><div class="fa-support-label">Supporting nonsense-word evidence:<\/div>/.test(b)); assert(b.indexOf('milk → mil') < b.indexOf('vust → vus'));
  const only = blocks(run(keyed(S4, { varm:'vorm' })).screen)[0];
  assert(/^fa-supplemental/.test(only)); assert(only.includes('>Supplemental nonsense-word evidence<')); assert(!only.includes('fa-support"'));
});
test('B: category heading counts are secondary text inside the heading', () => {
  const r = run(MIXED); const h = [...r.screen.matchAll(/<h4>(.*?)<\/h4>/g)].map(m => m[1]);
  assert(h.length >= 4);
  for(const x of h) assert(/^[^<]+<span class="fa-count"> · [^<]+<\/span>$/.test(x), x);
  assert(h.some(x => /Vowel\/spelling patterns to review<span class="fa-count"> · \d+ focus areas?( \(\d+ findings\))?<\/span>/.test(x)));
  assert(/\.fa-count\{[^}]*font-weight:600/.test(html));
});
test('B: Teacher check and Skipped stay visible, with their labels and word rows', () => {
  const t = text(run(MIXED).screen);
  assert(/Teacher check: target sound can't be confirmed · 2 words/.test(t)); assert(/Pattern to check/.test(t)); assert(/cook → kook/.test(t)); assert(/hawk → hock/.test(t));
  assert(/Skipped \/ no attempt · 2 words/.test(t)); assert(/Pattern tested/.test(t)); assert(/quill \(skipped\)/.test(t)); assert(/fault \(skipped\)/.test(t));
});
test('B: Stage A wording, shared explanations and every word are all still on screen', () => {
  const r = run(MIXED); const t = text(r.screen);
  for(const w of ['Repeated possible focus', 'Observed once', 'Supplemental nonsense-word evidence', 'Pattern family', 'Supporting nonsense-word evidence:', NONSENSE_NOTE, FAMILY_CAUTION, 'The typed response keeps the target letters', 'No spoken response was recorded'])
    assert(t.includes(w), w);
  r.score.details.forEach(d => assert(t.includes(d.word), d.word));
  assert(!/preserved|as expected in (the typed )?response/.test(t));
});
test('B: the real/nonsense and miscue cards use the full width so the miscue list creates no empty column', () => {
  assert(/<section class="results-card full-span">\s*<h3>Real vs Nonsense Words<\/h3>/.test(html));
  assert(/<section class="results-card full-span">\s*<h3>Words with Miscues<\/h3>/.test(html));
  assert(/#realNonsenseMetrics\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/.test(html));
});
test('B: section score rows can shrink and stack the band on very narrow screens (no horizontal overflow)', () => {
  assert(/\.sec-result-row\{grid-template-columns:minmax\(0,1fr\) auto auto\}/.test(html));
  assert(/@media\(max-width:360px\)\{\s*\.sec-result-row\{grid-template-columns:minmax\(0,1fr\) auto\}\s*\.sec-result-row \.band-pill\{grid-column:1\/-1/.test(html));
});
const PRINT_GOLDEN = {   // sha1 prefixes of the sentence-form focus data for the eight scripted students (unchanged since the accuracy correction)
  [S1]: '34dcc0f26634', [S2]: '3742f980a14c', [S3]: 'a04e1ae8c08d', [S4]: 'd938468774d9',
  [S5]: '4ce9d7ca4a9d', [S6]: 'fedfdef38b86', [S7]: '58c94c46e8a4', [S8]: 'c31dfd9ff136'
};
const SCREEN_GOLDEN = {  // sha1 prefixes of the on-screen focus-area HTML (as at the accuracy correction, with the "Across words" tag wording): print work must not change it
  [S1]: '3beee2e3fae9', [S2]: '5959697c9b93', [S3]: 'e2d19ad44a55', [S4]: 'c8bfae590602',
  [S5]: 'aa6be655eb56', [S6]: '89f4dfb832da', [S7]: 'da6b7087ceca', [S8]: '8006c9650470'
};
test('B: focus-area data (sentence form) stays stable (golden hashes; change only for intentional wording changes)', () => {
  const sig = (sec, k) => crypto.createHash('sha1').update(run(keyed(sec, SCRIPTS[sec].marks))[k]).digest('hex').slice(0, 12);
  for(const sec of Object.keys(PRINT_GOLDEN)) assert.strictEqual(sig(sec, 'print'), PRINT_GOLDEN[sec], `focus-area data changed for ${sec} (update PRINT_GOLDEN only for an intentional change)`);
});

/* ------------------------------ Analyzer accuracy correction (A: multisyllabic r-controlled, B: broad families, E: r + final e) ------------------------------ */
const S9 = 'multisyllabic-words';
const rcAreas = r => bucket(r, 'multisyllabic').areas.map(a => ({ focus: a.focus, words: areaWords(a).sort(), label: api.areaLabel('multisyllabic', a) }));
test('AC-A: stressed r-controlled syllables keep /ar/ and /or/ apart (barber bar vs report port)', () => {
  const r = run(keyed(S9, { barber:'borber', report:'repurt' }));
  const areas = rcAreas(r);
  assert.strictEqual(areas.length, 2, 'two separate areas');
  assert(areas.some(a => a.focus === 'R-controlled syllable decoding (/ar/) · vowel changed' && a.words.join() === 'barber'));
  assert(areas.some(a => a.focus === 'R-controlled syllable decoding (/or/) · vowel changed' && a.words.join() === 'report'));
  assert(areas.every(a => a.label === 'Observed once'), 'no repeated focus from two different sounds');
  const t = text(r.print); assert(!/Repeated possible focus/.test(t));
});
test('AC-A: the broader r-controlled syllable category is preserved in each area', () => {
  const t = text(run(keyed(S9, { barber:'borber', report:'repurt' })).print);
  assert(/Observed once: R-controlled syllable decoding \(\/ar\/\) · vowel changed/.test(t)); assert(/Observed once: R-controlled syllable decoding \(\/or\/\) · vowel changed/.test(t));
  assert(/Multisyllabic/i.test(t));
});
test('AC-A: unstressed r-controlled syllables (beaver ver, tornado tor, barber ber) stay Teacher check, never evidence', () => {
  const r = run(keyed(S9, { beaver:'beavur', tornado:'tarnado', barber:'barbar' }));
  assert.strictEqual(bucket(r, 'multisyllabic'), undefined);
  const tc = bucket(r, 'teacher_check'); assert(tc); assert.strictEqual(tc.areas.length, 1);
  assert(!/Repeated possible focus/.test(text(r.print)));
});
test('AC-A: an unlocalized multisyllabic response gets no vowel-sound label', () => {
  const r = run(keyed(S9, { barber:'zzzz', report:'repurt' }));
  const areas = rcAreas(r);
  assert(areas.some(a => a.focus === 'R-Controlled + R-Controlled multisyllabic decoding' && !/\(\//.test(a.focus)));
  assert(areas.some(a => a.focus === 'R-controlled syllable decoding (/or/) · vowel changed'));
  assert.strictEqual(areas.length, 2);
});
test('AC-A: a stressed r-controlled syllable with a different error kind stays a separate area', () => {
  const r = run(keyed(S9, { barber:'bber', report:'repurt' }));
  assert(!/Repeated/.test(text(r.print)));
});
test('AC-A: single-word r-controlled evidence is not merged with the multisyllabic r-controlled syllable evidence', () => {
  const r = run({ ...keyed(S4, { card:'cord' }), ...keyed(S9, { barber:'borber' }) });
  assert.strictEqual(bucket(r, 'phonics_vowel').areas.length, 1); assert.strictEqual(bucket(r, 'multisyllabic').areas.length, 1);
  assert(!/Repeated/.test(text(r.print)));
});
test('AC-A: /ar/, /or/ and /er/ single-word evidence still never combine (mixed-phoneme regression)', () => {
  const r = run(keyed(S4, { card:'cord', fork:'fark', term:'tarm', bark:'burk', born:'barn' }));
  const areas = bucket(r, 'phonics_vowel').areas;
  assert.strictEqual(areas.length, 3);
  const byFocus = f => areas.find(a => a.focus === f);
  assert.deepStrictEqual(areaWords(byFocus('ar spelling for /ar/')).sort(), ['bark', 'card']);
  assert.deepStrictEqual(areaWords(byFocus('or spelling for /or/')).sort(), ['born', 'fork']);
  assert.deepStrictEqual(areaWords(byFocus('er spelling for /er/')), ['term']);
  assert.strictEqual(api.areaLabel('phonics_vowel', byFocus('er spelling for /er/')), 'Observed once');
});

const bpieces = (r, tag, i = 0) => { const b = bucket(r, tag); return api.areaPieces(b, b.areas[i]); };
test('AC-B: a silent-e family spanning vowel sounds is a broader pattern, not a repeated single correspondence', () => {
  const r = run(keyed(S5, { cake:'cak', bike:'bik' })); const p = bpieces(r, 'phonics_vowel');
  assert.strictEqual(p.label, 'Possible broader pattern (pattern family)');
  assert.strictEqual(p.focus, 'Silent-e (VCe) spelling convention across vowel sounds');
  const t = text(r.print); assert(!/Repeated possible focus/.test(t)); assert(t.includes(BROAD_CAUTION));
});
test('AC-B: vowel-specific evidence is preserved, including the two sounds of u_e', () => {
  const r = run({ ...keyed(S5, { cute:'cut', cake:'cak' }), ...keyed(S6, { prune:'prun' }) }); const a = bucket(r, 'phonics_vowel').areas[0];
  assert.deepStrictEqual([...a.byCorr.map(c => c.corr)].sort(), ['a_e|/ā/', 'u_e|/ōō/', 'u_e|/ū/']);
  assert(a.byCorr.every(c => c.words.length === 1));
  const p = bpieces(r, 'phonics_vowel');
  assert(/u-consonant-e spelling for \/ū\/: cute \(1 word\)/.test(p.breakdown)); assert(/u-consonant-e spelling for \/ōō\/: prune \(1 word\)/.test(p.breakdown));
  assert(!/repeated/.test(p.breakdown));
});
test('AC-B: the broader-pattern status needs two distinct real words with different correspondences', () => {
  const lab = marks => { const r = run(marks); const b = bucket(r, 'phonics_vowel'); return b ? api.areaLabel('phonics_vowel', b.areas[0]) : null; };
  assert.strictEqual(lab(keyed(S5, { cake:'cak' })), 'Observed once');                                   // one real word
  assert.strictEqual(lab(keyed(S5, { cake:'cak', zide:'zid', pabe:'pab' })), 'Observed once');           // nonsense words only support
  assert.strictEqual(lab({ ...keyed(S5, { cake:'cak' }), [`${S5}:bike`]: SKIP }), 'Observed once');      // skipped words never count
  assert.strictEqual(lab(keyed(S5, { cake:'cak', bike:'bik' })), 'Possible broader pattern (pattern family)');
  assert.strictEqual(lab(keyed(S5, { cute:'cut', cube:'cub' })), 'Repeated possible focus');            // one correspondence twice, not a broad pattern
  const blends = marks => { const b = bucket(run(keyed(S2, marks)), 'phonics_consonant'); return api.areaLabel('phonics_consonant', b.areas[0]); };
  assert.strictEqual(blends({ milk:'mik' }), 'Observed once'); assert.strictEqual(blends({ milk:'mik', vust:'vus' }), 'Observed once');
  assert.strictEqual(blends({ milk:'mik', jump:'jup' }), 'Possible broader pattern (pattern family)');
});
test('AC-B: u_e /ū/ and u_e /ōō/ keep separate identities and separate distinct-word counts', () => {
  const r = run({ ...keyed(S5, { cute:'cut', cube:'cub' }), ...keyed(S6, { prune:'prun' }) }); const a = bucket(r, 'phonics_vowel').areas[0];
  const byC = Object.fromEntries(a.byCorr.map(c => [c.corr, [...c.words].sort().join()]));
  assert.deepStrictEqual(byC, { 'u_e|/ū/': 'cube,cute', 'u_e|/ōō/': 'prune' });
  const bd = api.areaPieces(bucket(r, 'phonics_vowel'), a).breakdown;
  assert(/u-consonant-e spelling for \/ū\/: cute, cube \(2 words, repeated\)/.test(bd)); assert(/u-consonant-e spelling for \/ōō\/: prune \(1 word\)/.test(bd));
  assert(!/\(3 words/.test(bd), 'no combined u_e count');
});
test('AC-B: one vowel correspondence repeated inside a broad family is identified as repeated', () => {
  const r = run(keyed(S5, { cute:'cut', cube:'cub', cake:'cak' })); const p = bpieces(r, 'phonics_vowel');
  assert.strictEqual(p.label, 'Possible broader pattern (pattern family)');
  assert(/u-consonant-e spelling for \/ū\/: cute, cube \(2 words, repeated\)/.test(p.breakdown));
  assert(/a-consonant-e spelling for \/ā\/: cake \(1 word\)/.test(p.breakdown));
});
test('AC-B: the same silent-e correspondence missed in two words is still a correspondence-level repeat (no family framing)', () => {
  const r = run({ ...keyed(S5, { rope:'rop' }), ...keyed(S7, { phone:'fon' }) }); const p = bpieces(r, 'phonics_vowel');
  assert.strictEqual(p.label, 'Repeated possible focus'); assert(!p.breakdown);
  assert(!text(r.print).includes(BROAD_CAUTION));
});
test('AC-B: one silent-e word is Observed once and carries no broad-family caution', () => {
  const r = run(keyed(S5, { cake:'cak' })); assert.strictEqual(bpieces(r, 'phonics_vowel').label, 'Observed once'); assert(!text(r.print).includes(BROAD_CAUTION));
});
test('AC-B: consonant-blend families get the same broader-skill distinction', () => {
  for(const [marks, label] of [[{ milk:'mik', jump:'jup' }, 'Final consonant blends (different clusters)'], [{ spin:'sin', sled:'sed' }, 'Initial s-blends (different clusters)']]){
    const r = run(keyed(S2, marks)); const p = bpieces(r, 'phonics_consonant');
    assert.strictEqual(p.label, 'Possible broader pattern (pattern family)'); assert.strictEqual(p.focus, label);
    assert(/By specific correspondence/.test(p.breakdown)); assert(text(r.print).includes(BROAD_CAUTION));
  }
});
test('AC-B: same-sound families (er/ir/ur, oi/oy) keep "Repeated possible focus (pattern family)" and the original caution', () => {
  const r = run(keyed(S4, { fern:'farn', curl:'carl' })); const p = bpieces(r, 'phonics_vowel');
  assert.strictEqual(p.label, 'Repeated possible focus (pattern family)'); assert(!p.breakdown);
  const t = text(r.print); assert(t.includes(FAMILY_CAUTION)); assert(!t.includes(BROAD_CAUTION));
});
test('AC-B: broad-family screen block shows the specific-correspondence line and its own chip', () => {
  const b = blocks(run({ ...keyed(S5, { cute:'cut' }), ...keyed(S6, { prune:'prun' }) }).screen)[0];
  assert(/^fa-broad fa-family"/.test(b)); assert(b.includes('class="fa-breakdown"')); assert(b.includes('Possible broader pattern'));
});

const eOf = (word, resp) => { const w = ALL_WORDS.find(x => x.sectionId === S4 && x.word === word); return api.analyzeError(w, resp, false); };
for(const [word, resp] of [['card', 'care'], ['bark', 'bare'], ['fork', 'fore'], ['surf', 'sure'], ['dirt', 'dire'], ['curl', 'cure']]){
  test(`AC-E: ${word} → ${resp} is a Teacher check, not a confirmed sound error or a kept correspondence`, () => {
    const a = eOf(word, resp);
    assert.strictEqual(a.tag, 'teacher_check'); assert.notStrictEqual(a.tag, 'phonics_vowel');
    assert.strictEqual(a.targets[0].status, 'unverifiable');
    const expected = { fork:/may stay the same/, card:/commonly changes the vowel sound/, bark:/commonly changes/, surf:/commonly changes/, dirt:/commonly changes/, curl:/commonly changes/ }[word];
    assert(expected.test(a.patternNote), a.patternNote);
    if(word !== 'fork') assert(!/may stay the same/.test(a.patternNote)); else assert(!/commonly changes/.test(a.patternNote), 'or + e is not claimed to change the vowel');
    const r = run(keyed(S4, { [word]: resp })); const t = text(r.print);
    assert(/Teacher check: target sound can't be confirmed · 1 word/.test(t)); assert(!/Vowel\/spelling patterns to review/.test(t));
  });
}
test('AC-E: er + e is described as varying, not as a confirmed change', () => {
  const a = eOf('term', 'tere'); assert.strictEqual(a.tag, 'teacher_check');
  assert(/may or may not change the vowel sound/.test(a.patternNote)); assert(!/commonly changes/.test(a.patternNote));
});
test('AC-E: letters kept without an added final e are unchanged (card → cart, fork → for, bird → birth)', () => {
  for(const [w, r] of [['card', 'cart'], ['bird', 'birth']]) assert.strictEqual(eOf(w, r).tag, 'other');
  assert.strictEqual(eOf('fork', 'for').tag, 'ending_miscue');
});
test('AC-E: a real vowel change is still a confirmed finding (card → cord, term → tarm, fork → fark)', () => {
  for(const [w, r] of [['card', 'cord'], ['term', 'tarm'], ['fork', 'fark']]) assert.strictEqual(eOf(w, r).tag, 'phonics_vowel');
});
test('AC-E: r + e plurals and past forms (cares, cared) are also a Teacher check; a nonsense word is handled the same way', () => {
  assert.strictEqual(eOf('card', 'cares').tag, 'teacher_check'); assert.strictEqual(eOf('card', 'cared').tag, 'teacher_check');
  const r = run(keyed(S4, { varm:'varme' })); assert(!bucket(r, 'phonics_vowel'));   // varme: ar not directly before a final e → unchanged behavior
});
test('AC-E: Teacher check responses never count toward a repeated focus', () => {
  const r = run(keyed(S4, { card:'care', bark:'bare' }));
  assert(!bucket(r, 'phonics_vowel')); assert(!/Repeated possible focus/.test(text(r.print)));
  const mixed = run(keyed(S4, { card:'care', bark:'burk' }));
  assert.strictEqual(api.areaLabel('phonics_vowel', bucket(mixed, 'phonics_vowel').areas[0]), 'Observed once');
});

/* ------------------------------ Stage C: printed report layout ------------------------------ */
test('C: the on-screen results are unchanged by the print work', () => {
  const sig = sec => crypto.createHash('sha1').update(run(keyed(sec, SCRIPTS[sec].marks)).screen).digest('hex').slice(0, 12);
  for(const sec of Object.keys(SCREEN_GOLDEN)) assert.strictEqual(sig(sec), SCREEN_GOLDEN[sec], `on-screen results changed for ${sec}`);
});
test('C: no forced page break before the focus section, and the section may continue across pages', () => {
  assert(!/print-page-break/.test(html.slice(html.indexOf('function reportPrintHTML'), html.indexOf('function printContent'))));
  assert(/\.print-report \.pf-section\{break-inside:auto/.test(html));
  assert(/\.pf-area\{[^}]*break-inside:avoid/.test(html), 'each focus area stays together');
  assert(/\.pf-keep\{break-inside:avoid/.test(html), 'heading and cautions travel with an area');
  assert(/\.pf-group h3\{[^}]*break-after:avoid/.test(html));
  assert(/html,body\{background:#fff!important\}/.test(html), 'printed page background is plain white');
  const printCss = html.slice(html.indexOf('/* Stage C:'), html.indexOf('</style>', html.indexOf('/* Stage C:')));
  assert(!/background:#(f4fffd|ece8f8|fff3d4|eef3f6)/i.test(printCss), 'no tinted fills in the printed focus areas');
  assert(/\.print-report \.print-note\{background:#fff!important\}|\.print-report \.print-note\{[^}]*background:#fff!important/.test(printCss) || /\.print-note\{background:#fff!important\}/.test(printCss), 'printed notes, chips and meta are white');
  assert(/\.pf-family\{border-left-color:#1fa99c\}/.test(printCss), 'family blocks keep their accent line');
});
test('C: printed focus areas follow status → title → one row per word → supporting evidence → cautions', () => {
  const r = run(keyed(S4, { fern:'farn', curl:'carl', lerp:'larp' })); const h = r.printC;
  const pos = k => h.indexOf(k);
  assert(pos('class="pf-status"') < pos('class="pf-title"') && pos('class="pf-title"') < pos('class="pf-words') && pos('class="pf-words') < pos('class="pf-support"'));
  // category cautions follow the guide and come before the findings, so the last area is free to fill the page
  assert(pos('class="pf-guide"') < pos('class="pf-cautions"') && pos('class="pf-cautions"') < pos('class="pf-area'));
  assert.strictEqual((h.match(/<li class="pf-row">/g) || []).length, 3, 'one row per word');
  assert(h.includes('<span class="pf-target">fern</span><span class="pf-arrow">→</span><span class="pf-resp">farn</span>'), 'target and response are separate styled pieces');
  assert(!/farn[^<]*, [a-z]+ →/.test(text(h)), 'no comma-separated runs of responses');
  assert(h.includes('class="pf-tag">Pattern family</span>')); assert(h.includes('r-controlled /er/ (er, ir, ur)'));
});
test('C: the printed report keeps every Stage A wording, status and caution', () => {
  const t = text(run(keyed(S2, { milk:'mik', jump:'jup', vust:'vus' })).printC);
  for(const w of ['Possible broader pattern', 'Final consonant blends (different clusters)', 'Supporting nonsense-word evidence', 'Cautions', NONSENSE_NOTE, BROAD_CAUTION]) assert(t.includes(w), w);
  assert(text(run(keyed(S4, { fern:'farn', curl:'carl' })).printC).includes(FAMILY_CAUTION));
  assert(!text(run(keyed(S3, { shed:'sed', dish:'did' })).printC).includes('Pattern family'));
});
test('C: broad families print a correspondence-level breakdown with u_e /ū/ and u_e /ōō/ kept separate', () => {
  const h = run({ ...keyed(S5, { cute:'cut', cube:'cub', cake:'cak' }), ...keyed(S6, { prune:'prun' }) }).printC;
  const items = [...h.matchAll(/<li><span class="pf-bd-corr">([^<]*)<\/span><span class="pf-bd-words">([^<]*)<\/span><span class="pf-bd-n">([^<]*)<\/span><\/li>/g)].map(m => [m[1], m[2], m[3]]);
  assert.deepStrictEqual(items.map(x => x.join(' | ')).sort(), [
    'a-consonant-e spelling for /ā/ | cake | 1 word',
    'u-consonant-e spelling for /ōō/ | prune | 1 word',
    'u-consonant-e spelling for /ū/ | cute, cube | 2 words · repeated'].sort());
  assert(h.includes('class="pf-status">Possible broader pattern<'));
  const same = run({ ...keyed(S5, { rope:'rop' }), ...keyed(S7, { phone:'fon' }) }).printC;
  assert(same.includes('class="pf-status">Repeated possible focus<') && !same.includes('pf-breakdown'), 'a repeated single correspondence is not shown as a broader pattern');
});
test('C: repeated Teacher-check cautions print once per category and name the patterns they cover', () => {
  const r = run(keyed(S4, { card:'care', dirt:'dire', surf:'sure', fork:'fore' })); const t = text(r.printC);
  const line = 'ar, ir, ur letters present, but the added final e commonly changes the vowel sound (as in care); the sound can\'t be verified from the typed response';
  assert.strictEqual(t.split(line).length - 1, 1, 'shared caution appears once');
  // it sits inside the first affected area (card → care), before the later areas that rely on it
  const raw = r.printC; assert(raw.indexOf('ar, ir, ur letters present') > raw.indexOf('>card<') && raw.indexOf('ar, ir, ur letters present') < raw.indexOf('>dirt<'), 'caution is next to the first applicable finding');
  assert(raw.indexOf('class="pf-cautions"') < 0 || raw.indexOf('ar, ir, ur letters present') > raw.indexOf('class="pf-cautions"') + 400, 'the shared Teacher-check caution is in its area, not the category cautions block');
  assert.strictEqual(t.split('commonly changes the vowel sound').length - 1, 1);
  assert(t.includes('or letters present with a final e added (as in fore); the vowel sound may stay the same'), 'fore keeps its own distinct caution');
  assert(!/(^|, )or letters present[^;]*commonly changes/.test(t), 'or + e is never described as a vowel change');
  for(const w of ['card', 'dirt', 'surf', 'fork']) assert(t.includes(w));
});
test('C: Teacher-check notes that differ per word stay with their word', () => {
  const t = text(run(keyed(S8, { report:'ruhport', table:'tabul' })).printC);
  assert(/report → ruhport/.test(t) || /report→ruhport/.test(t.replace(/\s/g, '')));
  assert(t.includes('Vowel change in the unstressed "re" syllable (typical reduction)')); assert(t.includes('Vowel change in the unstressed "ble" syllable (typical reduction)'));
});
test('C: skipped words are marked not attempted; skipped nonsense words are identified', () => {
  const h = run({ [`${S6}:fault`]: SKIP, [`${S1}:zab`]: SKIP, [`${S1}:cat`]: SKIP }).printC; const t = text(h);
  assert(/Skipped, not attempted/.test(t)); assert((t.match(/Skipped, not attempted/g) || []).length === 3);
  assert(h.includes('<span class="pf-ns">nonsense word</span>')); assert(!/→/.test(text(h.slice(h.indexOf('Skipped / no attempt')))), 'no response arrow on a skipped word');
  assert(/Pattern tested/.test(t));
});
test('C: Teacher check and Skipped sections still print with their guidance', () => {
  const t = text(run({ [`${S6}:cook`]: 'kook', [`${S6}:fault`]: SKIP }).printC);
  assert(/Teacher check: target sound can't be confirmed/.test(t)); assert(/Skipped \/ no attempt/.test(t));
  assert(/No spoken response was recorded/.test(t)); assert(/oo letters present; the vowel sound can't be verified/.test(t));
});
test('C: the printed content is the same data as the screen (words, statuses, counts)', () => {
  const r = run(MIXED); const t = text(r.printC), sc = text(r.screen);
  for(const b of r.buckets){ for(const a of b.areas) for(const e of [...a.real, ...a.nonsense]) assert(t.includes(e.word), 'missing ' + e.word); }
  assert.strictEqual((t.match(/Possible broader pattern/g) || []).length, (sc.match(/Possible broader pattern/g) || []).length);
  assert.strictEqual((t.match(/Observed once/g) || []).length, (sc.match(/Observed once/g) || []).length);
  assert.strictEqual((t.match(/Repeated possible focus/g) || []).length, (sc.match(/Repeated possible focus/g) || []).length);
});
test('C: no focus-area content is dropped from the printed output (every finding word appears once per area)', () => {
  const r = run(MIXED); const h = r.printC;
  const rows = (h.match(/<li class="pf-row">/g) || []).length;
  const expected = r.buckets.reduce((n, b) => n + b.areas.reduce((m, a) => m + a.real.length + a.nonsense.length, 0), 0);
  assert.strictEqual(rows, expected);
});

/* ------------------------------ Stage D: Print Report reliability and authorization ------------------------------ */
// The real report-print-gate.js is executed here with mocked Firebase modules and a minimal fake DOM, so the
// entitlement decisions under test are the shipped ones. No live Firebase call is made by any of these tests.
const GATE_SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'report-print-gate.js'), 'utf8');
const tick = async (n = 8) => { for(let i = 0; i < n; i++) await new Promise(r => setImmediate(r)); };
function fakeTimers(){
  const q = []; let id = 0;
  return { set(fn, ms){ q.push({ id: ++id, fn, ms }); return id; }, clear(i){ const k = q.findIndex(x => x.id === i); if(k >= 0) q.splice(k, 1); },
    fire(){ const t = q.shift(); if(t) t.fn(); return !!t; }, pending: () => q.length };
}
// mode: plus | family | free | free-nodoc | signed-out | auth-error | auth-hang (a Plus account whose sign-in resolves late) | fs-error | fs-hang
function loadMockGate(mode){
  const modals = [], track = [];
  const mkEl = () => ({ _html:'', set innerHTML(v){ this._html = v; }, get innerHTML(){ return this._html; }, style:{}, textContent:'',
    appendChild(){}, addEventListener(){}, removeEventListener(){}, remove(){}, focus(){}, querySelector(){ return mkEl(); }, setAttribute(){} });
  const document = { head:{ appendChild(){} }, body:{ appendChild(el){ if(/role="dialog"/.test(el.innerHTML)) modals.push((el.innerHTML.match(/<h2 id="[^"]*-title">([^<]*)</) || [])[1]); } },
    createElement: mkEl, getElementById: () => mkEl(), addEventListener(){}, removeEventListener(){}, activeElement:null };
  const win = { location:{ pathname:'/phonics-knowledge-check.html', search:'' }, gtag:(a, name) => track.push(name) };
  let authCb; const user = { uid:'teacher-1' };
  const onAuthStateChanged = (auth, next, err) => {
    authCb = next;
    if(mode === 'auth-hang') return;
    if(mode === 'auth-error') return void Promise.resolve().then(() => err(new Error('auth init failed')));
    Promise.resolve().then(() => next(mode === 'signed-out' ? null : user));
  };
  const getDoc = () => {
    if(mode === 'fs-error') return Promise.reject(new Error('permission-denied'));
    if(mode === 'fs-hang') return new Promise(() => {});
    if(mode === 'free-nodoc') return Promise.resolve({ exists: () => false, data: () => ({}) });
    return Promise.resolve({ exists: () => true, data: () => ({ plan: { plus:'plus', family:'family', 'auth-hang':'plus' }[mode] || 'free' }) });
  };
  const body = GATE_SRC.replace(/^import .*$/gm, '').replace('export { guardReportPrint, getEntitlement };', 'return { guardReportPrint, getEntitlement };');
  const gate = new Function('auth', 'db', 'onAuthStateChanged', 'doc', 'getDoc', 'document', 'window', 'setTimeout', 'console', body)(
    {}, {}, onAuthStateChanged, () => ({}), getDoc, document, win, () => 0, { warn(){} });
  return { gate, modals, track, signInLate(){ authCb(user); } };
}
function pageController(opts){
  const events = [], printed = []; const timers = fakeTimers(); let loads = 0;
  const ui = { checking(){ events.push('checking'); }, ready(){ events.push('ready'); }, error(kind, msg, retry){ events.push('error:' + kind); ui.last = { kind, msg, retry }; } };
  const controller = api.createReportPrintController({
    loadGate: opts.loadGate || (() => { loads++; return Promise.resolve(opts.gate); }),
    printReport: opts.printReport || (() => printed.push('report')), ui, timers, timeoutMs: 10000 });
  return { controller, events, printed, timers, ui, loads: () => loads };
}
const GATE_PAID = 'print', MODAL_SIGNED_OUT = 'Print complete reports with Literacy Arcade Plus', MODAL_FREE = 'Upgrade to Plus to print complete reports', MODAL_UNKNOWN = 'We could not confirm your Plus access';
async function click(c){ const p = c.controller.run({}); await tick(); return p; }

for(const plan of ['plus', 'family']){
  atest(`D: signed-in ${plan === 'plus' ? 'Plus' : 'Plus Family'} account prints the report once`, async () => {
    const m = loadMockGate(plan), c = pageController({ gate: m.gate });
    assert.strictEqual(await click(c), 'done'); assert.deepStrictEqual([...c.printed], ['report']);
    assert.deepStrictEqual([...c.events], ['checking', 'ready']); assert.strictEqual(m.modals.length, 0);
  });
}
atest('D: signed-in Free account gets the upgrade message and cannot print', async () => {
  for(const mode of ['free', 'free-nodoc']){
    const m = loadMockGate(mode), c = pageController({ gate: m.gate });
    assert.strictEqual(await click(c), 'done'); assert.strictEqual(c.printed.length, 0);
    assert.deepStrictEqual([...m.modals], [MODAL_FREE]); assert.deepStrictEqual([...c.events], ['checking', 'ready']);
  }
});
atest('D: signed-out user gets the sign-in message and cannot print', async () => {
  const m = loadMockGate('signed-out'), c = pageController({ gate: m.gate });
  assert.strictEqual(await click(c), 'done'); assert.strictEqual(c.printed.length, 0);
  assert.deepStrictEqual([...m.modals], [MODAL_SIGNED_OUT]); assert.deepStrictEqual([...c.events], ['checking', 'ready']);
});
atest('D: Firebase authentication failure fails closed with the existing "could not confirm" message', async () => {
  const m = loadMockGate('auth-error'), c = pageController({ gate: m.gate });
  assert.strictEqual(await click(c), 'done'); assert.strictEqual(c.printed.length, 0); assert.deepStrictEqual([...m.modals], [MODAL_UNKNOWN]);
  assert.strictEqual(c.events[c.events.length - 1], 'ready', 'button restored');
});
atest('D: Firestore entitlement lookup failure fails closed with the existing "could not confirm" message', async () => {
  const m = loadMockGate('fs-error'), c = pageController({ gate: m.gate });
  assert.strictEqual(await click(c), 'done'); assert.strictEqual(c.printed.length, 0); assert.deepStrictEqual([...m.modals], [MODAL_UNKNOWN]);
});
atest('D: an authentication timeout stops waiting, shows a retryable error and never prints', async () => {
  const m = loadMockGate('auth-hang'), c = pageController({ gate: m.gate });
  const p = c.controller.run({}); await tick();
  assert.strictEqual(c.timers.pending(), 1, 'a timeout is armed'); assert.deepStrictEqual([...c.events], ['checking']); assert(c.controller.isBusy());
  c.timers.fire(); assert.strictEqual(await p, 'timeout');
  assert.deepStrictEqual([...c.events], ['checking', 'error:timeout']); assert.strictEqual(c.ui.last.kind, 'timeout'); assert(/couldn't confirm your Plus access in time/.test(c.ui.last.msg));
  assert(!c.controller.isBusy(), 'button can be used again'); assert.strictEqual(c.printed.length, 0);
  // a late sign-in result must not print: the user was told the check failed
  m.signInLate(); await tick(12); assert.strictEqual(c.printed.length, 0, 'a late paid result does not print');
});
atest('D: a Firestore lookup that never resolves times out the same way', async () => {
  const m = loadMockGate('fs-hang'), c = pageController({ gate: m.gate });
  const p = c.controller.run({}); await tick(); c.timers.fire();
  assert.strictEqual(await p, 'timeout'); assert.strictEqual(c.printed.length, 0); assert.strictEqual(c.ui.last.kind, 'timeout');
});
atest('D: a timed-out check can be retried and then succeeds for a paid account', async () => {
  const hang = loadMockGate('auth-hang'), ok = loadMockGate('plus'); let first = true;
  const c = pageController({ loadGate: () => Promise.resolve(first ? hang.gate : ok.gate) });
  const p = c.controller.run({}); await tick(); c.timers.fire(); await p;
  first = false; const retry = c.ui.last.retry; const r = retry(); await tick(); assert.strictEqual(await r, 'done');
  assert.deepStrictEqual([...c.printed], ['report']); assert.deepStrictEqual([...c.events], ['checking', 'error:timeout', 'checking', 'ready']);
});
atest('D: a dynamic import failure is handled: message, retry, nothing printed, button restored', async () => {
  let n = 0; const ok = loadMockGate('plus');
  const c = pageController({ loadGate: () => (++n === 1 ? Promise.reject(new Error('Failed to fetch dynamically imported module')) : Promise.resolve(ok.gate)) });
  assert.strictEqual(await click(c), 'load'); assert.strictEqual(c.printed.length, 0);
  assert.deepStrictEqual([...c.events], ['checking', 'error:load']); assert(/couldn't load the report-printing check/.test(c.ui.last.msg)); assert(!c.controller.isBusy());
  const r = c.ui.last.retry(); await tick(); assert.strictEqual(await r, 'done'); assert.deepStrictEqual([...c.printed], ['report']);
});
atest('D: a module that loads but lacks the gate function is treated as a load failure (fail closed)', async () => {
  for(const bad of [{}, null, { guardReportPrint: 'nope' }]){
    const c = pageController({ gate: bad }); assert.strictEqual(await click(c), 'load'); assert.strictEqual(c.printed.length, 0);
  }
});
atest('D: a stalled module load is reported as a load problem after the timeout', async () => {
  const c = pageController({ loadGate: () => new Promise(() => {}) });
  const p = c.controller.run({}); await tick(); c.timers.fire(); assert.strictEqual(await p, 'load'); assert.strictEqual(c.printed.length, 0);
});
atest('D: a gate that throws fails closed with a generic retryable error', async () => {
  const c = pageController({ gate: { guardReportPrint: () => Promise.reject(new Error('boom')) } });
  assert.strictEqual(await click(c), 'unknown'); assert.strictEqual(c.printed.length, 0); assert.strictEqual(c.ui.last.kind, 'unknown');
});
atest('D: authorized but the report cannot be prepared: clear message, no success claimed', async () => {
  const m = loadMockGate('plus'), c = pageController({ gate: m.gate, printReport: () => { throw new Error('render failed'); } });
  assert.strictEqual(await click(c), 'print'); assert.deepStrictEqual([...c.events], ['checking', 'error:print']); assert(/access was confirmed, but the report couldn't be prepared/.test(c.ui.last.msg));
});
atest('D: rapid clicks run one check and one print; extra clicks are ignored', async () => {
  const m = loadMockGate('plus'), c = pageController({ gate: m.gate });
  const results = await Promise.all([1, 2, 3, 4, 5].map(() => c.controller.run({}))); await tick();
  assert.deepStrictEqual([...results].sort(), ['done', 'ignored', 'ignored', 'ignored', 'ignored']);
  assert.strictEqual(c.loads(), 1); assert.deepStrictEqual([...c.printed], ['report']); assert.deepStrictEqual([...c.events], ['checking', 'ready']);
  assert.strictEqual(await click(c), 'done'); assert.strictEqual(c.printed.length, 2, 'a later click works normally');
});
atest('D: clicks during a hung check are ignored until it times out', async () => {
  const m = loadMockGate('auth-hang'), c = pageController({ gate: m.gate });
  const first = c.controller.run({}); await tick();
  assert.strictEqual(await c.controller.run({}), 'ignored'); assert.strictEqual(c.loads(), 1);
  c.timers.fire(); await first; assert.strictEqual(c.timers.pending(), 0, 'timer cleaned up');
});
atest('D: every non-paid outcome across all scenarios leaves the report unprinted', async () => {
  for(const mode of ['free', 'free-nodoc', 'signed-out', 'auth-error', 'fs-error']){
    const m = loadMockGate(mode), c = pageController({ gate: m.gate }); await click(c); assert.strictEqual(c.printed.length, 0, mode);
  }
  for(const mode of ['auth-hang', 'fs-hang']){
    const m = loadMockGate(mode), c = pageController({ gate: m.gate }); const p = c.controller.run({}); await tick(); c.timers.fire(); await p; assert.strictEqual(c.printed.length, 0, mode);
  }
});
// A gate whose callback is captured, so a test can invoke the authorized-print callback itself at any moment.
function capturingGate(){
  const calls = [];
  return { calls, gate: { guardReportPrint(cb){ return new Promise((resolve, reject) => calls.push({ cb, resolve, reject })); } } };
}
atest('D: the authorized-print callback invoked AFTER the timeout does not print', async () => {
  const g = capturingGate(), c = pageController({ gate: g.gate });
  const p = c.controller.run({}); await tick(); assert.strictEqual(g.calls.length, 1);
  c.timers.fire(); assert.strictEqual(await p, 'timeout');
  g.calls[0].cb(); await tick();                       // the shared gate decides "paid" 11 seconds in
  assert.strictEqual(c.printed.length, 0, 'stale callback must not print');
  g.calls[0].resolve(); await tick();
  assert.deepStrictEqual([...c.events], ['checking', 'error:timeout'], 'and it does not touch the UI');
});
atest('D: a retry after a timeout owns the next attempt; the original callback cannot print or affect it', async () => {
  const g = capturingGate(), c = pageController({ gate: g.gate });
  const p1 = c.controller.run({}); await tick(); c.timers.fire(); await p1;
  const p2 = c.ui.last.retry(); await tick(); assert.strictEqual(g.calls.length, 2); assert(c.controller.isBusy());
  const eventsBefore = [...c.events];
  g.calls[0].cb(); g.calls[0].resolve(); await tick();
  assert.strictEqual(c.printed.length, 0, 'stale callback does not print'); assert(c.controller.isBusy(), 'new attempt still running');
  assert.deepStrictEqual([...c.events], eventsBefore, 'stale callback leaves the UI alone');
  g.calls[1].cb(); g.calls[1].resolve(); assert.strictEqual(await p2, 'done');
  assert.deepStrictEqual([...c.printed], ['report'], 'only the current attempt printed, once');
  g.calls[0].cb(); await tick(); assert.strictEqual(c.printed.length, 1, 'the stale callback still cannot print afterwards');
});
atest('D: a callback from an attempt that failed with an error cannot print later', async () => {
  const g = capturingGate(), c = pageController({ gate: g.gate });
  const p = c.controller.run({}); await tick(); g.calls[0].reject(new Error('gate blew up')); assert.strictEqual(await p, 'unknown');
  g.calls[0].cb(); await tick(); assert.strictEqual(c.printed.length, 0);
});
atest('D: a callback from an attempt superseded by a newer one cannot print', async () => {
  const g = capturingGate(), c = pageController({ gate: g.gate });
  const p1 = c.controller.run({}); await tick(); g.calls[0].resolve(); await p1;   // attempt 1 ended without printing (e.g. a modal)
  const p2 = c.controller.run({}); await tick();
  g.calls[0].cb(); await tick(); assert.strictEqual(c.printed.length, 0);
  g.calls[1].cb(); g.calls[1].resolve(); await p2; assert.deepStrictEqual([...c.printed], ['report']);
});
atest('D: the shared gate\'s own "Try again" (same attempt, still current) can still print after its modal', async () => {
  const g = capturingGate(), c = pageController({ gate: g.gate });
  const p = c.controller.run({}); await tick(); g.calls[0].resolve(); assert.strictEqual(await p, 'done');   // gate showed its "could not confirm" modal
  g.calls[0].cb(); await tick(); assert.deepStrictEqual([...c.printed], ['report'], 'the modal retry path is preserved');
});
atest('D: no report is built or printed unless the gate invokes the callback (the 4s asset wait lives only behind it)', async () => {
  for(const mode of ['free', 'free-nodoc', 'signed-out', 'auth-error', 'fs-error']){
    const m = loadMockGate(mode); let built = 0; const c = pageController({ gate: m.gate, printReport: () => { built++; } });
    await click(c); assert.strictEqual(built, 0, mode + ': printContent (and its 4s logo wait) is never reached');
  }
  for(const mode of ['auth-hang', 'fs-hang']){
    const m = loadMockGate(mode); let built = 0; const c = pageController({ gate: m.gate, printReport: () => { built++; } });
    const p = c.controller.run({}); await tick(); c.timers.fire(); await p; assert.strictEqual(built, 0, mode);
  }
});
test('D: the 4-second logo/font bound exists only inside printContent, which is reached only from the gate callback', () => {
  const printBody = pageScript.slice(pageScript.indexOf('function printContent(kind)'), pageScript.indexOf('/* ============================ WIRING'));
  const uses = pageScript.split('REPORT_PRINT_ASSET_WAIT_MS').length - 1;
  assert.strictEqual(uses, 2, 'declared once and used once');
  assert.strictEqual(printBody.split('REPORT_PRINT_ASSET_WAIT_MS').length - 1, 1, 'the only use is inside printContent');
  assert.strictEqual((pageScript.match(/printContent\('report'\)/g) || []).length, 1);
  assert(/gate\.guardReportPrint\(\(\) => \{\s*if\(aborted \|\| mine !== generation\) return;\s*try \{ printReport\(\); \}/.test(pageScript), 'printReport is called only inside the gate callback, behind the attempt check');
  assert(!/printContent\('report'\)/.test(printBody), 'printContent never starts a report print by itself');
});
test('D: the page wires Print Report through the controller and Print Student Sheet stays ungated', () => {
  const script = pageScript;
  assert(/function handlePrintReportClick\(event\)\{\s*reportPrintController\.run\(event\.currentTarget\);\s*\}/.test(script));
  assert.strictEqual((script.match(/printContent\('report'\)/g) || []).length, 1, 'the report is only printed from the gate callback');
  assert(/printReport: \(\) => printContent\('report'\)/.test(script));
  const sheet = script.slice(script.indexOf("$('printSheetBtn').addEventListener"), script.indexOf("$('startAssessmentBtn').addEventListener"));
  assert(/printContent\('student'\)/.test(sheet)); assert(!/guardReportPrint|reportPrintController|report-print-gate/.test(sheet));
  assert(/\$\('printReportBtn'\)\.addEventListener\('click', handlePrintReportClick\)/.test(script));
});
test('D: the button shows "Checking access…", is disabled during the check and is restored afterwards', () => {
  const script = pageScript;
  assert(/b\.disabled = true; b\.setAttribute\('aria-busy', 'true'\); b\.textContent = 'Checking access…'/.test(script));
  assert(/b\.disabled = false; b\.removeAttribute\('aria-busy'\); b\.textContent = this\.label/.test(script));
  assert(/id="printReportStatus" class="print-status" role="alert" hidden/.test(html), 'status region is hidden until a check fails');
  assert(/REPORT_GATE_TIMEOUT_MS = 10000/.test(script));
});
test('D: the report waits only a bounded time for its logo and fonts; the student sheet path keeps its original wait', () => {
  const body = pageScript.slice(pageScript.indexOf('function printContent(kind)'), pageScript.indexOf('/* ============================ WIRING'));
  assert(/REPORT_PRINT_ASSET_WAIT_MS = 4000/.test(pageScript));
  assert(/kind==='report'\s*\?\s*Promise\.race\(\[assetsReady, new Promise\(resolve=>setTimeout\(resolve, REPORT_PRINT_ASSET_WAIT_MS\)\)\]\)\s*:\s*assetsReady/.test(body));
  assert(/waited\.then\(finishPrint\)\.catch\(finishPrint\)/.test(body));
  assert(/Promise\.all\(\[logoReady,fontsReady\]\)/.test(body));
});
test('D: the shared authentication modules are unchanged (the report check is still independent of the assessment gate)', () => {
  const sha = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(__dirname, '..', '..', f))).digest('hex');
  assert.strictEqual(sha('report-print-gate.js'), 'f097e19e0456b49dd6bf32f62396629bd2c7457d');
  assert.strictEqual(sha('assessment-use-guard.js'), '460a77430bee9ecade1ebbbb746be73eaf376449');
  assert.strictEqual(sha('firebase-config.js'), '53c071717ed6cf8678f1427e684e428f3b34d7e5');
  assert(/isPaidPlan[\s\S]{0,200}'plus'[\s\S]{0,40}'family'/.test(GATE_SRC), 'only plus and family are paid plans');
});

(async () => {
  for(const [name, fn] of asyncTests){
    try { await fn(); passed++; console.log('ok    ' + name); }
    catch(e){ failed++; console.log('FAIL  ' + name + '\n      ' + (e.message || e).split('\n')[0]); }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
