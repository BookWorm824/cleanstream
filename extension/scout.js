// The look-ahead player: a hidden, muted copy of the video (a copy of the watch page in a
// frame named "cleanstream-scout") that runs ahead of the one being watched, faster than
// normal, so its stills can be checked before those moments are shown. Runs inside that
// hidden copy only. Each still goes to the picture check (offscreen.js) and its scores go
// back to the watch page (picture.js).
(function () {
  if (window.top === window || window.name !== "cleanstream-scout") return;
  const TAG = "cleanstream";
  const STEP = 0.5;                       // seconds of video between stills (CleanView: 2 a second)
  // how fast the look-ahead player may run (8 was too much for the owner's laptop on a long
  // video: YouTube stopped responding twice, 2026-11-17)
  const FAST = 4, SLOWEST = 1;
  const MAX_WAITING = 3;                  // stills waiting for the check before it slows down
  const DARK_MEAN = 40, FLAT_STD = 18;    // too dark or murky to judge (cleanview.too_dark)
  const video = new URLSearchParams(location.search).get("v");
  const sameVideo = () => new URLSearchParams(location.search).get("v") === video;
  const tell = (type, data) => window.top.postMessage({ [TAG]: "scout", type, video, ...data }, "*");

  let v = null, next = 0, waiting = 0, rate = 4, stopped = false, lastSent = -1, resting = false;
  const c = document.createElement("canvas"), g = c.getContext("2d", { willReadFrequently: true });

  // for looking into problems (tools/debug_scout.mjs)
  globalThis.__cleanstreamScout = () => ({ video, t: v && v.currentTime, next, waiting, rate,
    stopped, lastSent, sent, answered, problem });
  let sent = 0, answered = 0, problem = null;

  function setRate() {
    if (document.querySelector("#movie_player.ad-showing")) return;
    if (v && Math.abs(v.playbackRate - rate) > 0.01) {
      try { v.playbackRate = rate; } catch (e) { /* not allowed: leave it */ }
    }
  }

  function grab(t) {
    const W = v.videoWidth, H = v.videoHeight;
    if (!W || !H) return;
    const s = 320 / Math.max(W, H);
    c.width = Math.round(W * s); c.height = Math.round(H * s);
    g.drawImage(v, 0, 0, c.width, c.height);
    // brightness and contrast, to leave out frames too dark to judge
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let sum = 0, sq = 0, n = 0;
    for (let i = 0; i < px.length; i += 16) {
      const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      sum += l; sq += l * l; n++;
    }
    const mean = sum / n, std = Math.sqrt(Math.max(0, sq / n - mean * mean));
    if (Math.round(mean) < DARK_MEAN || Math.round(std) < FLAT_STD) { tell("frame", { t, dark: true }); return; }
    const jpeg = c.toDataURL("image/jpeg", 0.85);
    waiting++; sent++;
    chrome.runtime.sendMessage({ type: "frame", jpeg }).then(r => {
      waiting--; answered++;
      if (!(r && r.scores)) problem = (r && r.error) || "no answer";
      if (r && r.scores) tell("frame", { t, scores: r.scores, ms: r.ms });
      else tell("problem", { t, error: (r && r.error) || "no answer" });
    }, e => { waiting--; problem = String(e && e.message || e); tell("problem", { t, error: String(e && e.message || e) }); });
  }

  // a frame callback (requestVideoFrameCallback) never comes for a player that isn't drawn on
  // screen, so the video's clock is looked at often instead
  // YouTube can swap the video element (after an ad, for one), so it's looked up each time:
  // the one that's playing
  const findVideo = () => {
    const all = [...document.querySelectorAll("#movie_player video")];
    return all.find(x => !x.paused && x.readyState >= 2) || all[0] || null;
  };

  function onFrame() {
    const now = findVideo();
    if (now && now !== v) { v = now; v.addEventListener("ratechange", setRate); }
    if (v && !v.muted) v.muted = true;      // YouTube can turn the sound back on
    if (stopped || !v || v.paused || v.readyState < 2) return;
    if (!sameVideo()) { stopped = true; v.pause(); tell("ended", { t: v.currentTime }); return; }
    const ad = document.querySelector("#movie_player.ad-showing");
    const t = v.currentTime;
    if (!ad && t + 1e-3 >= next) {
      const at = Math.round(t / STEP) * STEP;
      if (at !== lastSent) { lastSent = at; grab(at); }
      next = Math.floor(t / STEP) * STEP + STEP;
    }
    // keep up with the check: slow down while stills wait, speed up when it's free. Ads are
    // left alone, at their normal speed.
    if (ad) { if (v.playbackRate !== 1) v.playbackRate = 1; }
    else {
      if (waiting > MAX_WAITING && rate > SLOWEST) rate = Math.max(SLOWEST, rate / 2);
      else if (waiting === 0 && rate < FAST) rate = Math.min(FAST, rate * 1.25);
      setRate();
    }
  }

  function begin() {
    v = findVideo();
    if (!v) return false;
    v.muted = true;
    v.addEventListener("ended", () => tell("ended", { t: v.duration }));
    v.addEventListener("ratechange", setRate);
    if (v.paused) v.play().catch(() => {});
    next = Math.floor(v.currentTime / STEP) * STEP;
    setInterval(onFrame, 40);
    tell("started", { t: v.currentTime, duration: v.duration });
    return true;
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window.top || !d || d[TAG] !== "picture") return;
    if (d.type === "seek" && v) { resting = false; v.currentTime = d.to; next = Math.floor(d.to / STEP) * STEP; lastSent = -1; if (v.paused) v.play().catch(() => {}); }
    // far enough ahead: rest (paused) until the watch page says to go on
    if (d.type === "rest") { resting = true; if (v) v.pause(); }
    if (d.type === "go") { resting = false; if (v && v.paused) v.play().catch(() => {}); }
    if (d.type === "stop") { stopped = true; if (v) v.pause(); }
  });

  // YouTube's "Video unavailable" / sign-in boxes instead of a playing video
  const unplayable = () => !!document.querySelector("#movie_player .ytp-error, " +
    "yt-playability-error-supported-renderers:not([hidden])");

  let tries = 0;
  (function wait() {
    if (begin()) return;
    if (++tries > 60) { tell("failed", { why: "no video" }); return; }
    if (unplayable()) { tell("failed", { why: "unplayable" }); return; }
    setTimeout(wait, 500);
  })();
  setInterval(() => {
    if (!v || stopped || resting) return;
    if (v.paused && !v.ended) v.play().catch(() => {});
    if (unplayable()) { stopped = true; tell("failed", { why: "unplayable" }); }
  }, 2000);
})();
