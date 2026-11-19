// Checks the caption reader and the mute plan on made-up captions (no browser needed).
//   node tools/test_captions.mjs
import { createRequire } from "node:module";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const ext = new URL("../extension/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
for (const f of ["words_data.js", "words.js", "captions.js", "settings.js"]) {
  if (f === "settings.js") globalThis.chrome = { storage: { sync: {} } };
  require(ext + f);
}
const CC = globalThis.CSCaptions, S = globalThis.CSSettings;
let passed = 0;
const test = (name, f) => { f(); passed++; console.log("ok  " + name); };

// auto-made captions: each word with its own time
const asr = (startMs, words, gapMs = 400) => ({ tStartMs: startMs, dDurationMs: words.length * gapMs + 500,
  segs: words.map((w, k) => ({ utf8: (k ? " " : "") + w, tOffsetMs: k * gapMs })) });
const written = (startMs, durMs, text) => ({ tStartMs: startMs, dDurationMs: durMs, segs: [{ utf8: text }] });
const kids = S.PRESETS.kids, adults = S.PRESETS.adults;

test("a swear in auto captions is muted at its own time", () => {
  const cues = CC.readJson3({ events: [asr(10000, ["well", "that", "was", "damn", "good"])] }, true);
  const p = CC.plan({ auto: cues }, kids);
  assert.equal(p.mutes.length, 1);
  assert.equal(p.mutes[0].text, "damn");
  assert.ok(Math.abs(p.mutes[0].s - 11.2) < 1e-6);            // 10 s + 3 words x 0.4 s
  assert.ok(p.mutes[0].from < 11.2 && p.mutes[0].to > 11.3 && p.mutes[0].to < 11.8);
});

test("a swear YouTube hid as [ __ ] is muted, only with swearing ticked", () => {
  const cues = CC.readJson3({ events: [asr(2000, ["what", "the", "[ __ ]", "is", "this"])] }, true);
  const p = CC.plan({ auto: cues }, kids);
  assert.deepEqual(p.mutes.map(m => m.text), ["[ __ ]"]);
  assert.ok(Math.abs(p.mutes[0].s - 2.8) < 1e-6 && p.mutes[0].timed);
  assert.deepEqual(CC.plan({ auto: cues }, { ...kids, swearing: false }).mutes, []);
  const wr = CC.readJson3({ events: [written(0, 2000, "Get the [ __ ] out of here.")] }, false);
  assert.deepEqual(CC.plan({ written: wr }, kids).mutes.map(m => m.text), ["[ __ ]"]);
  const both = CC.plan({ auto: cues, written: CC.readJson3({ events: [written(1900, 2500, "What the [ __ ] is this?")] }, false) }, kids);
  assert.equal(both.mutes.length, 1);                        // not muted twice
});

test("only the ticked groups are muted (adults keep 'gosh')", () => {
  const cues = CC.readJson3({ events: [asr(0, ["oh", "gosh", "you", "idiot"])] }, true);
  assert.deepEqual(CC.plan({ auto: cues }, kids).mutes.map(m => m.text), ["gosh", "idiot"]);
  assert.deepEqual(CC.plan({ auto: cues }, adults).mutes.map(m => m.text), []);
});

test("phrases go whole: 'oh my god', 'what the hell'", () => {
  const cues = CC.readJson3({ events: [asr(0, ["oh", "my", "god", "what", "the", "hell"])] }, true);
  const p = CC.plan({ auto: cues }, kids);
  assert.deepEqual(p.mutes.map(m => m.text), ["oh my god", "what the hell"]);
});

test("written captions take the auto captions' timing for the same word", () => {
  const auto = CC.readJson3({ events: [asr(5000, ["you", "are", "a", "jackass", "man"])] }, true);
  const wr = CC.readJson3({ events: [written(4800, 2500, "You are a jackass, man.")] }, false);
  const p = CC.plan({ auto, written: wr }, kids);
  assert.equal(p.mutes.length, 1);                           // not muted twice
  assert.ok(Math.abs(p.mutes[0].s - 6.2) < 1e-6);
  assert.equal(p.source, "both");
});

test("written captions alone: timing guessed within the line, wider mute", () => {
  const wr = CC.readJson3({ events: [written(20000, 2000, "That's bullshit and you know it.")] }, false);
  const p = CC.plan({ written: wr }, kids);
  assert.equal(p.mutes.length, 1);
  assert.equal(p.mutes[0].timed, false);
  assert.ok(p.mutes[0].from >= 19.4 && p.mutes[0].to <= 21.4);
});

test("bleeped written captions are still found (f***ing)", () => {
  const wr = CC.readJson3({ events: [written(0, 2000, "Get the f***ing car!")] }, false);
  assert.equal(CC.plan({ written: wr }, adults).mutes.length, 1);
});

test("a mild word written as a name is left alone (Detective Dern)", () => {
  const wr = CC.readJson3({ events: [written(0, 2000, "Call Detective Dern now.")] }, false);
  const p = CC.plan({ written: wr }, kids);
  assert.equal(p.mutes.length, 0);
  assert.equal(p.left.length, 1);
});

test("'hell' heard where the captions say 'Al' (a name) is left alone", () => {
  const auto = CC.readJson3({ events: [asr(1000, ["hell", "you", "won"])] }, true);
  const wr = CC.readJson3({ events: [written(900, 1500, "Al, you won!"), written(3000, 1500, "Thanks, Al.")] }, false);
  const p = CC.plan({ auto, written: wr }, kids);
  assert.equal(p.mutes.length, 0, JSON.stringify(p.mutes));
  assert.ok(p.left.some(x => /Al/.test(x.why)));
});

test("'Al, what the hell?' still mutes 'hell'", () => {
  const auto = CC.readJson3({ events: [asr(1000, ["al", "what", "the", "hell"])] }, true);
  const wr = CC.readJson3({ events: [written(900, 2000, "Al, what the hell?"), written(4000, 1500, "Thanks, Al.")] }, false);
  const p = CC.plan({ auto, written: wr }, kids);
  assert.deepEqual(p.mutes.map(m => m.text), ["what the hell"]);
});

test("sexual words: just the word ('had sex' -> 'sex'); stripper the tool left alone", () => {
  const wr = CC.readJson3({ events: [written(0, 3000, "They had sex last night."),
    written(4000, 3000, "Hand me the paint stripper.")] }, false);
  const p = CC.plan({ written: wr }, kids);
  assert.deepEqual(p.mutes.map(m => m.text), ["sex"]);
});

test("the hard rule: fart muted with crude humor ticked", () => {
  const auto = CC.readJson3({ events: [asr(0, ["he", "let", "out", "a", "fart"])] }, true);
  assert.deepEqual(CC.plan({ auto }, S.PRESETS.young).mutes.map(m => m.text), ["fart"]);
  assert.deepEqual(CC.plan({ auto }, adults).mutes.map(m => m.text), []);
});

test("her own words are always muted", () => {
  const auto = CC.readJson3({ events: [asr(0, ["you", "big", "fat", "liar"])] }, true);
  assert.deepEqual(CC.plan({ auto }, adults, "big fat liar").mutes.map(m => m.text), ["big fat liar"]);
});

test("sound descriptions and music marks aren't words", () => {
  const wr = CC.readJson3({ events: [written(0, 2000, "[Music] ♪ hell ♪"), written(3000, 1000, "(laughs) Damn!")] }, false);
  const p = CC.plan({ written: wr }, kids);
  assert.equal(p.mutes.length, 2);                           // the sung "hell" and "Damn"
});

test("mutes that touch are joined for the player", () => {
  const r = CC.ranges([{ from: 1, to: 2 }, { from: 2.1, to: 3 }, { from: 5, to: 6 }]);
  assert.deepEqual(r, [[1, 3], [5, 6]]);
});

test("quick talk: a little word before ('a') goes with the word, a real word before stays", () => {
  const W = "blow" + "job";
  const p = CC.plan({ auto: CC.readJson3({ events: [asr(65000, ["never", "given", "a", W], 240)] }, true) }, adults);
  assert.equal(p.mutes.length, 1);
  assert.ok(Math.abs(p.mutes[0].from - (65.48 + 0.08)) < 1e-6);   // off as "a" starts (with the 0.08 head start)
  const q = CC.plan({ auto: CC.readJson3({ events: [asr(0, ["some", "shitty", "woman"], 250)] }, true) }, kids);
  assert.ok(q.mutes[0].from > 0.25 - 0.1);                        // "some" is mostly heard
});

test("Spanish: a mostly English show with Spanish lines mutes bad words in both", () => {
  const wr = CC.readJson3({ events: [
    written(1000, 2000, "What the hell are you doing here?"),
    written(4000, 2000, "¡Cállate, pendejo!"),
    written(7000, 2500, "No sé qué demonios quieres de mí."),
    written(10000, 1500, "Tonto."),                          // nothing to go by: the line before is Spanish
    written(20000, 2000, "Tonto was the Lone Ranger's friend."),   // English: a name, left alone
    written(23000, 2000, "Mira, Jody, the bus is here."),    // "Jody" isn't a Spanish swear
  ] }, false);
  const p = CC.plan({ written: wr }, kids);
  const said = p.mutes.map(m => m.text);
  assert.deepEqual(said, ["What the hell", "¡Cállate,", "pendejo!", "qué demonios", "Tonto."]);
  assert.ok(p.mutes.find(m => m.text === "pendejo!").why.includes("Spanish") ||
    p.mutes.find(m => m.text === "pendejo!").why === "Swearing");
  const sw = CC.plan({ written: wr }, { ...kids, rude: false });
  assert.ok(!sw.mutes.some(m => /Cállate|Tonto/.test(m.text)));       // rude words only when ticked
});

test("Spanish: a Spanish video's auto captions, with her own words", () => {
  const auto = CC.readJson3({ events: [asr(0, ["mira", "que", "hijo", "de", "perra", "eres"]), asr(5000, ["qué", "rollo", "hermano"])] }, true);
  const p = CC.plan({ auto }, kids, "qué rollo");
  assert.deepEqual(p.mutes.map(m => m.text), ["hijo de perra", "qué rollo"]);
  assert.ok(p.mutes[0].timed && Math.abs(p.mutes[0].s - 0.8) < 1e-6);
});

test("Spanish: words on screen starred in their own language", () => {
  const cats = globalThis.CSWords.catsFor(kids);
  const line = "¡Cállate, pendejo, qué mierda!";
  const raws = line.split(/\s+/);
  assert.deepEqual([...CC.starIdx(raws, line, cats, "")].sort(), [0, 1, 3]);
  assert.deepEqual([...CC.starIdx("Tonto was here".split(" "), "Tonto was here", cats, "")], []);
  assert.equal(globalThis.CSWords.mask("coño"), "c***");
});

test("CleanView 1.18.144: a hen's cuck-cuck, 'Darn her,' as the oath, the bottles had been drunk", () => {
  const ticks = { ...kids, sexref: true, crude: true, minced: true };
  const said = t => CC.plan({ written: CC.readJson3({ events: [written(0, 3000, t)] }, false) }, ticks).mutes.map(m => m.text);
  assert.deepEqual(said("The hen said cuck cuck and ran off."), []);
  assert.deepEqual(said("Don't be such a cuck."), ["cuck."]);
  assert.deepEqual(said("Darn her, exploded Davy."), ["Darn"]);
  assert.deepEqual(said("She sat down to darn her stockings."), []);
  assert.deepEqual(said("a most surprising number of the bottles had been drunk out"), []);
  assert.deepEqual(said("Two bottles had been opened and Tom was drunk."), ["drunk."]);
});

console.log(`${passed} passed`);
