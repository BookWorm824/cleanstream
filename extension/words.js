// CleanView's word finder (cvcore.find_language and friends), for CleanStream.
// The word lists come from words_data.js (made from CleanView by tools/sync_words.py);
// this file is the logic around them, kept the same as cvcore.py. tools/check_words.py
// checks both find the same words.
(function () {
  const W = globalThis.CV_WORDS;
  const set = a => new Set(a);
  const setsOf = d => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, new Set(v)]));
  // Python's  re.compile(p + "$").match(w)  is  ^(?:p$)  in JavaScript
  const full = list => list.map(p => new RegExp("^(?:" + p + "$)"));
  const start = list => list.map(p => new RegExp("^(?:" + p + ")"));

  const CATS = { strong: full(W.STRONG), moderate: full(W.MODERATE), mild: full(W.MILD),
    minced: full(W.MINCED), deity: full(W.DEITY_WORDS), samesex: full(W.SAMESEX_WORDS),
    rude: full(W.RUDE) };
  const SEX3 = full(W.SEX_TERMS_3);
  const NEVER_FINE = full(W.NEVER_FINE), ALWAYS_REMOVED = full(W.ALWAYS_REMOVED);
  const BODY_SLANG = start(W.BODY_SLANG), MILD_SLANG = start(W.MILD_SLANG),
    MINCED_SLANG = start(W.MINCED_SLANG);
  const REVERENT_BEFORE = set(W.REVERENT_BEFORE), REVERENT_NEXT = set(W.REVERENT_NEXT),
    REVERENT_IS = set(W.REVERENT_IS);
  const INNOCENT_NEXT = setsOf(W.INNOCENT_NEXT), INNOCENT_PREV = setsOf(W.INNOCENT_PREV);
  const SHUT_UP_SAFE_NEXT = set(W.SHUT_UP_SAFE_NEXT), BULL_SWEAR_NEXT = set(W.BULL_SWEAR_NEXT),
    BULL_NOT_NEXT = set(W.BULL_NOT_NEXT), BULL_BEFORE = new RegExp(W.BULL_BEFORE);
  const SQUAT_BEFORE = set(W.SQUAT_BEFORE), SQUAT_NOT_NEXT = set(W.SQUAT_NOT_NEXT);
  const SUCK_WORDS = set(W.SUCK_WORDS), SUCK_NOT_NEXT = set(W.SUCK_NOT_NEXT),
    SUCK_NOT_BEFORE = set(W.SUCK_NOT_BEFORE);
  const SCREW_NOUN_AFTER = set(W.SCREW_NOUN_AFTER), GAY_HAPPY = set(W.GAY_HAPPY);
  const PHRASE_OBJECTS = set(W.PHRASE_OBJECTS), NOT_RUDE_NEXT = set(W.NOT_RUDE_NEXT);
  const BLOODY_SWEAR_NEXT = set(W.BLOODY_SWEAR_NEXT), UP_YOURS_NOT_AFTER = set(W.UP_YOURS_NOT_AFTER);
  const GOD_NOT_OATH = set(W.GOD_NOT_OATH), KNOWS_NOT_OATH = set(W.KNOWS_NOT_OATH),
    HELP_NOT_OATH = set(W.HELP_NOT_OATH), MY_GOD_AFTER = set(W.MY_GOD_AFTER),
    CALL_YOU = set(W.CALL_YOU), FREAK_WORDS = set(W.FREAK_WORDS), LEAD_IN = set(W.LEAD_IN);
  // rules added in CleanView 2026-11-14..17 (cvcore: shut_up_closed, suck_food, SCREW_FACE,
  // fool_called, dumb_called, jerk_motion, pussy_cat, old_word_innocent)
  const CONTRACTED = W.CONTRACTED;
  const SHUT_UP_CLOSED_PREV = set(W.SHUT_UP_CLOSED_PREV), SUCK_FOOD = set(W.SUCK_FOOD),
    SCREW_FACE_WORDS = set(W.SCREW_FACE_WORDS), FOOL_NOUN_PREV = set(W.FOOL_NOUN_PREV),
    DUMB_CALLED_PREV = set(W.DUMB_CALLED_PREV), JERK_MOTION_NEXT = set(W.JERK_MOTION_NEXT),
    JERK_PERSON_NEXT = set(W.JERK_PERSON_NEXT), JERK_GIVE = set(W.JERK_GIVE),
    JERK_CALLED_BEFORE = set(W.JERK_CALLED_BEFORE), PUSSY_WORDS = set(W.PUSSY_WORDS),
    PUSSY_CAT_NEXT = set(W.PUSSY_CAT_NEXT), CAT_WORDS = set(W.CAT_WORDS),
    PUSSY_INSULT_BEFORE = set(W.PUSSY_INSULT_BEFORE), PUSSY_CAT_REACH = W.PUSSY_CAT_REACH,
    ASS_ANIMAL_NEAR = set(W.ASS_ANIMAL_NEAR), ASS_INSULT_BEFORE = set(W.ASS_INSULT_BEFORE),
    ASS_BODY_BEFORE = set(W.ASS_BODY_BEFORE), ASS_ANIMAL_STRONG = set(W.ASS_ANIMAL_STRONG),
    FAGGOT_WOOD = set(W.FAGGOT_WOOD), BOOBY_BIRDS = set(W.BOOBY_BIRDS),
    STUPID_DAZED_NEXT = set(W.STUPID_DAZED_NEXT), STUPID_DAZED_PREV = set(W.STUPID_DAZED_PREV),
    COON_WORDS = set(W.COON_WORDS), COON_INSULT_BEFORE = set(W.COON_INSULT_BEFORE),
    COON_REACH = W.COON_REACH, THANK_GOD_AND = set(W.THANK_GOD_AND);
  const byLen = list => [...list].sort((a, b) => b.length - a.length);   // stable, as sorted()
  const DEITY = byLen(W.DEITY_PHRASES), RUDE_PH = byLen(W.RUDE_PHRASES), CRUDE = W.CRUDE_PHRASES;

  // ---------- normalising a word: bleeps, abbreviations, punctuation ----------
  const BLEEP = /[*#]|[@$%&!]{2,}|(?<=[a-z])-{2,}(?=[a-z])/;
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripP = (s, chars) => {
    let a = 0, b = s.length;
    while (a < b && chars.includes(s[a])) a++;
    while (b > a && chars.includes(s[b - 1])) b--;
    return s.slice(a, b);
  };

  function unbleep(w) {
    const t = stripP(w.toLowerCase(), ".,!?;:\"'()[]");
    if (!BLEEP.test(t)) return w;
    if (!t.replace(/[*#@$%&!-]/g, "") &&
        (t.length < 3 || [...new Set(t)].filter(c => "#@$%&".includes(c)).length < 2)) return w;
    const parts = t.split(/([*#@$%&!-]+)/).filter(Boolean);
    for (const exact of [true, false]) {
      const pat = new RegExp("^(?:" + parts.map(p => /^[*#@$%&!-]+$/.test(p)
        ? (exact ? `[a-z]{${p.length}}` : "[a-z]+") : esc(p)).join("") + ")$");
      const found = W.BLEEPED.filter(b => pat.test(b));
      if (found.length) return found.find(b => b.length === t.length) || found[0];
    }
    return w;
  }

  const ABBR = W.ABBREVIATIONS.map(([p, full]) => [new RegExp("^(?:" + p + ")$"), full]);
  function unabbreviate(w) {
    let core = stripP(w, ".,!?;:\"()[]").replace(/’/g, "'");
    if (core.endsWith(".") && core.split(".").length === 2) core = core.slice(0, -1);
    for (const [pat, full] of ABBR)
      if (pat.test(core) || pat.test(core.replace(/\.+$/, ""))) return full;
    return w;
  }

  function norm(w) {
    w = unbleep(unabbreviate(w)).toLowerCase().replace(/[’‘]/g, "'");
    return stripP(w.replace(/[^a-z0-9']/g, ""), "'");
  }
  // cvcore._base: possessive 's off, and a joined-on 'd, 'll, 're or 've ("hell'd")
  const base = w => {
    for (const end of CONTRACTED) if (w.endsWith(end) && w.length > end.length + 1) return w.slice(0, -end.length);
    return w;
  };
  const near = (words, a, b) => new Set(words.slice(Math.max(0, a), b));
  const anyIn = (s, words) => words.some(x => s.has(x));
  const at = (words, i, p) => p.every((x, k) => words[i + k] === x);

  // ---------- the checks around single words ----------
  function reverent(words, i, j) {
    j = j || i + 1;
    const prev = i ? words[i - 1] : "", two = i > 1 ? words[i - 2] : "";
    const nxt = j < words.length ? words[j] : "";
    if (["my", "sweet", "dear"].includes(prev) && two === "oh") return false;
    if (prev === "dear" && two === "please") return true;
    if (prev === "by" && ["swear", "swears", "swore", "sworn", "swearing"].includes(two)) return false;
    if (prev === "baby" || prev === "infant") return two !== "sweet";   // "the baby Jesus"
    if (nxt === "child") return prev === "the";                           // "the Christ child"
    if (words.slice(Math.max(0, i - 4), i).some(x => x === "name" || x === "named")) return true;
    if (nxt === "is" || nxt === "was") return REVERENT_IS.has(j + 1 < words.length ? words[j + 1] : "");
    return REVERENT_BEFORE.has(prev) || REVERENT_NEXT.has(nxt) || (two === "thank" && prev === "you");
  }

  function prayer(words, i, ph) {
    const j = i + ph.length, after = words.slice(j, j + 3);
    const prev = i ? words[i - 1] : "", two = i > 1 ? words[i - 2] : "";
    const p = ph.join(" "), last = ph[ph.length - 1];
    if (ph.length >= 2 && ph[ph.length - 2] === "help" && after.length && HELP_NOT_OATH.has(after[0])) return true;
    if ((last === "god" || last === "lord") && after[0] === "help" && after[1] === "me" &&
        after.length === 3 && HELP_NOT_OATH.has(after[2])) return true;
    if ((p === "dear god" || p === "dear lord") && prev === "please") return true;
    // "Thank God and seek faith." (CleanView 1.18.133, Christy)
    if ((p === "thank god" || p === "thank the lord") && after[0] === "and" &&
        after.length > 1 && THANK_GOD_AND.has(after[1])) return true;
    if (p === "my god" && (MY_GOD_AFTER.has(prev) || CALL_YOU.has(two + " " + prev))) return true;
    return false;
  }

  const suckFood = (words, i) => anyIn(SUCK_FOOD, words.slice(Math.max(0, i - 12), i + 13));
  const shutUpClosed = prev => SHUT_UP_CLOSED_PREV.has(prev) || prev.endsWith("'s") || prev.endsWith("’s");
  const foolCalled = (wb, prev, nxt) => wb === "fool" && nxt !== "of" && FOOL_NOUN_PREV.has(prev);
  const dumbCalled = (wb, prev) => wb === "dumb" && DUMB_CALLED_PREV.has(prev);

  function jerkMotion(words, i) {
    if (words[i] !== "jerk" && words[i] !== "jerks") return false;
    if (i >= 2 && (words[i - 1] === "a" || words[i - 1] === "an") && JERK_CALLED_BEFORE.has(words[i - 2])) return false;
    const nxt = i + 1 < words.length ? words[i + 1] : "", nxt2 = i + 2 < words.length ? words[i + 2] : "";
    if (JERK_MOTION_NEXT.has(nxt))
      return !((nxt === "of" && (nxt2 === "a" || nxt2 === "an")) || (nxt === "at" && nxt2 === "times"));
    if (JERK_PERSON_NEXT.has(nxt)) return false;
    const a = i >= 1 && (words[i - 1] === "a" || words[i - 1] === "one") ? i - 1
      : i >= 2 && (words[i - 2] === "a" || words[i - 2] === "one") ? i - 2 : -1;
    if (a < 0) return false;
    return (a >= 1 && words[a - 1] === "with") || anyIn(JERK_GIVE, words.slice(Math.max(0, a - 3), a));
  }

  function pussyCat(words, i) {
    if (!PUSSY_WORDS.has(words[i])) return false;
    if (PUSSY_CAT_NEXT.has(i + 1 < words.length ? words[i + 1] : "")) return true;
    if (PUSSY_INSULT_BEFORE.has(i ? words[i - 1] : "")) return false;
    const around = words.slice(Math.max(0, i - PUSSY_CAT_REACH), i)
      .concat(words.slice(i + 1, i + 1 + PUSSY_CAT_REACH));
    return anyIn(CAT_WORDS, around);
  }

  function assAnimal(words, i) {
    const prev = i ? words[i - 1] : "";
    if (ASS_BODY_BEFORE.has(prev) || prev.endsWith("'s") || prev.endsWith("’s"))
      return anyIn(ASS_ANIMAL_STRONG, words.slice(Math.max(0, i - 15), i + 16));
    if (ASS_INSULT_BEFORE.has(prev) && !(prev === "an" &&
        anyIn(ASS_ANIMAL_NEAR, words.slice(Math.max(0, i - 12), i)))) return false;
    return anyIn(ASS_ANIMAL_NEAR, words.slice(Math.max(0, i - 15), i + 16));
  }

  const DAZED_WITH = new Set(["astonishment", "amazement", "grief", "fear", "sleep", "cold", "terror",
    "wonder", "drink", "fatigue"]);
  function stupidDazed(words, i) {
    const nxt = i + 1 < words.length ? words[i + 1] : "", nxt2 = i + 2 < words.length ? words[i + 2] : "";
    if (nxt === "with") return (STUPID_DAZED_NEXT.has(nxt2) && nxt2 !== "with") || DAZED_WITH.has(nxt2);
    return STUPID_DAZED_NEXT.has(nxt) || STUPID_DAZED_PREV.has(i ? words[i - 1] : "");
  }

  // the raccoon (CleanView 1.18.133, cvcore.coon_animal): raccoon words close by, not said at someone
  function coonAnimal(words, i) {
    if (COON_INSULT_BEFORE.has(i ? words[i - 1] : "")) return false;
    const around = words.slice(Math.max(0, i - COON_REACH), i).concat(words.slice(i + 1, i + 1 + COON_REACH));
    return anyIn(COON_WORDS, around);
  }

  function oldWordInnocent(words, i, wb) {
    const around = near(words, i - 10, i + 11);
    const meets = s => [...s].some(x => around.has(x));
    return ((wb === "ass" || wb === "asses") && assAnimal(words, i)) ||
      ((wb === "coon" || wb === "coons") && coonAnimal(words, i)) ||
      ((wb === "faggot" || wb === "faggots") && meets(FAGGOT_WOOD)) ||
      ((wb === "boobies" || wb === "booby") && meets(BOOBY_BIRDS)) ||
      (wb === "stupid" && stupidDazed(words, i));
  }

  function suckSwear(words, i) {
    if (!SUCK_WORDS.has(words[i]) || (i && SUCK_NOT_BEFORE.has(words[i - 1])) || suckFood(words, i)) return false;
    return !SUCK_NOT_NEXT.has(i + 1 < words.length ? words[i + 1] : "");
  }
  function squatSwear(words, i) {
    if (words[i] !== "squat" || !i || !SQUAT_BEFORE.has(words[i - 1])) return false;
    return !SQUAT_NOT_NEXT.has(i + 1 < words.length ? words[i + 1] : "");
  }
  function bullSwear(words, i) {
    if (words[i] !== "bull") return false;
    const nxt = i + 1 < words.length ? words[i + 1] : "";
    if (BULL_SWEAR_NEXT.has(nxt)) return true;
    return !BULL_NOT_NEXT.has(nxt) && BULL_BEFORE.test(words.slice(Math.max(0, i - 3), i).join(" "));
  }
  function bodySlang(words, i, pats = BODY_SLANG) {
    const text = words.slice(i, i + 8).join(" ");
    for (const p of pats) {
      const m = p.exec(text);
      if (m && (m[0].length === text.length || text[m[0].length] === " "))
        return m[0].split(/\s+/).filter(Boolean).length;
    }
    return 0;
  }
  function gayHappy(words, i) {
    const before = i >= 2 && words[i - 1] === "and" && GAY_HAPPY.has(words[i - 2]);
    const after = i + 2 < words.length && words[i + 1] === "and" && GAY_HAPPY.has(words[i + 2]);
    return before || after;
  }
  function screwNoun(words, i) {
    if (!i) return false;
    const prev = words[i - 1];
    return SCREW_NOUN_AFTER.has(prev) || (prev.length > 4 && prev.endsWith("est") &&
      prev !== "honest" && prev !== "modest");
  }

  /** Spans [i, j, category] of words[i:j] to mute. words are normalised (norm()). */
  function findLanguage(words, cats, mine = []) {
    const hits = [], n = words.length;
    const seen = new Set();
    mine = byLen(mine.filter(p => { const k = p.join(" "); return !seen.has(k) && seen.add(k); }));
    const has = c => cats.includes(c);
    const mildCat = () => (has("mild") ? "mild" : "moderate");
    let i = 0;
    const rudeUse = p => {
      const nxt = i + p.length < n ? words[i + p.length] : "";
      if (p.length === 2 && p[0] === "shut" && p[1] === "up" &&
          (SHUT_UP_SAFE_NEXT.has(nxt) || shutUpClosed(i ? words[i - 1] : ""))) return false;
      if (SUCK_WORDS.has(p[p.length - 1]) && SUCK_NOT_NEXT.has(nxt)) return false;
      if (SUCK_WORDS.has(p[0]) && suckFood(words, i)) return false;      // "began to suck it"
      if (p[0] === "screw" && SCREW_FACE_WORDS.has(nxt)) return false;   // "screw her face up"
      return !PHRASE_OBJECTS.has(p[p.length - 1]) || !NOT_RUDE_NEXT.has(nxt);
    };
    const take = (len, cat) => { hits.push([i, i + len, cat]); i += len; };
    while (i < n) {
      let ph = mine.find(p => at(words, i, p));
      if (ph) { take(ph.length, "mine"); continue; }
      if (has("deity")) {
        ph = DEITY.find(p => at(words, i, p));
        if (ph && ph.join(" ") === "jesus christ" && reverent(words, i, i + 2)) ph = null;
        if (ph && ph[ph.length - 1] === "god" && i + ph.length < n && GOD_NOT_OATH.has(words[i + ph.length])) ph = null;
        const nxt = ph && i + ph.length < n ? words[i + ph.length] : "";
        if (ph && ((ph[ph.length - 1] === "knows" && KNOWS_NOT_OATH.has(nxt)) || prayer(words, i, ph))) ph = null;
        if (ph) { take(ph.length, "deity"); continue; }
      }
      let k = has("moderate") ? bodySlang(words, i) : 0;
      if (k) { take(k, "moderate"); continue; }
      k = has("minced") ? bodySlang(words, i, MINCED_SLANG) : 0;
      if (k) { take(k, "minced"); continue; }
      k = (has("mild") || has("moderate")) ? bodySlang(words, i, MILD_SLANG) : 0;
      if (k && words[i] === "up" && i && UP_YOURS_NOT_AFTER.has(words[i - 1])) k = 0;
      if (k) { take(k, mildCat()); continue; }
      if ((has("mild") || has("moderate")) && words[i] === "screw" && !screwNoun(words, i)) {
        ph = CRUDE.find(p => at(words, i, p) && rudeUse(p));
        if (ph) { take(ph.length, mildCat()); continue; }
      }
      if ((has("mild") || has("moderate")) && bullSwear(words, i)) { take(1, mildCat()); continue; }
      if (has("minced") && squatSwear(words, i)) { take(1, "minced"); continue; }
      if (has("rude")) {
        ph = RUDE_PH.find(p => at(words, i, p) && rudeUse(p));
        if (ph) { take(ph.length, "rude"); continue; }
        if (suckSwear(words, i)) { take(1, "rude"); continue; }
      }
      const w = words[i], wb = base(w);
      const nxt = i + 1 < n ? words[i + 1] : "", prev = i ? words[i - 1] : "";
      for (const cat of cats) {
        if (!CATS[cat]) continue;
        if (CATS[cat].some(p => p.test(w) || p.test(wb))) {
          if (w === "bloody" && !BLOODY_SWEAR_NEXT.has(nxt)) break;
          if (FREAK_WORDS.has(w) && words.slice(i + 1, i + 3).includes("out")) break;
          if ((INNOCENT_NEXT[wb] && INNOCENT_NEXT[wb].has(nxt) && !foolCalled(wb, prev, nxt) &&
                !dumbCalled(wb, prev)) ||
              ((wb === "jerk" || wb === "jerks") && jerkMotion(words, i)) ||
              (PUSSY_WORDS.has(wb) && pussyCat(words, i)) ||
              oldWordInnocent(words, i, wb) ||
              (INNOCENT_PREV[wb] && INNOCENT_PREV[wb].has(prev)) ||
              (wb === "dumb" && i >= 2 && words[i - 2] === "deaf" && words[i - 1] === "and") ||
              ((w === "jesus" || w === "christ") && reverent(words, i)) ||
              (w === "gay" && gayHappy(words, i)))
            break;
          hits.push([i, i + 1, cat]);
          break;
        }
      }
      i += 1;
    }
    return withLeadIn(words, hits);
  }

  function withLeadIn(words, hits) {
    const out = [];
    let last = 0;
    for (let [a, b, cat] of hits) {
      for (const k of [2, 3]) {
        const lead = a >= k ? words.slice(a - k, a) : [];
        if (lead.length === k && LEAD_IN.has(lead[0]) && lead[k - 1] === "the" &&
            (k === 2 || lead[1] === "in") && a - k >= last) { a -= k; break; }
      }
      out.push([a, b, cat]);
      last = b;
    }
    return out;
  }

  /** True if a word is on any list of the ticked categories (cvcore.listed_word, simplified to
   *  one word): used so a word only "heard" is muted on its own when it's really listed. */
  function listedWord(word, cats) {
    const w = base(norm(word));
    if (!w) return false;
    if (cats.includes("deity") && ["god", "gods", "lord", "lords"].includes(w)) return true;
    return cats.some(c => CATS[c] && CATS[c].some(p => p.test(w))) || SEX3.some(p => p.test(w));
  }

  const neverFine = word => NEVER_FINE.some(p => p.test(base(norm(word))));
  const alwaysRemoved = word => ALWAYS_REMOVED.some(p => p.test(base(norm(word))));

  function mask(word) {
    const core = word.replace(/[^\p{L}]/gu, "");
    return core.length <= 1 ? word : core[0] + "*".repeat(core.length - 1);
  }

  // ---------- Spanish (cvlang.py: norm, find_language for "es") ----------
  // The owner, 2026-11-19: "can clean stream doing any spanish?", then "yes", and "some shows
  // are mostly english with some spanish in but bad words in both". Each subtitle line is
  // checked in its own language (lineLang): a Spanish line with these lists, as well as the
  // English ones (which already have a short list of Spanish swears for English films).
  const ES = W.ES || { words: {}, phrases: {}, not_next: {}, not_before: {}, order: [] };
  const ES_WORDS = Object.fromEntries(Object.entries(ES.words).map(([k, v]) => [k, full(v)]));
  const ES_NOT_NEXT = setsOf(ES.not_next), ES_NOT_BEFORE = setsOf(ES.not_before);
  /** A word as the Spanish lists have it: small letters, no punctuation, no accents (ñ kept). */
  function esNorm(w) {
    w = String(w).normalize("NFC").toLowerCase().replace(/[’‘]/g, "'").replace(/ñ/g, "\0")
      .normalize("NFD").replace(/\p{M}/gu, "").replace(/\0/g, "ñ");
    return stripP(w.replace(/[^\p{L}\p{N}']/gu, ""), "'");
  }
  const esInnocent = (words, i) => {
    const w = words[i], nxt = i + 1 < words.length ? words[i + 1] : "", prev = i ? words[i - 1] : "";
    return !!((ES_NOT_NEXT[w] && ES_NOT_NEXT[w].has(nxt)) || (ES_NOT_BEFORE[w] && ES_NOT_BEFORE[w].has(prev)));
  };
  /** Spans [i, j, category] of words[i:j] to mute (cvlang.find_language). words: esNorm()ed. */
  function esFindLanguage(words, cats, mine = []) {
    const has = new Set(cats), n = words.length, hits = [];
    const phrases = ES.order.filter(c => has.has(c)).flatMap(c => (ES.phrases[c] || []).map(p => [p, c]))
      .sort((a, b) => b[0].length - a[0].length);
    const seen = new Set();
    mine = byLen(mine.filter(p => { const k = p.join(" "); return !seen.has(k) && seen.add(k); }));
    let i = 0;
    while (i < n) {
      const ph = mine.find(p => at(words, i, p));
      if (ph) { hits.push([i, i + ph.length, "mine"]); i += ph.length; continue; }
      const got = phrases.find(([p]) => at(words, i, p));
      if (got) { hits.push([i, i + got[0].length, got[1]]); i += got[0].length; continue; }
      const w = words[i];
      const cat = ES.order.find(c => has.has(c) && (ES_WORDS[c] || []).some(p => p.test(w)));
      if (cat && !esInnocent(words, i)) hits.push([i, i + 1, cat]);
      i += 1;
    }
    return hits;
  }

  // Telling a line's language by its everyday words (cvlang.which_language's lists, en and es):
  // a word only one of the two has counts for more. ¿ ¡ ñ say Spanish on their own; accents
  // lean Spanish ("Cállate"). A line with nothing to go by says null.
  const plainW = w => w.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z']/g, "");
  const LW = W.LITTLE_WORDS || { en: [], es: [] };
  const EN_LITTLE = new Set(LW.en.map(plainW)), ES_LITTLE = new Set(LW.es.map(plainW));
  function lineLang(text) {
    if (!ES.order.length) return "en";
    if (/[¿¡ñÑ]/.test(text)) return "es";
    let en = 0, es = 0;
    for (const raw of text.split(/\s+/)) {
      const t = plainW(raw);
      if (!t) continue;
      const inEn = EN_LITTLE.has(t), inEs = ES_LITTLE.has(t);
      if (inEn) en += inEs ? 1 : 2;
      if (inEs) es += inEn ? 1 : 2;
      if (/[áéíóúÁÉÍÓÚ]/.test(raw)) es += 1;
    }
    return es > en ? "es" : en > es ? "en" : null;
  }

  // The tick boxes for words -> the word lists' categories (cvcore.GROUPS)
  const GROUPS = W.GROUPS;
  const catsFor = ticks => Object.entries(GROUPS).filter(([g]) => ticks[g]).flatMap(([, c]) => c);

  globalThis.CSWords = { norm, findLanguage, listedWord, neverFine, alwaysRemoved, mask, GROUPS,
    catsFor, unbleep, unabbreviate, base, from: W.from, esNorm, esFindLanguage, lineLang };
})();
