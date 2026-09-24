/**
 * Phoneme Mapping Engine — Custom Word Generator
 *
 * Standalone, additive module. It does not read or modify anything in
 * phoneme-counter.html or letterbox-lesson.html, and neither page loads it
 * yet — this file exists so later stages can wire it in without touching
 * the vetted word-bank mapping logic that already works.
 *
 * Purpose: given ANY word (not just words in the curated Phoneme Counter
 * word banks), produce a best-guess phoneme/grapheme sound-box mapping in
 * the same shape Letterbox Lesson already consumes:
 *   { word, phonemes, boxes, outsideLetters }
 * plus a confidence tier ("high" | "low") so calling UIs know how strongly
 * to prompt a teacher/parent to review before use. This is a heuristic
 * generator, not a pronunciation dictionary — it will get irregular words,
 * proper nouns, and multiple-pronunciation words wrong sometimes. Review
 * is the safeguard, not perfect output.
 *
 * Usage (once wired into a page):
 *   const guess = PhonemeMappingEngine.generateMapping('splendid');
 *   // => { word, graphemes, phonemes, boxes, outsideLetters,
 *   //      phonemeCount, confidence, source: 'generated', note }
 */
(function (global) {
  'use strict';

  // ---- Reference phoneme/grapheme tables --------------------------------
  // Notation matches the slash-delimited, teacher-friendly labels already
  // used across Literacy Arcade (e.g. /k/, /ă/, /sh/) — no IPA.

  const CONSONANTS = {
    b: '/b/', c: '/k/', d: '/d/', f: '/f/', g: '/g/', h: '/h/', j: '/j/',
    k: '/k/', l: '/l/', m: '/m/', n: '/n/', p: '/p/', q: '/k/', r: '/r/',
    s: '/s/', t: '/t/', v: '/v/', w: '/w/', x: '/ks/', z: '/z/'
  };

  const TRIGRAPHS = { tch: '/ch/', dge: '/j/', igh: '/ī/' };

  const DIGRAPHS = { sh: '/sh/', ch: '/ch/', th: '/th/', wh: '/w/', ck: '/k/', ng: '/ŋ/', ph: '/f/' };

  const FLSZ = { ff: '/f/', ll: '/l/', ss: '/s/', zz: '/z/' };

  // Silent-letter consonant clusters where the whole cluster is one
  // grapheme/one sound box, but the letters inside it stay separate
  // student tiles (e.g. "wr" is /r/, but a learner still has a "w" tile
  // and an "r" tile that both go in that one box). Position-restricted
  // because the silent-letter reading only holds in that position —
  // "kn"/"wr"/"gn" are word-initial patterns in real English vocabulary;
  // "mb" is a word-final pattern (lamb, comb, thumb).
  const INITIAL_CLUSTERS = { kn: '/n/', wr: '/r/', gn: '/n/' };
  const FINAL_CLUSTERS = { mb: '/m/' };

  // Schwa — the reduced/unstressed vowel sound (the second syllable of
  // "sofa", the first of "about"). A real, distinct learner-facing symbol,
  // not a stand-in for /ŭ/. Only assigned when CMUdict pronunciation data
  // is loaded and actually indicates a reduced vowel there — see
  // getVowelStressSequence() and generateWordMapping() below.
  const SCHWA = '/ə/';

  // Vowel teams / r-controlled vowels / diphthongs / variant vowels.
  // `ambiguous: true` marks a spelling that reliably represents more than
  // one sound depending on the word (e.g. "ow" in snow vs. cow) — any word
  // containing one of these always comes back with confidence: "low".
  const VOWEL_UNITS = {
    ai: { phoneme: '/ā/' }, ay: { phoneme: '/ā/' },
    ee: { phoneme: '/ē/' }, ea: { phoneme: '/ē/' },
    oa: { phoneme: '/ō/' },
    ow: { phoneme: '/ō/', ambiguous: true },   // or diphthong /ow/ (cow)
    ie: { phoneme: '/ī/', ambiguous: true },   // or /ē/ (chief)
    ar: { phoneme: '/ar/' }, or: { phoneme: '/or/' },
    er: { phoneme: '/er/' }, ir: { phoneme: '/er/' }, ur: { phoneme: '/er/' },
    oi: { phoneme: '/oy/' }, oy: { phoneme: '/oy/' },
    au: { phoneme: '/aw/' }, aw: { phoneme: '/aw/' },
    ou: { phoneme: '/OO/', ambiguous: true },  // or /ow/ (out), /ŭ/ (touch)
    oo: { phoneme: '/OO/', ambiguous: true },  // long or short oo
    ew: { phoneme: '/OO/', ambiguous: true },  // or /ū/ (few)
    ue: { phoneme: '/OO/', ambiguous: true },  // or /ū/ (cue)
    ui: { phoneme: '/OO/', ambiguous: true }   // or /ĭ/ (build)
  };

  const SHORT_VOWELS = { a: '/ă/', e: '/ĕ/', i: '/ĭ/', o: '/ŏ/', u: '/ŭ/' };
  const LONG_VOWELS = { a: '/ā/', e: '/ē/', i: '/ī/', o: '/ō/', u: '/ū/' };

  // Common inflectional/derivational suffixes, longest-match first. Peeled
  // off before core tokenizing so affixed/multisyllable words don't get
  // mangled by the single-syllable-oriented core tokenizer below.
  // Pronunciation of -ed/-s/-es genuinely depends on the sound before it,
  // so those are always flagged ambiguous.
  const SUFFIXES = [
    { text: 'tion', phoneme: '/shŭn/' },
    { text: 'sion', phoneme: '/zhŭn/' },
    { text: 'ness', phoneme: '/nĭs/' },
    { text: 'ment', phoneme: '/mənt/' },
    { text: 'ful', phoneme: '/fəl/' },
    { text: 'less', phoneme: '/lĭs/' },
    { text: 'able', phoneme: '/əbəl/' },
    { text: 'ible', phoneme: '/əbəl/' },
    { text: 'ing', phoneme: '/ĭng/' },
    { text: 'est', phoneme: '/ĭst/' },
    { text: 'ed', phoneme: '/d/', ambiguous: true },
    { text: 'er', phoneme: '/er/' },
    { text: 'ly', phoneme: '/lē/' },
    { text: 'es', phoneme: '/ĭz/', ambiguous: true },
    { text: 's', phoneme: '/s/', ambiguous: true }
  ];

  function cleanWord(word) {
    return String(word || '').toLowerCase().replace(/[^a-z]/g, '');
  }

  // Peel one recognized suffix off the end of the word, if present.
  // Guards against false positives like "grass" (ends in the FLSZ pattern
  // "ss", not the suffix "-s") and against peeling from a stem with no
  // vowel (which wouldn't be a real base word).
  function peelSuffix(w) {
    for (const suf of SUFFIXES) {
      if (w.length - suf.text.length < 2) continue;
      if (!w.endsWith(suf.text)) continue;
      const stem = w.slice(0, w.length - suf.text.length);
      if ((suf.text === 's' || suf.text === 'es') && /([a-z])\1$/.test(stem)) continue;
      if (!/[aeiouy]/.test(stem)) continue;
      return { stem, suffix: suf };
    }
    return null;
  }

  // Detect a classic CVCe pattern (cake, hope, cute) so the final "e" can
  // be pulled outside the sound boxes as silent, matching how
  // letterbox-lesson.html already displays vetted long-vowel words.
  function detectSilentE(stem) {
    if (stem.length < 3 || !stem.endsWith('e')) return null;
    const beforeE = stem[stem.length - 2];
    if (SHORT_VOWELS[beforeE] || !CONSONANTS[beforeE]) return null; // needs a consonant right before the e
    const base = stem.slice(0, -1);
    if (!/[aeiouy]/.test(base)) return null; // base still needs its own vowel
    return base;
  }

  // Greedy longest-match tokenizer: walks left to right trying 3-letter,
  // then 2-letter, then 1-letter known patterns. Mirrors the segmentation
  // approach already used in phoneme-counter.html's rule tables, extended
  // to run on the whole word (not just a bank-confirmed vowel position).
  function tokenizeCore(text) {
    const tokens = [];
    let i = 0;
    while (i < text.length) {
      const three = text.slice(i, i + 3);
      const two = text.slice(i, i + 2);
      const one = text[i];

      if (TRIGRAPHS[three]) {
        tokens.push({ text: three, phoneme: TRIGRAPHS[three], kind: 'consonant' });
        i += 3; continue;
      }
      if (VOWEL_UNITS[two]) {
        const unit = VOWEL_UNITS[two];
        tokens.push({ text: two, phoneme: unit.phoneme, kind: 'vowel', ambiguous: !!unit.ambiguous });
        i += 2; continue;
      }
      if (i === 0 && INITIAL_CLUSTERS[two]) {
        tokens.push({ text: two, phoneme: INITIAL_CLUSTERS[two], kind: 'consonant' });
        i += 2; continue;
      }
      if (i === text.length - 2 && FINAL_CLUSTERS[two]) {
        tokens.push({ text: two, phoneme: FINAL_CLUSTERS[two], kind: 'consonant' });
        i += 2; continue;
      }
      if (DIGRAPHS[two]) {
        tokens.push({ text: two, phoneme: DIGRAPHS[two], kind: 'consonant' });
        i += 2; continue;
      }
      if (i === text.length - 2 && FLSZ[two]) {
        tokens.push({ text: two, phoneme: FLSZ[two], kind: 'consonant' });
        i += 2; continue;
      }
      if (two === 'qu') {
        tokens.push({ text: 'qu', phoneme: '/kw/', kind: 'consonant' });
        i += 2; continue;
      }
      if (SHORT_VOWELS[one]) {
        tokens.push({ text: one, phoneme: SHORT_VOWELS[one], kind: 'vowel' });
        i += 1; continue;
      }
      if (one === 'y') {
        const isFinal = i === text.length - 1;
        const phoneme = isFinal ? (text.length <= 4 ? '/ī/' : '/ē/') : '/ĭ/';
        tokens.push({ text: one, phoneme, kind: 'vowel', ambiguous: true });
        i += 1; continue;
      }
      tokens.push({ text: one, phoneme: CONSONANTS[one] || `/${one}/`, kind: 'consonant', unmatched: !CONSONANTS[one] });
      i += 1;
    }
    return tokens;
  }

  /**
   * Estimate syllable breaks from spelling alone, using the classic
   * elementary-school VC/CV rules (0 medial consonants: split between the
   * vowels; 1: split before it, giving an open first syllable; 2+: split
   * after the first one). Runs on the whole word directly — it does not
   * use the suffix-peeling/silent-e logic that generateMapping() uses for
   * building phoneme boxes, since dividing spelling into syllables and
   * building sound boxes are different concerns.
   *
   * Returns { word, syllables, dividerPositions, isMultisyllabic }.
   * dividerPositions are character indices into `word`: a divider at
   * position P sits between word[P-1] and word[P].
   */
  function analyzeSyllables(rawWord) {
    const w = cleanWord(rawWord);
    if (!w) return { word: w, syllables: w ? [w] : [], dividerPositions: [], isMultisyllabic: false };

    // A trailing silent e (cake, hope, time…) doesn't add a syllable of
    // its own. Count vowel nuclei on the word with that "e" dropped, but
    // keep using the full word (so the "e" stays attached to the last
    // syllable) when actually slicing syllable text below.
    const silentBase = detectSilentE(w);
    const countingWord = silentBase || w;

    const tokens = tokenizeCore(countingWord);
    let pos = 0;
    const withPos = tokens.map(t => {
      const start = pos;
      pos += t.text.length;
      return { ...t, start, end: pos };
    });
    const vowelTokens = withPos.filter(t => t.kind === 'vowel');

    if (vowelTokens.length <= 1) {
      return { word: w, syllables: [w], dividerPositions: [], isMultisyllabic: false };
    }

    const dividerPositions = [];
    for (let i = 0; i < vowelTokens.length - 1; i++) {
      const v1 = vowelTokens[i];
      const v2 = vowelTokens[i + 1];
      // Count consonant TOKENS between the vowels, not characters — a
      // digraph like "ph" is one indivisible unit regardless of its
      // 2-letter length. Counting characters here used to let the VC/CV
      // math land a divider inside a digraph (e.g. splitting "ph" into
      // "p"+"h" across a syllable boundary in "elephant").
      const between = withPos.filter(t => t.start >= v1.end && t.end <= v2.start);
      let dividerAt;
      if (between.length === 0) {
        dividerAt = v1.end; // two vowel sounds back to back — split between them
      } else if (between.length === 1) {
        dividerAt = v1.end; // V / CV — open syllable, consonant token joins the next syllable
      } else {
        dividerAt = between[0].end; // VC / CV(...) — first consonant TOKEN closes the syllable before it
      }
      // Keep dividers in bounds and strictly increasing.
      dividerAt = Math.max(1, Math.min(w.length - 1, dividerAt));
      const prev = dividerPositions[dividerPositions.length - 1];
      if (prev === undefined || dividerAt > prev) dividerPositions.push(dividerAt);
    }

    const bounds = [0, ...dividerPositions, w.length];
    const syllables = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const chunk = w.slice(bounds[i], bounds[i + 1]);
      if (chunk) syllables.push(chunk);
    }

    return { word: w, syllables, dividerPositions, isMultisyllabic: syllables.length > 1 };
  }

  /**
   * Rebuild a { syllables, dividerPositions } pair from a caller-edited
   * set of divider positions (e.g. from the syllable-divider UI). Used so
   * the UI only has to track positions and can ask the engine to turn
   * that back into syllable strings.
   */
  function syllablesFromDividers(rawWord, dividerPositions) {
    const w = cleanWord(rawWord);
    const sorted = [...new Set(dividerPositions)]
      .filter(p => p > 0 && p < w.length)
      .sort((a, b) => a - b);
    const bounds = [0, ...sorted, w.length];
    const syllables = [];
    for (let i = 0; i < bounds.length - 1; i++) {
      const chunk = w.slice(bounds[i], bounds[i + 1]);
      if (chunk) syllables.push(chunk);
    }
    return { word: w, syllables, dividerPositions: sorted, isMultisyllabic: syllables.length > 1 };
  }

  /**
   * Generate a best-guess sound-box mapping for an arbitrary word.
   * Returns null only if the input has no letters at all.
   * Intended for words already confirmed single-syllable (see
   * analyzeSyllables) — for a multisyllable word, map each syllable
   * separately instead of the whole word at once.
   */
  function generateMapping(rawWord) {
    const w = cleanWord(rawWord);
    if (!w) return null;

    const notes = [];
    let stem = w;
    let suffixToken = null;

    const peeled = peelSuffix(w);
    if (peeled) {
      stem = peeled.stem;
      suffixToken = {
        text: peeled.suffix.text,
        phoneme: peeled.suffix.phoneme,
        kind: 'suffix',
        ambiguous: !!peeled.suffix.ambiguous
      };
      notes.push(`"${peeled.suffix.text}" was treated as a word ending — check that this matches the base word you meant.`);
    }

    let outsideE = false;
    const silentBase = detectSilentE(stem);
    if (silentBase) {
      stem = silentBase;
      outsideE = true;
    }

    const coreTokens = tokenizeCore(stem);

    // A silent final e makes the preceding vowel long (cake -> /ā/, not
    // /ă/). This is a reliable, unambiguous rule, so apply it to the
    // single-letter vowel token nearest the dropped e.
    if (outsideE) {
      for (let i = coreTokens.length - 1; i >= 0; i--) {
        const t = coreTokens[i];
        if (t.kind === 'vowel' && t.text.length === 1 && LONG_VOWELS[t.text]) {
          coreTokens[i] = { ...t, phoneme: LONG_VOWELS[t.text] };
          break;
        }
      }
    }

    const allTokens = suffixToken ? [...coreTokens, suffixToken] : coreTokens;

    const graphemes = allTokens.map(t => t.text);
    const phonemes = allTokens.map(t => t.phoneme);
    const boxes = graphemes.slice();
    const outsideLetters = outsideE ? ['e'] : [];

    const hasAmbiguous = allTokens.some(t => t.ambiguous) || coreTokens.some(t => t.unmatched);
    const isMultisyllabic = analyzeSyllables(w).isMultisyllabic;

    let confidence = 'high';
    if (isMultisyllabic || hasAmbiguous || suffixToken) confidence = 'low';

    if (isMultisyllabic) notes.push('This word has more than one vowel sound — double-check the syllable/box split.');
    if (hasAmbiguous) notes.push('Some letters here can represent more than one sound — check against how your students actually say it.');

    const boxCount = phonemes.length;
    const note = notes.length
      ? `Auto-generated mapping — please review. ${notes.join(' ')}`
      : `Auto-generated mapping — please review. Use ${boxCount} sound box${boxCount === 1 ? '' : 'es'}${outsideLetters.length ? ' plus silent e' : ''}.`;

    return {
      word: w,
      graphemes,
      phonemes,
      boxes,
      outsideLetters,
      phonemeCount: boxCount,
      confidence,
      source: 'generated',
      note
    };
  }

  // ---- Pronunciation/syllable-count support (CMUdict) --------------------
  // Zero runtime dependency: no network call lives in this module. A host
  // page loads a (static, offline, public-domain) CMUdict-derived dataset
  // and hands it to us via loadPronunciationData(). Nothing here fetches
  // anything itself, so there's no paid API and no ongoing cost — if no
  // data is ever loaded, generateWordMapping() below simply falls back to
  // the spelling-only heuristic, exactly as it already does today.
  //
  // Accepted shape: { word: "EH1 L AH0 F AH0 N T", ... } — the exact
  // whitespace-separated ARPABET format CMUdict itself uses, one entry per
  // word, lowercase keys. A pre-parsed { word: ['EH1','L',...] } shape is
  // accepted too.
  let PRONUNCIATIONS = null;

  function loadPronunciationData(dict) {
    PRONUNCIATIONS = dict && typeof dict === 'object' ? dict : null;
  }

  function getPhones(word) {
    if (!PRONUNCIATIONS) return null;
    const entry = PRONUNCIATIONS[word];
    if (!entry) return null;
    return Array.isArray(entry) ? entry : String(entry).trim().split(/\s+/);
  }

  // Ordered list of { base, stress } for each vowel phone in the word's
  // CMUdict pronunciation (consonant phones carry no stress digit and are
  // skipped). Returns null when the word isn't in the loaded dataset.
  function getVowelStressSequence(word) {
    const phones = getPhones(word);
    if (!phones) return null;
    const out = [];
    for (const phone of phones) {
      const m = /^([A-Z]+)([0-2])$/.exec(phone);
      if (m) out.push({ base: m[1], stress: m[2] });
    }
    return out;
  }

  // Curated corrections for common words where the spelling-only heuristic
  // is known to guess wrong — specifically the class of word where a
  // single medial consonant *looks* like it should open the next syllable
  // (giving a long vowel) but the vowel is actually short/checked, which
  // genuinely can't be told from spelling alone (camel, not "ca-mel";
  // cabin, not "ca-bin"). Grown by hand over time, the same way the
  // curated word bank itself is maintained — not machine-generated.
  const SYLLABLE_EXCEPTIONS = {
    elephant: ['el', 'e', 'phant'],
    camel: ['cam', 'el'],
    cabin: ['cab', 'in'],
    dragon: ['drag', 'on'],
    wagon: ['wag', 'on'],
    city: ['cit', 'y'],
    kitchen: ['kitch', 'en'],
    seven: ['sev', 'en'],
    animal: ['an', 'i', 'mal']
  };

  // Curated schwa assignments: which syllable INDEX (0-based, into the
  // split above) genuinely gets the learner-facing /ə/ symbol. CMUdict's
  // AH0 reduction is real pronunciation evidence, but it's broader than
  // what Literacy Arcade wants to teach — e.g. CMUdict also reduces
  // rabbit's and cabin's second syllable toward AH0, but those stay a
  // plain short i for instruction. So schwa is explicit/hand-curated here,
  // the same way SYLLABLE_EXCEPTIONS is, not auto-promoted from CMUdict.
  const SCHWA_SYLLABLES = {
    elephant: [1, 2], // the lone "e" syllable, and the "a" in "phant"
    camel: [1],       // "el"
    kitchen: [1]       // "en"
  };

  // One-off corrections for specific words whose real pronunciation the
  // spelling-only rules can't derive (irregular spelling, or a fallback
  // heuristic guessing wrong in that particular word). Keyed by word, then
  // by the exact grapheme text to override within it.
  const PHONEME_OVERRIDES = {
    comb: { o: '/ō/' },  // long o with no magic e — irregular, like tomb/womb
    city: { y: '/ē/' }   // final unstressed -y — not the isolated-letter /ī/ default
  };

  /**
   * The full custom-word orchestrator: built-in bank precedence is handled
   * by the caller (this function never sees a word the vetted bank already
   * has — see phoneme-counter.html's routing). For everything else:
   *   curated exception → CMUdict-informed syllable split → spelling-only
   *   heuristic, then per-syllable grapheme/phoneme mapping (reusing
   *   generateMapping() unchanged), then a schwa correction pass using
   *   real CMUdict pronunciation data where available.
   *
   * Returns { word, syllables: [{ text, graphemes:[{letters,phoneme}],
   * outside:[{letters}] }], confidence, source, syllableCountMatchesCmudict,
   * note } — the syllables shape described in the Stage 6 plan. A
   * single-syllable word still returns syllables.length === 1; callers
   * decide whether that collapses to a flat display.
   */
  function generateWordMapping(rawWord) {
    const w = cleanWord(rawWord);
    if (!w) return null;

    let syllableTexts;
    let syllableSource = 'heuristic';
    const vowelStressSeq = getVowelStressSequence(w);
    const heuristic = analyzeSyllables(w);

    if (SYLLABLE_EXCEPTIONS[w]) {
      syllableTexts = SYLLABLE_EXCEPTIONS[w].slice();
      syllableSource = 'exception';
    } else {
      syllableTexts = heuristic.syllables;
    }

    const cmuCount = vowelStressSeq ? vowelStressSeq.length : null;
    const syllableCountMatchesCmudict = cmuCount === null ? null : (cmuCount === syllableTexts.length);

    let allHigh = true;
    const notes = [];
    const syllables = syllableTexts.map((text, idx) => {
      const mapped = generateMapping(text);
      if (!mapped) { allHigh = false; return { text, graphemes: [], outside: [] }; }
      if (mapped.confidence !== 'high') allHigh = false;

      // Schwa is curated (SCHWA_SYLLABLES), not auto-promoted from CMUdict
      // — see the note on that table. Only overrides a plain single-letter
      // vowel that would otherwise default to a short-vowel symbol.
      const phonemes = mapped.phonemes.slice();
      if (SCHWA_SYLLABLES[w] && SCHWA_SYLLABLES[w].includes(idx)) {
        const gi = mapped.graphemes.findIndex((g, i) => g.length === 1 && SHORT_VOWELS[g] && phonemes[i] === SHORT_VOWELS[g]);
        if (gi !== -1) phonemes[gi] = SCHWA;
      }

      // One-off pronunciation overrides for specific irregular words.
      const overrides = PHONEME_OVERRIDES[w];
      if (overrides) {
        mapped.graphemes.forEach((g, i) => {
          if (overrides[g] !== undefined) phonemes[i] = overrides[g];
        });
      }

      const graphemes = mapped.graphemes.map((g, i) => ({ letters: g, phoneme: phonemes[i] }));
      const outside = mapped.outsideLetters.map(l => ({ letters: l }));
      return { text: mapped.word, graphemes, outside };
    });

    if (syllableSource === 'exception') allHigh = true; // human-curated, trusted like the vetted bank
    if (syllableCountMatchesCmudict === false) allHigh = false; // real, known disagreement

    if (syllableTexts.length > 1) notes.push(`${syllableTexts.length} syllables — check the split and each box.`);
    if (syllableCountMatchesCmudict === false) notes.push(`Pronunciation data suggests ${cmuCount} syllable${cmuCount === 1 ? '' : 's'} instead of ${syllableTexts.length} — please check.`);

    return {
      word: w,
      syllables,
      confidence: allHigh ? 'high' : 'low',
      source: syllableSource === 'exception' ? 'exception' : 'generated',
      syllableCountMatchesCmudict,
      note: notes.length ? `Auto-generated mapping — please review. ${notes.join(' ')}` : 'Auto-generated mapping — please review.'
    };
  }

  // Shapes a generateMapping() result (or a vetted mapWord() result) down
  // to exactly the fields letterbox-lesson.html's normalizeLesson() reads:
  // word, phonemes, boxes, outsideLetters.
  function toLetterboxWord(mapping) {
    if (!mapping) return null;
    return {
      word: mapping.word,
      phonemes: mapping.phonemes,
      boxes: mapping.boxes,
      outsideLetters: mapping.outsideLetters || []
    };
  }

  // Best-guess phoneme label for an arbitrary grapheme string (one sound
  // box's current letters, however a teacher has grouped them). Used by a
  // correction editor so a box's phoneme label always updates automatically
  // after a merge/split/move — nobody ever has to type a phoneme or IPA.
  function phonemeForGrapheme(text) {
    const g = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!g) return '';
    if (TRIGRAPHS[g]) return TRIGRAPHS[g];
    if (VOWEL_UNITS[g]) return VOWEL_UNITS[g].phoneme;
    if (INITIAL_CLUSTERS[g]) return INITIAL_CLUSTERS[g];
    if (FINAL_CLUSTERS[g]) return FINAL_CLUSTERS[g];
    if (DIGRAPHS[g]) return DIGRAPHS[g];
    if (FLSZ[g]) return FLSZ[g];
    if (g === 'qu') return '/kw/';
    if (g.length === 1 && SHORT_VOWELS[g]) return SHORT_VOWELS[g];
    if (g.length === 1 && CONSONANTS[g]) return CONSONANTS[g];
    return `/${g}/`; // unrecognized combo — same generic fallback used sitewide
  }

  global.PhonemeMappingEngine = {
    generateMapping,
    generateWordMapping,
    analyzeSyllables,
    syllablesFromDividers,
    loadPronunciationData,
    toLetterboxWord,
    phonemeForGrapheme,
    cleanWord
  };
})(typeof window !== 'undefined' ? window : globalThis);
