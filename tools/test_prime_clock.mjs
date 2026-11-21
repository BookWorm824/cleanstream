// Copyright (c) 2026 BookWorm824. All rights reserved. See LICENSE.
// Test: where CleanStream thinks a Prime Video title is (site_prime.js), through ads, with Prime's
// clock on screen behaving in different ways. The owner, 2026-11-21: "after 1 minute and a half ad
// the time got off", "after an ad the clock got off and it let a word through" (CleanStream's clock
// 26:05, Prime's 29:18). Played in Node with a stand-in player, 20 ms at a time, like site.js.
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(new URL("../extension/site_prime.js", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
let bad = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) bad++; };
const hms = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`; };

/** One run. opts.clock: "named" (Prime's usual name), "other" (a time with some other name), "none";
 *  opts.ad: "stitched" (inside the title's video) or "own" (a video of its own); opts.after: what
 *  Prime's clock shows just after the ad ("stale": the time from before it, for staleSecs, ticking on
 *  if staleTicks); opts.frozen: the clock only updates now and then (controls hidden). */
function run(opts) {
  let T = 0;                                         // seconds since the start
  globalThis.performance = { now: () => T * 1000 };
  Date.now = () => 1e12 + T * 1000;
  const el = (cls, text = "") => ({ cls, textContent: text, shown: true, childElementCount: 0, getClientRects() { return this.shown ? [1] : []; } });
  const clockEl = el(opts.clock === "named" ? "atvwebplayersdk-timeindicator-text" : "time-elapsed");
  const remain = el("time-left"), adTimer = el("atvwebplayersdk-adtimeindicator-text"), label = el("ad-label");
  adTimer.shown = false; label.shown = false;
  const leaves = [clockEl, remain, adTimer, label, el("title", "S1 E1 The Engram")];
  if (opts.clock === "none") clockEl.textContent = "";
  const box = { querySelectorAll: () => leaves.filter(x => x !== clockEl || opts.clock !== "none") };
  globalThis.document = {
    querySelector: sel => sel.includes("webPlayerSDKContainer") ? box
      : sel.includes("timeindicator-text") ? leaves.find(x => x.cls === "atvwebplayersdk-timeindicator-text") || null : null,
    querySelectorAll: sel => sel.includes("adtimeindicator") ? [adTimer]
      : sel.includes("timeindicator-text") ? leaves.filter(x => x.cls === "atvwebplayersdk-timeindicator-text") : [],
  };
  delete globalThis.CS_SITE;
  (0, eval)(fs.readFileSync(SRC, "utf8"));
  const S = globalThis.CS_SITE;

  const show = { currentTime: 1200, paused: false, readyState: 4, playbackRate: 1, duration: 4000 };
  const adVid = { currentTime: 0, paused: true, readyState: 4, playbackRate: 1, duration: 90 };
  let title = 1200;                                   // the title's real time (what the subtitles go by)
  const AD_AT = 60, AD_LEN = 90, END = AD_AT + AD_LEN + 60;
  let worst = 0, worstAfter = 0, clockedAtEnd = false, lastShownAt = -1;
  for (let k = 0; T < END; k++) {
    T = k * 0.02;
    const inAd = T >= AD_AT && T < AD_AT + AD_LEN;
    const after = T - (AD_AT + AD_LEN);
    // the videos
    if (inAd) {
      if (opts.ad === "stitched") show.currentTime += 0.02;
      else { show.paused = true; adVid.paused = false; adVid.currentTime += 0.02; }
    } else { show.paused = false; adVid.paused = true; show.currentTime += 0.02; title += 0.02; }
    // what's on screen
    adTimer.shown = inAd; label.shown = inAd; label.textContent = inAd ? "Ad 1 of 1" : "";
    adTimer.textContent = inAd ? hms(AD_AT + AD_LEN - T).slice(2) : "";
    remain.textContent = hms(4000 - title);           // counts down: never to be taken
    if (opts.clock !== "none") {
      const update = !opts.frozen || T < 8 || (T % 40 < 3);
      let shown = title;
      if (opts.after === "stale" && after >= 0 && after < opts.staleSecs)
        shown = 1200 + AD_AT + (opts.staleTicks ? after : 0);       // the time from before the ad
      if (!inAd && update) clockEl.textContent = hms(shown);
    }
    const v = inAd && opts.ad === "own" ? adVid : show;
    const r = S.time(v);
    if (!r.ad && !inAd && T > 10) {
      const err = Math.abs((r.clocked ? r.t : v.currentTime) - title);
      if (after < 0) worst = Math.max(worst, err);
      else if (after > (opts.after === "stale" ? opts.staleSecs + 2.5 : 0.1)) worstAfter = Math.max(worstAfter, err);
    }
    clockedAtEnd = r.clocked;
  }
  return { worst, worstAfter, clockedAtEnd };
}

const cases = [
  ["an ad inside the title's video, Prime's clock ticking", { clock: "named", ad: "stitched" }],
  ["the same, Prime's clock showing the time from before the ad for 2 s", { clock: "named", ad: "stitched", after: "stale", staleSecs: 2 }],
  ["the same, that old time ticking on for 4 s before the right one", { clock: "named", ad: "stitched", after: "stale", staleSecs: 4, staleTicks: true }],
  ["Prime's clock under another name (its player changed)", { clock: "other", ad: "stitched" }],
  ["Prime's clock only now and then (controls hidden)", { clock: "named", ad: "stitched", frozen: true }],
  ["an ad as a video of its own", { clock: "named", ad: "own" }],
];
for (const [what, o] of cases) {
  const r = run(o);
  check(r.clockedAtEnd && r.worst < 0.1 && r.worstAfter < 0.1,
    `${what}: off by at most ${r.worst.toFixed(2)} s before the ad, ${r.worstAfter.toFixed(2)} s after`);
}
// no clock CleanStream can read (only one counting down): it doesn't pretend to have read one
const none = run({ clock: "none", ad: "stitched" });
check(!none.clockedAtEnd, "only a clock counting down: Prime's clock isn't taken as read");
console.log(bad ? `${bad} FAILED` : "ALL OK");
process.exit(bad ? 1 : 0);
