// The picture check on the watch page: starts the hidden look-ahead player (scout.js), turns
// the scores it sends into scenes the way CleanView does (cleanview.nudity_scenes), and keeps
// them for next time. content.js skips a scene when the video reaches it.
(function () {
  const TAG = "cleanstream", STEP = 0.5;
  // CleanView's thresholds (cleanview.NUDITY), in the order offscreen.js sends scores
  const NUDITY = [0.6, 0.55, 0.55, 0.6, 0.55];   // breast, female genitals, male genitals, buttocks, anus
  const GAP = 5.0, PAD = 1.5;                     // hits this close are one scene; widened by PAD
  const AHEAD_WANTED = 20;                        // seconds checked ahead before a moment is shown
  // The look-ahead copy rests once it's this far ahead, and starts again when it's down to
  // AHEAD_RESUME: it used to run to the end of the video, which on a 3-hour video kept a second
  // YouTube page busy for most of an hour (YouTube stopped responding, 2026-11-17).
  const AHEAD_MOST = 120, AHEAD_RESUME = 60;
  let resting = false;

  let st = null, video = null, frame = null, scores = {}, failed = null, started = false,
    saveTimer = null, ended = false, lastProblem = null;

  const on = () => !!(st && st.settings && st.settings.on && st.settings.picture !== false &&
    globalThis.CSSettings.ticksFor(st.settings).nudity);
  const slot = t => Math.round(t / STEP) * STEP;
  const clock = t => { t = Math.max(0, Math.floor(t)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };

  /** Scenes from the frame scores, as cleanview.nudity_scenes (dark frames left out). */
  function scenes() {
    const hits = [], strong = {};
    for (const [k, row] of Object.entries(scores)) {
      if (!row) continue;                        // dark: not judged
      const t = +k;
      let best = 0, bi = -1;
      NUDITY.forEach((th, i) => { if (row[i] / th > best) { best = row[i] / th; bi = i; } });
      if (best >= 1) { hits.push(t); strong[t] = row[bi]; }
    }
    hits.sort((a, b) => a - b);
    const runs = [];
    for (const t of hits) {
      const last = runs[runs.length - 1];
      if (last && t - last[last.length - 1] <= GAP) last.push(t); else runs.push([t]);
    }
    const out = [];
    for (const run of runs) {
      const peak = Math.max(...run.map(t => strong[t]));
      if (run.length < 3 && peak < 0.85) continue;      // brief or weak: usually a false alarm
      out.push({ from: Math.max(0, run[0] - PAD), to: run[run.length - 1] + PAD, why: "Nudity",
        skip: true, peak, frames: run.length });
    }
    return out;
  }

  function update() {
    if (!st) return;
    st.scenes = on() ? scenes() : [];
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 5000);
  }

  async function save() {
    if (!video) return;
    try { await chrome.storage.local.set({ ["pic:" + video]: { step: STEP, scores, ended, at: Date.now() } }); }
    catch (e) { /* storage full: carry on without keeping it */ }
  }

  /** How far past t the picture has been checked without a gap. */
  function checkedTo(t) {
    // a missed still here and there (the look-ahead player ran fast) isn't a gap
    let k = slot(Math.max(0, t));
    while (k in scores || (k + STEP) in scores || (k + 2 * STEP) in scores) k += STEP;
    return k;
  }

  function scoutAt(t) {
    stopScout();
    resting = false;
    if (!on() || failed) return;
    frame = document.createElement("iframe");
    frame.id = "cleanstream-scout";
    frame.name = "cleanstream-scout";             // how scout.js knows it's the look-ahead player
    frame.allow = "autoplay";
    // YouTube's embed player refuses to play inside YouTube's own page (error 152), so the
    // look-ahead player is a hidden copy of the watch page itself
    frame.src = `https://www.youtube.com/watch?v=${video}&t=${Math.floor(t)}s`;
    // nearly invisible, but on the page: a muted player out of sight may be paused by Chrome
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:320px;height:180px;opacity:0;" +
      "pointer-events:none;border:0;z-index:2147483647;";
    document.documentElement.appendChild(frame);
  }
  function stopScout() {
    if (frame) { frame.remove(); frame = null; }
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (!d || d[TAG] !== "scout" || d.video !== video || !frame || e.source !== frame.contentWindow) return;
    if (d.type === "started") started = true;
    if (d.type === "frame") { scores[slot(d.t)] = d.dark ? null : d.scores; update(); }
    if (d.type === "problem") lastProblem = d.error;
    if (d.type === "ended") { ended = true; save(); stopScout(); }
    if (d.type === "failed") {
      failed = d.why === "unplayable" ? "this video can't be played in the hidden look-ahead player"
        : "the hidden look-ahead player didn't start";
      stopScout();
    }
  });

  // keep the look-ahead player ahead of what's being watched
  setInterval(() => {
    if (!st || !video || !on() || failed) return;
    const v = document.querySelector("#movie_player video");
    if (!v) return;
    const t = v.currentTime, upTo = checkedTo(t);
    const duration = v.duration || Infinity;
    if (upTo >= duration - 1) { stopScout(); return; }
    if (!frame) { scoutAt(upTo); return; }
    if (!started) return;
    const tell = (type, extra) => frame.contentWindow.postMessage({ [TAG]: "picture", type, ...extra }, "*");
    // watching has jumped past what's checked (or the look-ahead has fallen behind): move it
    if (upTo - t < 2) { resting = false; tell("seek", { to: upTo }); return; }
    if (!resting && upTo - t > AHEAD_MOST) { resting = true; tell("rest"); }
    else if (resting && upTo - t < AHEAD_RESUME) { resting = false; tell("go"); }
  }, 1500);

  globalThis.CSPicture = {
    async start(id, state) {
      st = state; video = id; scores = {}; failed = null; started = false; ended = false;
      stopScout();
      if (!on()) return;
      const kept = (await chrome.storage.local.get("pic:" + id))["pic:" + id];
      if (video !== id) return;
      if (kept && kept.step === STEP) { scores = kept.scores || {}; ended = !!kept.ended; }
      update();
    },
    settingsChanged(state) {
      st = state;
      if (!on()) { stopScout(); st.scenes = []; return; }
      update();
    },
    report() {
      if (!st || !on()) return null;
      const v = document.querySelector("#movie_player video");
      const t = v ? v.currentTime : 0;
      if (failed) return { say: `The picture can't be checked: ${failed}.` };
      const upTo = checkedTo(t);
      const n = st.scenes.length;
      const found = n ? ` ${n} nudity ${n === 1 ? "scene" : "scenes"} found.` : "";
      if (v && upTo >= (v.duration || Infinity) - 1) return { say: "The picture is checked to the end." + found };
      if (!started && !Object.keys(scores).length) return { say: "The picture check is starting…" };
      const ahead = upTo - t;
      return { say: (ahead >= AHEAD_WANTED ? `The picture is checked up to ${clock(upTo)}.`
        : `The picture check is only ${Math.max(0, Math.round(ahead))} seconds ahead.`) + found,
        problem: lastProblem };
    },
    _scores: () => scores,
  };
})();
