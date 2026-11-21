// Copyright (c) 2026 BookWorm824. All rights reserved. See LICENSE.
// Test: where CleanStream thinks a Prime Video title is (site_prime.js), through ads. The owner,
// 2026-11-21: "after 1 minute and a half ad the time got off", "after an ad the clock got off and
// it let a word through", "the clock was off by 27 seconds after an add".
// The stand-in player is built on what Prime's own player did in Chrome on 2026-11-21:
//  - the seek bar, an <input type="range">, is always there: aria-valuetext "0:35:29" (whole
//    seconds, cut down) and value the share gone (52.248...%); both set about 4 times a second;
//  - the clock on screen ("0:35:29", a box with a scrambled name) is there only while the controls
//    show, rounded to the second, with the time left beside it counting down.
// Played in Node, 20 ms at a time, like site.js.
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(new URL("../extension/site_prime.js", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
let bad = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) bad++; };
const hms = s => { s = Math.max(0, s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.floor(s % 60);
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };

/** opts.seek: "video" (the seek bar is the video's own timeline: no ads inside it), "title" (the
 *  title's own time, ads inside the video left out), "none"; opts.shown: "always", "sometimes"
 *  (the controls now and then), "never"; opts.ad: "stitched" (inside the title's video) or "own"
 *  (a video of its own); opts.staleSecs: the seek bar still shows the time from before the ad for
 *  that long after it; opts.adMarked: whether CleanStream can tell an ad is on (default yes). */
function run(opts) {
  let T = 0;
  globalThis.performance = { now: () => T * 1000 };
  Date.now = () => 1e12 + T * 1000;
  const el = (cls, text = "") => ({ cls, tagName: "DIV", textContent: text, shown: true, childElementCount: 0,
    getClientRects() { return this.shown ? [1] : []; } });
  const clock = el("f4cgkp5"), left = el("f4cgkp5"), adLabel = el("ad");
  const seek = { tagName: "INPUT", max: "100", value: "0", label: "", childElementCount: 0,
    getAttribute(n) { return n === "aria-valuetext" ? this.label : null; }, getClientRects: () => [1] };
  const leaves = () => [clock, left, adLabel].filter(x => x.shown);
  const box = { querySelectorAll: sel => sel.startsWith("input") ? (opts.seek === "none" ? [] : [seek]) : leaves() };
  globalThis.document = {
    querySelector: sel => sel.includes("webPlayerSDKContainer") ? box : null,
    querySelectorAll: () => [],
  };
  delete globalThis.CS_SITE;
  (0, eval)(fs.readFileSync(SRC, "utf8"));
  const S = globalThis.CS_SITE;

  const TOTAL = 4000, AD_AT = 60, AD_LEN = opts.adLen || 90, END = AD_AT + AD_LEN + 60;
  const show = { currentTime: 1200, paused: false, readyState: 4, playbackRate: 1, duration: TOTAL + (opts.ad === "stitched" ? AD_LEN : 0) };
  const adVid = { currentTime: 0, paused: true, readyState: 4, playbackRate: 1, duration: AD_LEN };
  let title = 1200, reported = 1200, worst = 0, worstAfter = 0, clockedAtEnd = false;
  for (let k = 0; T < END; k++) {
    T = k * 0.02;
    const inAd = T >= AD_AT && T < AD_AT + AD_LEN, after = T - (AD_AT + AD_LEN);
    if (inAd) {
      if (opts.ad === "stitched") show.currentTime += 0.02;
      else { show.paused = true; adVid.paused = false; adVid.currentTime += 0.02; }
    } else { show.paused = false; adVid.paused = true; show.currentTime += 0.02; title += 0.02; }
    // what Prime shows is set about 4 times a second
    if (k % 12 === 0 && !inAd && !(opts.staleSecs && after >= 0 && after < opts.staleSecs)) reported = title;
    if (k % 12 === 0) {
      // "video": its share of the video's own length; "title": of the title's, ads left out
      seek.label = hms(Math.floor(reported)); seek.value = String(reported / (opts.seek === "video" ? show.duration : TOTAL) * 100);
    }
    const controls = opts.shown === "always" || (opts.shown === "sometimes" && (T < 8 || T % 40 < 3));
    clock.shown = left.shown = controls && !inAd;
    clock.textContent = hms(Math.round(reported)); left.textContent = hms(TOTAL - reported);
    adLabel.shown = inAd && opts.adMarked !== false; adLabel.textContent = "Ad 1 of 1";
    const v = inAd && opts.ad === "own" ? adVid : show;
    const r = S.time(v);
    if (!inAd && T > 10) {
      const err = Math.abs((r.clocked ? r.t : v.currentTime) - title);
      if (after < 0) worst = Math.max(worst, err);
      else if (after > (opts.staleSecs || 0) + 2.5) worstAfter = Math.max(worstAfter, err);
    }
    clockedAtEnd = r.clocked;
  }
  return { worst, worstAfter, clockedAtEnd };
}

const cases = [
  // as seen in Chrome on the owner's PC: no ads inside the video, the seek bar is its own clock
  ["the seek bar is the video's own clock; an ad as a video of its own", { seek: "video", shown: "sometimes", ad: "own" }, 0.03],
  ["the same, the ad not marked as an ad", { seek: "video", shown: "never", ad: "own", adMarked: false }, 0.03],
  // ads inside the video (as the owner's laptop may get): the seek bar keeps the title's time
  ["an ad inside the video, the seek bar keeping the title's time, controls hidden", { seek: "title", shown: "never", ad: "stitched" }, 0.2],
  ["the same, the ad not marked as an ad", { seek: "title", shown: "never", ad: "stitched", adMarked: false }, 0.2],
  ["the same, the seek bar showing the time from before the ad for 2 s", { seek: "title", shown: "never", ad: "stitched", staleSecs: 2 }, 0.2],
  ["the same, a 27-second ad", { seek: "title", shown: "never", ad: "stitched", adLen: 27 }, 0.2],
  // no seek bar: only the clock on screen, now and then
  ["no seek bar, the clock on screen now and then", { seek: "none", shown: "sometimes", ad: "stitched" }, 0.35],
];
for (const [what, o, most] of cases) {
  const r = run(o);
  check(r.clockedAtEnd && r.worst < most && r.worstAfter < most,
    `${what}: off by at most ${r.worst.toFixed(2)} s before the ad, ${r.worstAfter.toFixed(2)} s after (allowed ${most})`);
}
const none = run({ seek: "none", shown: "never", ad: "stitched" });
check(!none.clockedAtEnd, "no clock to read at all: Prime's clock isn't taken as read");
console.log(bad ? `${bad} FAILED` : "ALL OK");
process.exit(bad ? 1 : 0);
