// Reading YouTube's captions and working out what to mute, for CleanStream.
// YouTube's "json3" captions: auto-made ones (kind asr) give each word's own start time;
// ones a person wrote give a line at a time. As CleanView uses what was heard for timing
// and the subtitles for the words, CleanStream uses the auto-made words for timing and the
// written captions for the words, when a video has both.
(function () {
  const W = globalThis.CV_WORDS, CS = globalThis.CSWords;
  const rx = ([src, flags], g = true) => new RegExp(src, flags + (g ? "g" : ""));
  const LINE_WORDS = Object.fromEntries(Object.entries(W.LINE_WORDS).map(([k, v]) => [k, rx(v)]));
  const TRIM = rx(W.LIST_WORD_TRIM);
  const STRIP_NEXT = new Set(W.STRIPPER_NEXT), STRIP_BEFORE = new Set(W.STRIPPER_BEFORE),
    STRIP_THINGS = new Set(W.STRIPPER_THINGS);
  const NAME_CATS = new Set(W.NAME_CATS), NOT_NAME_AFTER = new Set(W.NOT_NAME_AFTER),
    SAID_IN_TITLES = new Set(W.SAID_IN_TITLES), GOD_PRAYER_NEXT = new Set(W.GOD_PRAYER_NEXT);

  // what a mute covers around a word (seconds): a little before it starts, a little after
  // (PAD_BEFORE was 0.12: "the beginnings of words need muted a hair sooner", the owner, 2026-11-17;
  // then 0.25: "sometimes i can hear the first part of a letter of the word", 2026-11-18; only a
  // little more, so the word before is kept: "try not to make it too much longer")
  const PAD_BEFORE = 0.33, PAD_AFTER = 0.08, LONGEST_WORD = 1.2, JOIN_GAP = 0.2;
  // a written caption's word placed by its share of the line: wider, since it's a guess
  const GUESS_PAD = 0.35;

  // ---------- reading json3 ----------
  // Sound descriptions and speaker marks aren't words said: [Music], (laughs), >>, ♪
  const NOT_SAID = /\[[^\]]*\]|\([^)]*\)|>>|♪|♫|^-\s*|\b[A-Z][A-Z]+:/g;
  // YouTube's auto captions hide a strong swear as "[ __ ]": the word isn't known, but it's a swear
  const HIDDEN = /^\[\s*_+\s*\]$/, HIDDEN_IN = /\[\s*_+\s*\]/g, HIDDEN_SAID = "[ __ ]", HIDDEN_PAD = 0.15;

  /** json3 -> cues [{s, e, text, words: [{raw, w, s, e, timed}]}] (seconds). */
  function readJson3(data, asr) {
    const cues = [];
    for (const ev of (data && data.events) || []) {
      if (!ev.segs || ev.tStartMs == null) continue;
      const s0 = ev.tStartMs / 1000, dur = (ev.dDurationMs || 0) / 1000;
      const segs = ev.segs.filter(g => g.utf8 && g.utf8 !== "\n");
      if (!segs.length) continue;
      const text = segs.map(g => g.utf8).join("").replace(/\s+/g, " ").trim();
      if (!text) continue;
      const words = [];
      if (asr && segs.some(g => g.tOffsetMs != null)) {
        for (const g of segs) {
          const raw = g.utf8.trim();
          if (HIDDEN.test(raw)) {
            words.push({ raw: HIDDEN_SAID, w: "", hidden: true, s: s0 + (g.tOffsetMs || 0) / 1000, e: null, timed: true });
            continue;
          }
          if (!raw || /^\[.*\]$/.test(raw)) continue;
          words.push({ raw, w: CS.norm(raw), s: s0 + (g.tOffsetMs || 0) / 1000, e: null, timed: true });
        }
      } else {
        // a written line: each word placed by where it falls in the line
        const said = text.replace(HIDDEN_IN, m => "⟦" + "_".repeat(m.length - 2) + "⟧")
          .replace(NOT_SAID, m => " ".repeat(m.length));
        const total = said.length || 1;
        let m; const re = /\S+/g;
        while ((m = re.exec(said))) {
          const hidden = /^⟦_+⟧$/.test(m[0]);
          words.push({ raw: hidden ? HIDDEN_SAID : m[0], w: hidden ? "" : CS.norm(m[0]), hidden,
            s: s0 + dur * m.index / total, e: s0 + dur * (m.index + m[0].length) / total, timed: false });
        }
      }
      if (words.length) cues.push({ s: s0, e: s0 + dur, text, words, asr: !!asr });
    }
    // an auto-made word ends where the next one starts (at most LONGEST_WORD later)
    if (asr) {
      const all = cues.flatMap(c => c.words);
      all.sort((a, b) => a.s - b.s);
      all.forEach((x, k) => {
        const nxt = all[k + 1];
        const cue = cues.find(c => c.words.includes(x));
        const end = Math.min(nxt ? nxt.s : x.s + 0.6, x.s + LONGEST_WORD, Math.max(cue.e, x.s + 0.3));
        x.e = Math.max(end, x.s + 0.15);
      });
    }
    return cues;
  }

  // ---------- names (cleanview.name_in_subtitles, bare_god) ----------
  const flat = cues => cues.flatMap((c, ci) => c.words.map(x => ({ ...x, ci })));
  function newSentence(ws, k) {
    return k === 0 || ws[k - 1].ci !== ws[k].ci ||
      /[.!?:;\-–—…]['"”’]?$/.test(ws[k - 1].raw);
  }
  function nameHere(ws, cues, k) {
    const w = ws[k].raw.replace(/^["'(“‘[]+/, "");
    if (!/^[A-Z]/.test(w) || (w.length > 1 && w === w.toUpperCase()) || newSentence(ws, k)) return false;
    if (SAID_IN_TITLES.has(CS.norm(w))) return false;
    if (NOT_NAME_AFTER.has(CS.norm(ws[k - 1].raw)) || !/[a-z]/.test(cues[ws[k].ci].text)) return false;
    return true;
  }
  function bareGod(ws, k) {
    const w = ws[k].raw.replace(/^["'(“‘[\-–— ]+/, "");
    if (!/^(?:God(!+|\?!|\.\.\.|…)?["'”’]?|God[,.])$/.test(w)) return false;
    if (k && ["oh", "my", "good", "dear", "thank", "to", "of", "a"].includes(CS.norm(ws[k - 1].raw))) return false;
    if (w.includes("!")) return true;
    const last = k + 1 >= ws.length || ws[k + 1].ci !== ws[k].ci;
    if (w.startsWith("God.") || w.startsWith("God…") || (w === "God" && last))
      return newSentence(ws, k) && last;
    if (w === "God," && newSentence(ws, k) && !last) return !GOD_PRAYER_NEXT.has(CS.norm(ws[k + 1].raw));
    return false;
  }
  /** Words a written caption spells as a name mid-sentence anywhere ("Al", "Dern"). */
  function namesIn(cues) {
    const ws = flat(cues), out = new Set();
    ws.forEach((x, k) => { if (nameHere(ws, cues, k)) out.add(CS.norm(x.raw)); });
    return out;
  }

  // two words that could be heard for each other ("hell" for "Al"): letters, leading h off
  function soundsAlike(a, b) {
    a = a.replace(/^h/, ""); b = b.replace(/^h/, "");
    if (!a || !b) return false;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return 1 - d[a.length][b.length] / Math.max(a.length, b.length) >= 0.3;
  }

  // ---------- finding what to mute ----------
  const LABEL = { strong: "Swearing", moderate: "Swearing", mild: "Mild word", deity: "God's name",
    minced: "Soft substitute", samesex: "Same-sex word", rude: "Rude word", mine: "Your word",
    sexref: "Sexual reference", casual: "Sleeping around", crude: "Crude humor",
    forensic: "Coroner and crime talk", drugtalk: "Drug talk" };

  // ---------- the guards around the short lists (cleanview.py, CleanView 1.18.137) ----------
  const setOf = k => new Set(W[k] || []);
  const WIENER_DOG = setOf("WIENER_DOG"), BALL_GAME = setOf("BALL_GAME"), DRUNK_BEFORE = setOf("DRUNK_BEFORE"),
    DRUNK_NEXT = setOf("DRUNK_NEXT"), STONED_NEXT = setOf("STONED_NEXT"), STONED_BEFORE2 = setOf("STONED_BEFORE2"),
    PERCOCET_MISUSE = setOf("PERCOCET_MISUSE"), JUNKIE_NOT = setOf("JUNKIE_NOT"), HIGH_NOT_NEXT = setOf("HIGH_NOT_NEXT"),
    SHOOT_UP_OK_NEXT = setOf("SHOOT_UP_OK_NEXT"), STRUNG_NOT_NEXT = setOf("STRUNG_NOT_NEXT"),
    SHOOT_UP_THINGS = setOf("SHOOT_UP_THINGS");
  const PERCOCET_REACH = W.PERCOCET_REACH || 10, JOIN_NEXT_SECS = W.JOIN_NEXT_SECS || 2;
  const wordsOf = t => t.toLowerCase().match(/[a-z']+/g) || [];
  const before = (text, m, n) => wordsOf(text.slice(0, m.index)).slice(-n);
  const afterWords = (text, m, n) => wordsOf(text.slice(m.index + m[0].length)).slice(0, n);
  const nearBy = (text, m, n) => [...before(text, m, n), ...afterWords(text, m, n)];
  // the next word, but not past the end of the sentence (lines are read with the next joined on)
  const nextWord = (text, m, stops = /^\s*[.!?;]/) => {
    const rest = text.slice(m.index + m[0].length);
    return stops.test(rest) ? null : (wordsOf(rest)[0] || null);
  };

  function wienerDog(text, m) {          // "little wiener" said of a dog or food
    return m[0].toLowerCase().startsWith("little w") && nearBy(text, m, 8).some(w => WIENER_DOG.has(w));
  }
  function ballGame(text, m) {           // "rubbing his ball" (one ball) said of a game or a thing
    const f = m[0].toLowerCase();
    return f.startsWith("rub") && f.endsWith("ball") && nearBy(text, m, 8).some(w => BALL_GAME.has(w));
  }
  function drunkDrink(text, m) {         // "had drunk his tea": what was drunk, not being drunk
    if (m[0].toLowerCase() !== "drunk") return false;
    const prev = before(text, m, 1)[0], nxt = nextWord(text, m);
    if (nxt && DRUNK_NEXT.has(nxt)) return true;
    if (prev && DRUNK_BEFORE.has(prev))
      return !["he's", "she's"].includes(prev) || (!!nxt && ["the", "a", "an", "his", "her", "my", "your", "their",
        "our", "it", "all", "some", "that", "this", "too", "enough", "every"].includes(nxt));
    return false;
  }
  function stonedRocks(text, m) {        // a stoning or pitted fruit, not high on drugs
    if (!m[0].toLowerCase().startsWith("stoned")) return false;
    const nxt = nextWord(text, m), prev = before(text, m, 2);
    if (nxt && STONED_NEXT.has(nxt)) return true;
    return prev.length === 2 && prev[1] === "be" && STONED_BEFORE2.has(prev[0]);
  }
  function percocetMedical(text, m) {    // Percocet / OxyContin with no sign of misuse near it
    const f = m[0].toLowerCase();
    if (!(f.startsWith("percocet") || f.startsWith("perkaset") || f.startsWith("oxycontin"))) return false;
    return !nearBy(text, m, PERCOCET_REACH).some(w => PERCOCET_MISUSE.has(w));
  }
  function drugSlangInnocent(text, m) {  // an adrenaline junkie, the Hindu Kush, got high marks...
    const f = m[0].toLowerCase(), prev = before(text, m, 1)[0];
    const rest = text.slice(m.index + m[0].length), nxt = nextWord(text, m, /^\s*[.!?;,]/);
    if (f.startsWith("junkie")) return !!prev && JUNKIE_NOT.has(prev);
    if (f === "kush") return prev === "hindu";
    if (f.startsWith("shoot")) {
      if (nxt && !SHOOT_UP_OK_NEXT.has(nxt)) return true;
      // things that shoot up, rising ("the flames were shooting up", "the temperature's
      // shooting up"; CleanView 1.18.139), within the 4 words before
      return before(text, m, 4).map(w => w.replace(/'s$/, "")).some(w => SHOOT_UP_THINGS.has(w));
    }
    if (f.endsWith(" high")) return !!nxt && HIGH_NOT_NEXT.has(nxt);
    if (f === "strung out") return !!nxt && STRUNG_NOT_NEXT.has(nxt);
    if (f === "oxy" || f === "oxys") return rest.startsWith("-");
    if (f.startsWith("jones")) return /^\s*for (?:you|me|him|her|them|us)\b/i.test(rest);
    return false;
  }
  /** Is this short-list find innocent where it stands? (cleanview.Listed's innocent) */
  function innocent(key, text, m) {
    if (key === "sexref") return stripperTool(text, m) || wienerDog(text, m) || ballGame(text, m);
    if (key === "crude") return drunkDrink(text, m);
    if (key === "drugtalk") return stonedRocks(text, m) || percocetMedical(text, m) || drugSlangInnocent(text, m);
    return false;
  }

  function stripperTool(text, m) {
    const found = m[0].toLowerCase();
    if (!found.startsWith("stripper") || found.replace(/s+$/, "").endsWith("pole")) return false;
    const before = (text.slice(0, m.index).toLowerCase().match(/[a-z']+/g) || []).slice(-3);
    const rest = text.slice(m.index + m[0].length).toLowerCase().replace(/^[a-z']+/, "");
    const after = (rest.match(/[a-z']+/g) || []).slice(0, 5);
    return (after.length && STRIP_NEXT.has(after[0])) || (before.length && STRIP_BEFORE.has(before[before.length - 1])) ||
      [...before, ...after].some(w => STRIP_THINGS.has(w));
  }

  /** Words of one track to mute: [{s, e, words, cat, why, track}] and ones left alone. */
  function findInTrack(cues, ticks, mine, kind) {
    const cats = CS.catsFor(ticks), ws = flat(cues), names = kind === "written" ? namesIn(cues) : new Set();
    const out = [], left = [];
    const words = ws.map(x => x.w);
    const keep = (a, b, cat, why) => {
      const span = ws.slice(a, b).filter(x => x.w || x.hidden);
      if (!span.length) return;
      // the word said just before (its start), so the early start of a mute can stop short of it
      const prior = ws.slice(0, a).filter(x => x.w || x.hidden).pop();
      const after = ws.slice(b).find(x => x.w || x.hidden);
      out.push({ s: span[0].s, e: span[span.length - 1].e, text: span.map(x => x.raw).join(" "),
        cat, why: why || LABEL[cat] || cat, timed: span.every(x => x.timed), track: kind,
        cue: span[0].ci, prevS: prior && prior.timed ? prior.s : null,
        nextS: after && after.timed ? after.s : null, nextE: after && after.timed ? after.e : null });
    };
    for (const [a, b, cat] of CS.findLanguage(words, cats, mine)) {
      // a mild word or soft substitute written as a name mid-sentence ("Detective Dern")
      if (kind === "written" && b - a === 1 && NAME_CATS.has(cat) && nameHere(ws, cues, a)) {
        left.push({ s: ws[a].s, text: ws[a].raw, why: "looks like a name here" });
        continue;
      }
      keep(a, b, cat);
    }
    // a swear YouTube hid as "[ __ ]" (its auto captions do that for strong words)
    if (cats.includes("strong"))
      ws.forEach((x, k) => { if (x.hidden) keep(k, k + 1, "strong", "Swearing (YouTube hid it)"); });
    if (kind === "written" && cats.includes("deity")) {
      ws.forEach((x, k) => {
        if (bareGod(ws, k) && !out.some(o => o.cue === x.ci && o.text.includes(x.raw))) keep(k, k + 1, "deity");
      });
    }
    // the short lists that need no AI: just their words are muted (cleanview.list_words_only)
    // (same-sex words since CleanView 1.18.127: bi-curious, twink, shemale, under that tick)
    for (const [key, tick] of [["sexref", "sexref"], ["casual", "casual"], ["crude", "crude"], ["samesex", "samesexwords"],
                               ["forensic", "forensic"], ["drugtalk", "drugtalk"]]) {
      if (!ticks[tick] || !LINE_WORDS[key]) continue;
      cues.forEach((c, ci) => {
        // with the next line joined on: a phrase can be split between two caption lines (YouTube's
        // auto captions often break mid-phrase; the owner, 2026-11-18: "why isnt clean stream
        // finding it", a sexual phrase CleanView caught). Only phrases that start in this line
        // count here; the next line finds its own.
        const own = c.words.map(x => x.raw).join(" ");
        const nxt = cues[ci + 1];
        const plain = nxt && nxt.s - c.e <= JOIN_NEXT_SECS ? own + " " + nxt.words.map(x => x.raw).join(" ") : own;
        for (const m of plain.matchAll(LINE_WORDS[key])) {
          if (m.index >= own.length) continue;
          if (innocent(key, plain, m)) continue;
          const phrase = m[0].replace(TRIM, "");
          let want = phrase.split(/[\s-]+/).map(CS.norm).filter(Boolean);
          const at = w => ws.findIndex((x, k) => x.ci === ci && w.every((y, j) => ws[k + j] && ws[k + j].w === y));
          let first = at(want);
          // a hyphened word is one word in the captions ("gang-bang", "bi-curious")
          if (first < 0 && /-/.test(phrase)) { want = [CS.norm(phrase)]; first = at(want); }
          if (first < 0) continue;
          if (out.some(o => o.cue === ci && o.s <= ws[first].s && o.e >= ws[first + want.length - 1].e)) continue;
          keep(first, first + want.length, key);
        }
      });
    }
    return { mutes: out, left, names };
  }

  /** Is a mute from one track already there in the other's mutes? (cleanview.already_muted) */
  function alreadyMuted(mutes, m) {
    return mutes.some(o => (CS.norm(o.text) === CS.norm(m.text) && o.s - 0.8 <= m.s && m.s <= o.e + 0.8) ||
      Math.min(m.e, o.e) - Math.max(m.s, o.s) > 0.5 * Math.max(0.01, m.e - m.s));
  }

  /** The whole plan for a video. tracks: {auto: cues|null, written: cues|null}.
   *  Returns {mutes: [{s, e, text, why}], left: [...], source}. */
  function plan(tracks, ticks, mineText = "") {
    const mine = (mineText || "").split("\n").map(l => l.split(/[\s-]+/).map(CS.norm).filter(Boolean))
      .filter(l => l.length);
    const auto = tracks.auto && tracks.auto.length ? findInTrack(tracks.auto, ticks, mine, "auto") : null;
    const written = tracks.written && tracks.written.length ? findInTrack(tracks.written, ticks, mine, "written") : null;
    let mutes = [], left = [];
    if (auto) {
      for (const m of auto.mutes) {
        // heard where the written captions have a name that sounds like it ("hell" / "Al")
        if (written && m.text.split(" ").length === 1) {
          const near = tracks.written.filter(c => c.s - 1 <= m.s && m.s <= c.e + 1);
          const nm = near.flatMap(c => c.words).find(x => written.names.has(x.w) && soundsAlike(CS.norm(m.text), x.w));
          if (nm && !written.mutes.some(o => Math.abs(o.s - m.s) < 2 && CS.norm(o.text) === CS.norm(m.text))) {
            left.push({ s: m.s, text: m.text, why: `the captions say “${nm.raw}” here, a name` });
            continue;
          }
        }
        mutes.push(m);
      }
    }
    if (written) {
      left.push(...written.left);
      const autoWords = auto ? tracks.auto.flatMap(c => c.words) : [];
      for (const m of written.mutes) {
        // a written word takes the time it was heard at, when the auto captions have it there
        const want = m.text.split(/\s+/).map(CS.norm).filter(Boolean);
        const hit = autoWords.findIndex((x, k) => x.w === want[0] && Math.abs(x.s - m.s) < 2.5 &&
          want.every((w, j) => autoWords[k + j] && autoWords[k + j].w === w));
        const timed = hit >= 0 ? { ...m, s: autoWords[hit].s, e: autoWords[hit + want.length - 1].e, timed: true,
          prevS: hit > 0 ? autoWords[hit - 1].s : null,
          nextS: autoWords[hit + want.length] ? autoWords[hit + want.length].s : null,
          nextE: autoWords[hit + want.length] ? autoWords[hit + want.length].e : null } : m;
        if (!alreadyMuted(mutes, timed)) mutes.push(timed);
      }
    }
    mutes = mutes.map(m => {
      // a swear YouTube hid is surely a swear, and its timing is the caption maker's guess: wider
      const pad = (m.timed ? 0 : GUESS_PAD) + (m.text === HIDDEN_SAID ? HIDDEN_PAD : 0);
      let from = Math.max(0, m.s - PAD_BEFORE - pad);
      // a word with its own time: the early start keeps off most of the word said before it (the
      // owner, 2026-11-19: a Short "muted 3 words instead of 1" in fast talk, then "still taking
      // too much": "some s***ty woman", each word a quarter second)
      // Only in quick talk: the sound goes off at most a quarter of the way back into the word
      // before (or leaves it 0.45 s), counting the player's 0.08 s head start; in slower talk the
      // full early start stays ("the first part of a letter" mustn't slip through)
      if (m.timed && m.prevS != null && m.prevS < m.s) {
        const gap = m.s - m.prevS, lead = Math.max(gap * 0.25, gap - 0.45);
        from = Math.max(from, Math.min(m.s, m.s - lead + 0.08));
      }
      let to = m.e + PAD_AFTER + pad;
      // ... and the late end barely into the word after (its start is where this word ends)
      if (m.timed && m.nextS != null && m.nextS >= m.e - 0.05) to = Math.min(to, m.nextS + 0.04);
      return { ...m, from, to };
    }).sort((a, b) => a.from - b.from);
    return { mutes, left, source: written && auto ? "both" : written ? "written" : auto ? "auto" : "none" };
  }

  /** Mutes joined where they touch: [[from, to], ...] for the player. */
  function ranges(mutes) {
    const out = [];
    for (const m of [...mutes].sort((a, b) => a.from - b.from)) {
      const last = out[out.length - 1];
      if (last && m.from <= last[1] + JOIN_GAP) last[1] = Math.max(last[1], m.to);
      else out.push([m.from, m.to]);
    }
    return out;
  }

  // ---------- Netflix's subtitles (TTML / DFXP, or WebVTT): written lines, no word times ----------
  // A time: "123456789t" (ticks), "01:02:03.456", "01:02:03:12" (frames, taken as hundredths
  // is close enough), "12.5s", "1500ms".
  function ttmlTime(v, tickRate) {
    if (!v) return null;
    let m;
    if ((m = /^([\d.]+)t$/.exec(v))) return +m[1] / (tickRate || 10000000);
    if ((m = /^([\d.]+)ms$/.exec(v))) return +m[1] / 1000;
    if ((m = /^([\d.]+)s$/.exec(v))) return +m[1];
    if ((m = /^(\d+):(\d+):(\d+(?:\.\d+)?)(?::(\d+))?$/.exec(v)))
      return +m[1] * 3600 + +m[2] * 60 + +m[3] + (m[4] ? +m[4] / 100 : 0);
    return null;
  }
  /** TTML text -> cues, as readJson3 gives for written captions. */
  function readTTML(text) {
    const doc = new DOMParser().parseFromString(text, "text/xml");
    const root = doc.documentElement;
    const tick = +(root.getAttribute("ttp:tickRate") || root.getAttributeNS("http://www.w3.org/ns/ttml#parameter", "tickRate")) || 10000000;
    const events = [];
    for (const p of doc.getElementsByTagNameNS("*", "p")) {
      const s = ttmlTime(p.getAttribute("begin"), tick), e = ttmlTime(p.getAttribute("end"), tick);
      if (s == null) continue;
      for (const br of [...p.getElementsByTagNameNS("*", "br")]) br.replaceWith(" ");
      const line = p.textContent.replace(/\s+/g, " ").trim();
      if (line) events.push({ tStartMs: s * 1000, dDurationMs: Math.max(0, ((e ?? s + 2) - s) * 1000), segs: [{ utf8: line }] });
    }
    events.sort((a, b) => a.tStartMs - b.tStartMs);
    return readJson3({ events }, false);
  }
  /** WebVTT text -> cues. */
  function readVTT(text) {
    const events = [], t = x => { const m = /(?:(\d+):)?(\d+):(\d+)[.,](\d+)/.exec(x); return m ? (+(m[1] || 0)) * 3600 + +m[2] * 60 + +m[3] + +("0." + m[4]) : null; };
    for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
      const lines = block.split("\n"), k = lines.findIndex(l => l.includes("-->"));
      if (k < 0) continue;
      const [a, b] = lines[k].split("-->"), s = t(a), e = t(b);
      const line = lines.slice(k + 1).join(" ").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
      if (s != null && line) events.push({ tStartMs: s * 1000, dDurationMs: Math.max(0, ((e ?? s + 2) - s) * 1000), segs: [{ utf8: line }] });
    }
    return readJson3({ events }, false);
  }
  /** Netflix subtitles of either kind. */
  const readSubtitles = text => (/^\s*WEBVTT/.test(text) ? readVTT(text) : readTTML(text));

  /** The short-list finds in a text, guards applied (for tools/check_lines.py). */
  const lineFinds = (key, text) => LINE_WORDS[key] ? [...text.matchAll(LINE_WORDS[key])]
    .filter(m => !innocent(key, text, m)).map(m => m[0]) : [];
  globalThis.CSCaptions = { readJson3, readTTML, readVTT, readSubtitles, plan, ranges, findInTrack, soundsAlike, LABEL,
    lineFinds };
})();
