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
 *  that long after it; opts.adMarked: whether CleanStream can tell an ad is on (default yes);
 *  opts.late: the "Ad" label shows up that long after the ad starts (and goes as late);
 *  opts.lateStart: it shows up that long after the ad starts, and goes as the ad ends;
 *  opts.linger: it stays up that long after the show is back on (the owner, 2026-11-25: "it said
 *  it was an ad" and the f word played); opts.seekAdTime: during the ad the seek bar counts the
 *  ad's own time from 0:00; opts.early: the label shows up that long before the ad starts.
 *  Right after the ad CleanStream's time may be "unsure": then site.js mutes UNSURE wider, so
 *  that much is forgiven (the owner, 2026-11-25: after an ad "i heard the f word"). */
const UNSURE = 0.6;
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
  let adOnShow = 0, adMissed = 0;
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
    if (k % 12 === 0 && opts.seekAdTime && inAd) seek.label = hms(Math.floor(T - AD_AT));
    else if (k % 12 === 0) {
      // "video": its share of the video's own length; "title": of the title's, ads left out
      seek.label = hms(Math.floor(reported)); seek.value = String(reported / (opts.seek === "video" ? show.duration : TOTAL) * 100);
    }
    const controls = opts.shown === "always" || (opts.shown === "sometimes" && (T < 8 || T % 40 < 3));
    clock.shown = left.shown = controls && !inAd;
    clock.textContent = hms(Math.round(reported)); left.textContent = hms(TOTAL - reported);
    adLabel.shown = T >= AD_AT + (opts.late || opts.lateStart || 0) - (opts.early || 0) && T < AD_AT + AD_LEN + (opts.late || opts.linger || 0) && opts.adMarked !== false; adLabel.textContent = "Ad 1 of 1";
    const v = inAd && opts.ad === "own" ? adVid : show;
    const r = S.time(v);
    if (inAd && !r.ad && opts.adMarked !== false && T > AD_AT + (opts.late || opts.lateStart || 0) + 0.1) adMissed += 0.02;
    if (!inAd && r.ad && after >= 0) adOnShow += 0.02;          // the show on, taken for an ad
    if (!inAd && T > 10 && !r.ad && !(opts.late && after >= 0 && after < opts.late)) {
      const err = Math.max(0, Math.abs((r.clocked ? r.t : v.currentTime) - title) - (r.unsure ? UNSURE : 0));
      if (after < 0) worst = Math.max(worst, err);
      else worstAfter = Math.max(worstAfter, err);     // from the moment the show is back
    }
    clockedAtEnd = r.clocked;
  }
  return { worst, worstAfter, clockedAtEnd, adOnShow, adMissed };
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
  ["the same, the \"Ad\" label coming and going 0.6 s late", { seek: "title", shown: "never", ad: "stitched", late: 0.6 }, 0.2],
  ["the same, the \"Ad\" label showing up 0.6 s late", { seek: "title", shown: "never", ad: "stitched", lateStart: 0.6 }, 0.2],
  ["no seek bar, the clock on screen now and then, the \"Ad\" label showing up 0.6 s late", { seek: "none", shown: "sometimes", ad: "stitched", lateStart: 0.6 }, 0.35],
  // no seek bar: only the clock on screen, now and then
  ["no seek bar, the clock on screen now and then", { seek: "none", shown: "sometimes", ad: "stitched" }, 0.35],
];
for (const [what, o, most] of cases) {
  const r = run(o);
  check(r.clockedAtEnd && r.worst < most && r.worstAfter < most,
    `${what}: off by at most ${r.worst.toFixed(2)} s before the ad, ${r.worstAfter.toFixed(2)} s after (allowed ${most})`);
}
for (const [what, o] of [
  ["an ad inside the video, the \"Ad\" label staying up 4 s after the show is back", { seek: "title", shown: "never", ad: "stitched", linger: 4 }],
  ["an ad as a video of its own, the seek bar counting the ad's time, the label staying up 4 s", { seek: "title", shown: "never", ad: "own", seekAdTime: true, linger: 4 }],
  ["the same, the ad inside the video", { seek: "title", shown: "never", ad: "stitched", seekAdTime: true, linger: 4 }],
  ["an ad inside the video, the label showing up 1.5 s early and staying up 4 s", { seek: "title", shown: "never", ad: "stitched", early: 1.5, linger: 4 }],
  ["the same, the seek bar counting the ad's time", { seek: "title", shown: "never", ad: "stitched", seekAdTime: true, early: 1.5, linger: 4 }],
]) {
  const r = run(o);
  check(r.adOnShow < 1.3 && r.adMissed === 0 && r.worstAfter < 0.2 && r.clockedAtEnd,
    `${what}: the show taken for an ad for ${r.adOnShow.toFixed(2)} s, the ad missed for ${r.adMissed.toFixed(2)} s, off by at most ${r.worstAfter.toFixed(2)} s after`);
}
const none = run({ seek: "none", shown: "never", ad: "stitched" });
check(!none.clockedAtEnd, "no clock to read at all: Prime's clock isn't taken as read");
console.log(bad ? `${bad} FAILED` : "ALL OK");
process.exit(bad ? 1 : 0);
