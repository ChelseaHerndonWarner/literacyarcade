// Regression tests for the Phonics Knowledge Check analyzer and report data (Phases 1-4).
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
code = code.slice(0, end) + ';globalThis.__api={state,PHONICS_WORDS,ALL_WORDS,scoreData,renderPatternNotes,patternPrintRows,buildFocusAreas,analyzeError};\n' + code.slice(end);
vm.runInContext(code, ctx);
const api = ctx.__api;
const { state, ALL_WORDS, PHONICS_WORDS } = api;

/* ------------------------------ helpers ------------------------------ */
const SKIP = '__SKIP__';
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
  return { score, buckets: api.buildFocusAreas(score.details), screen: api.renderPatternNotes(score.details), print: api.patternPrintRows(score.details) };
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
    r.score.details.forEach(d => { assert(text(r.screen).includes(d.word), 'screen ' + d.word); assert(text(r.print).includes(d.word), 'print ' + d.word); });
    const heads = h => [...text(h).matchAll(/(\d+) focus areas? · (\d+) findings?/g)].map(m => m[0]);
    assert.deepStrictEqual(heads(r.screen), heads(r.print));
  });
}

/* ------------------------------ Phase 1 ------------------------------ */
test('P1: real and nonsense evidence stay in separate lists; nonsense never raises strength', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S1}:zab`]: 'zeb' });
  const a = label(r, 'phonics_vowel');
  assert.strictEqual(a.real.length, 1); assert.strictEqual(a.nonsense.length, 1);
  assert(/Observed once/.test(text(r.screen)) && !/Repeated/.test(text(r.screen)));
});
test('P1: two real words repeat; cat/map/zab shows the specific focus and no family caution', () => {
  const r = run(keyed(S1, { cat:'cot', map:'mop', zab:'zeb' }));
  const t = text(r.screen);
  assert(/Repeated possible focus: a spelling for short a \/ă\/ in a CVC word/.test(t));
  assert(/Supporting nonsense-word evidence: zab → zeb/.test(t));
  assert(!/Related spellings in this family/.test(t));
});
test('P1: nonsense-only evidence is never Repeated, even with two words', () => {
  const mk = w => ({ word:w, response:'x', type:'nonsense', focus:'F in a nonsense word', tag:'phonics_vowel', skipped:false, patternNote:null });
  const h = text(api.renderPatternNotes([mk('a'), mk('b')]));
  assert(!/Repeated/.test(h)); assert(/Observed in nonsense words only/.test(h)); assert(/Nonsense-word evidence only/.test(h));
});
test('P1: grouped findings carry per-word notes, not the first word\'s note', () => {
  const t = text(run(keyed(S3, { notch:'not', datch:'dat' })).screen);
  assert(/notch → not \(o pattern was preserved\)/.test(t)); assert(/datch → dat \(a pattern was preserved\)/.test(t));
  const t2 = text(run(keyed(S2, { spin:'span', split:'splat' })).screen);
  assert(/spin → span \(sp pattern was preserved\), split → splat \(spl pattern was preserved\)/.test(t2));
});
test('P1: heading format is "N focus areas · M findings" for pattern buckets and "N words" otherwise', () => {
  const t = text(run(keyed(S1, SCRIPTS[S1].marks)).screen);
  assert(/Vowel\/spelling patterns to review · 2 focus areas · 4 findings/.test(t));
  assert(/Skipped \/ no attempt · 1 word/.test(t)); assert(/Other miscues not tied to the target pattern · 2 words/.test(t));
});
test('P1: nonsense caution appears once per area with nonsense words, including a skipped nonsense word', () => {
  const t = text(run(keyed(S3, { phip:SKIP })).screen);
  assert(/Nonsense-word evidence only/.test(t)); assert(/Supplemental transfer evidence/.test(t));
});

/* ------------------------------ Phase 2 ------------------------------ */
test('P2: vowel nucleus ignores silent e, qu, and a typed schwa', () => {
  assert.strictEqual(analyze(S3, 'badge', 'bad').findings[0].patternNote, 'a pattern was preserved');
  assert.strictEqual(analyze(S3, 'nudge', 'nud').findings[0].patternNote, 'u pattern was preserved');
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
  assert(/soft g pattern was preserved/.test(analyze(S7, 'gem', 'jam').findings[0].patternNote));
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
  const r = run(keyed(S8, SCRIPTS[S8].marks)); const t = text(r.screen);
  assert(/Repeated possible focus: VCe syllable decoding · letters omitted/.test(t));
  assert(/Supporting nonsense-word evidence: repnate → repnat/.test(t));
  assert(/Observed once: Closed syllable decoding · letters omitted/.test(t));
  assert(!/Repeated possible focus: Closed/.test(t));
});
test('P3: skipped multisyllabic word names its pattern', () => {
  assert.strictEqual(api.analyzeError(find(S8, 'tornado'), '', true).focus, 'R-Controlled + Open + Open multisyllabic decoding');
});

/* ------------------------------ Phase 4: families ------------------------------ */
const FAMILY_CAUTION = 'Related spellings in this family were missed; this does not mean every spelling in the family is unknown';
function familyCase(name, marks, tag, familyLabel, words, specifics){
  test(`P4 family: ${name}`, () => {
    const r = run(marks); const b = bucket(r, tag);
    assert.strictEqual(b.areas.length, 1, 'one focus area'); const a = b.areas[0];
    assert.strictEqual(a.focus, familyLabel); assert(a.spansFamily);
    assert.deepStrictEqual(areaWords(a).sort(), words.slice().sort());
    const t = text(r.screen);
    assert(t.includes(`Repeated possible focus: ${familyLabel}`), 'repeated label');
    for(const [word, spelling, kind] of specifics) assert(t.includes(`${word} → ${marks[Object.keys(marks).find(k => k.endsWith(':' + word))]} (${spelling} · ${kind}`), `specifics for ${word}`);
    assert(t.includes(FAMILY_CAUTION)); assert(text(r.print).includes(FAMILY_CAUTION));
    assert.strictEqual(b.findings, words.length);
  });
}
familyCase('/er/ (fern, curl)', keyed(S4, { fern:'farn', curl:'carl' }), 'phonics_vowel', 'r-controlled /er/ (er, ir, ur)', ['fern', 'curl'],
  [['fern', 'er spelling for /er/', 'vowel changed'], ['curl', 'ur spelling for /er/', 'vowel changed']]);
familyCase('/oi/ (coin, toy)', keyed(S6, { coin:'con', toy:'tie' }), 'phonics_vowel', '/oi/ diphthong (oi, oy)', ['coin', 'toy'],
  [['coin', 'oi spelling for /oi/', 'letters omitted'], ['toy', 'oy spelling for /oi/', 'letters changed']]);
familyCase('final blends (milk, jump)', keyed(S2, { milk:'mil', jump:'jum' }), 'phonics_consonant', 'Final consonant blends', ['milk', 'jump'],
  [['milk', 'final lk blend', 'letters omitted'], ['jump', 'final mp blend', 'letters omitted']]);
familyCase('silent e (cake, bike)', keyed(S5, { cake:'cack', bike:'bik' }), 'phonics_vowel', 'Silent-e (VCe) vowel pattern', ['cake', 'bike'],
  [['cake', 'a-consonant-e spelling for long a /ā/', 'letters changed'], ['bike', 'i-consonant-e spelling for long i /ī/', 'letters omitted']]);

test('P4 family: nonsense words support a family finding but never raise it', () => {
  const one = run(keyed(S4, { fern:'farn', lerp:'larp', jirn:'jarn' }));
  assert(/Observed once/.test(text(one.screen))); assert(!/Repeated/.test(text(one.screen)));
  const two = run(keyed(S5, { cake:'cack', bike:'bik', zide:'zid' }));
  assert(/Supporting nonsense-word evidence: zide → zid/.test(text(two.screen)));
  assert.strictEqual(label(two, 'phonics_vowel').real.length, 2);
  const lone = run(keyed(S6, { coin:'con', noit:'nit' }));
  assert(/Observed once/.test(text(lone.screen)) && !/Repeated/.test(text(lone.screen)));
});
test('P4 family: one real word in a family is Observed once with its own spelling, no family caution', () => {
  const r = run(keyed(S4, { fern:'farn' })); const t = text(r.screen);
  assert(/Observed once: er spelling for \/er\//.test(t)); assert(!t.includes(FAMILY_CAUTION));
});
test('P4 family: skipped words do not count toward a family repeat', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:surf`]: SKIP });
  const a = label(r, 'phonics_vowel'); assert.strictEqual(areaWords(a).length, 1);
  assert(/Observed once/.test(text(r.screen))); assert(!/Repeated/.test(text(r.screen)));
  assert(bucket(r, 'skipped')); assert(/surf \(skipped\)/.test(text(r.screen)));
});
test('P4 family: Teacher check findings do not count toward a family repeat', () => {
  const r = run({ [`${S6}:hawk`]: 'hock', [`${S6}:fault`]: 'fat' });
  const a = label(r, 'phonics_vowel'); assert.strictEqual(areaWords(a).join(), 'fault');
  assert(/Observed once/.test(text(r.screen))); assert(!/Repeated/.test(text(r.screen)));
  assert.strictEqual(label(r, 'teacher_check').real[0].word, 'hawk');
  const r2 = run({ [`${S6}:cook`]: 'kook', [`${S4}:bird`]: 'burt', [`${S4}:fern`]: 'farn' });
  assert(!/Repeated/.test(text(r2.screen)));
});
test('P4 family: unrelated or merely similar spellings are not merged', () => {
  const rIn = run(keyed(S2, { spin:'pin', plug:'pug' }));              // initial s-blend vs initial l-blend
  assert.strictEqual(bucket(rIn, 'phonics_consonant').areas.length, 2);
  const rEw = run(keyed(S6, { few:'foo', grew:'grow' }));                 // same letters, different sounds
  assert.strictEqual(bucket(rEw, 'phonics_vowel').areas.length, 2); assert(!/Repeated/.test(text(rEw.screen)));
  const rAr = run(keyed(S4, { card:'cord', fern:'farn' }));               // ar is not in the /er/ family
  assert.strictEqual(bucket(rAr, 'phonics_vowel').areas.length, 2);
  const rFin = run({ [`${S3}:notch`]: 'not', [`${S3}:badge`]: 'bad' });   // -tch and -dge stay separate
  assert.strictEqual(bucket(rFin, 'phonics_consonant').areas.length, 2);
});
test('P4 family: same-spelling repeats keep their specific focus (no family relabeling)', () => {
  const r = run(keyed(S3, { badge:'bad', nudge:'nud' }));
  const a = label(r, 'phonics_consonant'); assert(!a.spansFamily);
  assert(/Repeated possible focus: final dge spelling for \/j\/ after a short vowel/.test(text(r.screen)));
});
test('P4 family: heading counts follow focus areas and findings', () => {
  const t = text(run(keyed(S4, { fern:'farn', curl:'carl' })).screen);
  assert(/Vowel\/spelling patterns to review · 1 focus area · 2 findings/.test(t));
});
test('P4 family: print report carries the same family content as the screen', () => {
  const r = run(keyed(S6, { coin:'con', toy:'tie', noit:'nit' }));
  const p = text(r.print);
  assert(p.includes('Repeated possible focus: /oi/ diphthong (oi, oy)'));
  assert(p.includes('coin → con (oi spelling for /oi/ · letters omitted)')); assert(p.includes('toy → tie (oy spelling for /oy/'.replace('/oy/', '/oi/') + ' · letters changed)'));
  assert(p.includes('Supporting nonsense-word evidence: noit → nit'));
});


/* -------- Phase 4 corrections: same correspondence vs different correspondences in a family -------- */
const MULTI_CORR_LABEL_RE = /Related spellings in this family/;
function sameCorrCase(name, marks, tag, corrLabel, words, specifics){
  test(`P4 same correspondence: ${name}`, () => {
    const r = run(marks); const b = bucket(r, tag);
    assert.strictEqual(b.areas.length, 1, 'one focus area'); const a = b.areas[0];
    assert.strictEqual(a.focus, `${corrLabel} (across positions or contexts)`);
    assert(!a.spansFamily, 'not framed as a family');
    assert.strictEqual(new Set(a.real.map(e => e.corr)).size, 1); assert(a.real.every(e => e.corr));
    assert.deepStrictEqual(areaWords(a).sort(), words.slice().sort());
    const t = text(r.screen), p = text(r.print);
    assert(t.includes(`Repeated possible focus: ${corrLabel} (across positions or contexts)`), 'repeated label (screen)');
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
  const r = run({ [`${S1}:cat`]: 'cot', [`${S2}:grab`]: 'grub', [`${S1}:zab`]: 'zeb' }); const t = text(r.screen);
  assert(/Repeated possible focus: a spelling for short a \/ă\/ \(across positions or contexts\)/.test(t));
  assert(/Supporting nonsense-word evidence: zab → zeb/.test(t)); assert(!MULTI_CORR_LABEL_RE.test(t));
  const one = run({ [`${S1}:cat`]: 'cot', [`${S1}:zab`]: 'zeb' }); assert(!/Repeated/.test(text(one.screen)));
});
test('P4 same correspondence: skipped and Teacher check words do not make a correspondence repeat', () => {
  const r = run({ [`${S3}:shed`]: 'sed', [`${S3}:dish`]: SKIP });
  assert(/Observed once: sh spelling for \/sh\//.test(text(r.screen))); assert(!/Repeated/.test(text(r.screen)));
  const r2 = run({ [`${S6}:hawk`]: 'hock', [`${S6}:fault`]: 'fat' }); assert(!/Repeated/.test(text(r2.screen)));
});
test('P4 same correspondence: the same grapheme for different sounds is never one correspondence', () => {
  const pairs = [[S6, 'few', 'foo', S6, 'grew', 'grow'],      // ew /ū/ vs ew /ōō/
                 [S6, 'moon', 'mon', S6, 'cook', 'cuk'],      // oo /ōō/ vs oo /oo/
                 [S5, 'low', 'lo', S6, 'down', 'dun'],        // ow /ō/ vs ow /ow/
                 [S5, 'leaf', 'lef', S7, 'bread', 'brad']];   // ea /ē/ vs ea /ĕ/
  for(const [s1, w1, r1, s2, w2, r2] of pairs){
    const r = run({ [`${s1}:${w1}`]: r1, [`${s2}:${w2}`]: r2 });
    const areas = bucket(r, 'phonics_vowel').areas;
    assert.strictEqual(areas.length, 2, `${w1}/${w2} stay separate`); assert(!/Repeated/.test(text(r.screen)), `${w1}/${w2} not repeated`);
  }
});
test('P4 family: different correspondences within a family use family framing and the caution; same-corr repeats inside it stay visible', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:curl`]: 'carl', [`${S4}:term`]: 'tarm' });
  const a = bucket(r, 'phonics_vowel').areas; assert.strictEqual(a.length, 1);
  assert(a[0].spansFamily); assert.strictEqual(a[0].focus, 'r-controlled /er/ (er, ir, ur)');
  assert.strictEqual(new Set(a[0].real.map(e => e.corr)).size, 2);
  const t = text(r.screen);
  assert(/Repeated possible focus: r-controlled \/er\/ \(er, ir, ur\)/.test(t)); assert(t.includes(FAMILY_CAUTION));
  for(const w of ['fern → farn (er spelling for /er/', 'term → tarm (er spelling for /er/', 'curl → carl (ur spelling for /er/']) assert(t.includes(w), w);
});
test('P4 family: one real word per correspondence is still a family repeat only with two correspondences and two words', () => {
  const r = run({ [`${S4}:fern`]: 'farn', [`${S4}:term`]: 'tarm' });   // same correspondence (er) twice, same focus text
  const a = bucket(r, 'phonics_vowel').areas[0]; assert(!a.spansFamily);
  assert(/Repeated possible focus: er spelling for \/er\//.test(text(r.screen))); assert(!text(r.screen).includes(FAMILY_CAUTION));
});

/* ------------------------------ Phase 4 corrections: layout ------------------------------ */
test('P4 layout (screen): the label precedes the words in every focus area', () => {
  const r = run({ ...keyed(S2, { milk:'mil', jump:'jum', pond:'pand', stog:'steg' }), [`${S1}:cat`]: 'cot', [`${S1}:map`]: 'mop' });
  const chips = r.screen.split('<span class="pattern-chip').slice(1);
  assert(chips.length >= 3);
  for(const c of chips){
    const body = c.replace(/^[^>]*>/, '');
    const labelAt = body.search(/Repeated possible focus|Observed once/);
    const wordAt = body.search(/\w+ → \w+/);
    assert(labelAt >= 0 && labelAt < wordAt, 'label first: ' + text(c).slice(0, 80));
  }
});
test('P4 layout (print): the family caution is its own line, not appended to the word list', () => {
  const r = run(keyed(S6, { coin:'con', toy:'tie', noit:'nit' }));
  assert(r.print.includes(`</span><span>${FAMILY_CAUTION}</span>`), 'caution in its own span');
  assert(!text(r.print).includes(` · ${FAMILY_CAUTION}`), 'no separator before the caution');
  const rs = run(keyed(S3, { shed:'sed', dish:'did' })); assert(!rs.print.includes('Related spellings'));
});
test('P4 layout: screen and print carry the same labels, words and cautions in the same order', () => {
  const r = run(keyed(S6, { coin:'con', toy:'tie', noit:'nit' }));
  const order = h => ['Repeated possible focus: /oi/ diphthong (oi, oy)', 'coin → con', 'toy → tie', 'Supporting nonsense-word evidence: noit → nit', 'Supplemental transfer evidence', FAMILY_CAUTION].map(k => text(h).indexOf(k));
  for(const h of [r.screen, r.print]){ const o = order(h); assert(o.every(i => i >= 0), 'all present'); assert.deepStrictEqual(o.slice().sort((a, b) => a - b), o, 'same order'); }
});

/* ------------------------------ Phase 4: short vowels across Sections 1-3 ------------------------------ */
test('P4 short vowels: different short vowels stay separate; nonsense words support', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S1}:bed`]: 'bid', [`${S1}:zab`]: 'zeb' });
  const areas = bucket(r, 'phonics_vowel').areas; assert.strictEqual(areas.length, 2);
  assert(/Observed once: e spelling for short e/.test(text(r.screen)));
  assert(/Observed once: a spelling for short a/.test(text(r.screen)) && !/Repeated/.test(text(r.screen)));
});
test('P4 short vowels: a long-vowel target is not in a short-vowel family', () => {
  const r = run({ [`${S1}:cat`]: 'cot', [`${S7}:ghost`]: 'gust' });
  assert.strictEqual(bucket(r, 'phonics_vowel').areas.length, 2);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
