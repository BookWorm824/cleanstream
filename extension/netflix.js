// CleanStream on Netflix (language only; the picture is copy-protected): gets the English
// subtitles through netflix_page.js, works out what to mute with CleanView's word lists
// (captions.js), keeps the sound off from the start of a title until that's done, and mutes at
// the right moments. Netflix's subtitles give a line at a time, so each word's moment is
// guessed within its line and muted a little wider (as YouTube's written captions).
(function () {
  if (window.__cleanstreamNf) return;
  window.__cleanstreamNf = true;
  const TAG = "cleanstream";
  const CC = globalThis.CSCaptions, CS = globalThis.CSWords, S = globalThis.CSSettings;
  const st = { video: null, settings: null, ticks: null, tracks: null, plan: null, ranges: [],
    status: "", captions: "waiting", weMuted: false, holding: false, scenes: [] };
  globalThis.__cleanstreamState = st;

  // ---------- the status line ----------
  let pill, pillTimer;
  function say(text, secs = 6) {
    st.status = text;
    const host = document.querySelector(".watch-video") || document.body;
    if (!pill || !host.contains(pill)) {
      pill = document.createElement("div");
      pill.id = "cleanstream-status";
      pill.style.cssText = "position:fixed;top:14px;left:14px;z-index:2147483646;max-width:60%;" +
        "padding:7px 12px;border-radius:14px;background:rgba(20,40,35,.85);color:#fff;" +
        "font:500 15px/1.35 'Segoe UI',Arial,sans-serif;pointer-events:none;transition:opacity .4s;";
      host.appendChild(pill);
    }
    pill.textContent = text;
    pill.style.opacity = "1";
    clearTimeout(pillTimer);
    if (secs) pillTimer = setTimeout(() => { pill.style.opacity = "0"; }, secs * 1000);
  }

  const videoEl = () => document.querySelector(".watch-video video") || document.querySelector("video");
  const currentTitle = () => (/^\/watch\/(\d+)/.exec(location.pathname) || [])[1] || null;

  // ---------- muting ----------
  function inRange(t, ranges, lead) {
    let lo = 0, hi = ranges.length - 1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (ranges[mid][0] <= t + lead) lo = mid + 1; else hi = mid - 1; }
    return hi >= 0 && t < ranges[hi][1];
  }
  function mute() { const v = videoEl(); if (v && !v.muted) { v.muted = true; st.weMuted = true; } }
  function unmute() { const v = videoEl(); if (st.weMuted && v) v.muted = false; st.weMuted = false; }
  function tick() {
    const v = videoEl();
    if (!v || !st.settings || !st.settings.on || !st.video) return;
    const rate = v.playbackRate || 1;
    const want = st.holding || (!v.paused && inRange(v.currentTime, st.ranges, 0.08 * rate));
    if (want && !v.muted) mute();
    else if (!want && st.weMuted) unmute();
  }
  setInterval(tick, 20);
  document.addEventListener("seeked", tick, true);
  document.addEventListener("play", tick, true);
  document.addEventListener("playing", tick, true);
  document.addEventListener("loadstart", tick, true);
  document.addEventListener("volumechange", e => {
    if (e.target !== videoEl() || e.target.muted) return;
    if (st.weMuted) st.weMuted = false;
    tick();
  }, true);

  // ---------- subtitles ----------
  const HOLD_MOST = 30;
  let holdTimer = null;
  function hold(on) {
    st.holding = on;
    clearTimeout(holdTimer);
    if (on) holdTimer = setTimeout(() => {
      if (!st.holding) return;
      st.holding = false;
      say("CleanStream couldn't get this title's subtitles in time, so bad language won't be muted. " +
        "Reloading the page may help.", 10);
    }, HOLD_MOST * 1000);
    tick();
  }
  function replan() {
    if (!st.tracks || !st.settings) return;
    st.ticks = S.ticksFor(st.settings);
    st.plan = CC.plan(st.tracks, st.ticks, st.settings.mine);
    st.ranges = st.settings.on ? CC.ranges(st.plan.mutes) : [];
    chrome.runtime.sendMessage({ type: "found", video: st.video, count: st.plan.mutes.length }).catch(() => {});
  }
  function subsArrived(d) {
    if (d.title !== st.video) return;
    hold(false);
    if (d.none) {
      st.captions = "none";
      say(d.others ? "CleanStream: this title only has subtitles in another language, so bad language can't be muted yet."
        : "CleanStream: this title has no subtitles, so bad language can't be muted.", 9);
      return;
    }
    let cues = null;
    try { cues = d.text ? CC.readSubtitles(d.text) : null; } catch (e) { cues = null; }
    if (!(cues && cues.length)) {
      st.captions = "empty";
      say("CleanStream couldn't read this title's subtitles, so bad language won't be muted. Reloading the page may help.", 10);
      return;
    }
    st.tracks = { written: cues, auto: null };
    st.captions = "ok";
    replan();
    const n = st.plan.mutes.length;
    say(n ? `CleanStream: ${n} ${n === 1 ? "word or phrase" : "words or phrases"} will be muted.`
      : "CleanStream: nothing to mute in this title's subtitles.");
  }

  function startTitle(id) {
    st.video = id; st.tracks = null; st.plan = null; st.ranges = []; st.captions = "waiting";
    unmute(); hold(false);
    if (!id || !st.settings || !st.settings.on) return;
    hold(true);
    say("CleanStream is getting this title's subtitles (the sound is off until it's ready)…", 0);
    window.postMessage({ [TAG]: "nf-content", type: "get-subs", title: id }, "*");
  }
  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== "nf-page") return;
    if (d.type === "subs-done") subsArrived(d);
  });

  // ---------- following Netflix's page changes (it doesn't reload between titles) ----------
  function check() {
    if (!(chrome.runtime && chrome.runtime.id) && !st.toldUpdated) {
      st.toldUpdated = true;
      say("CleanStream was updated. Press F5 to use the new version.", 12);
    }
    const id = currentTitle();
    if (id !== st.video) startTitle(id);
  }
  setInterval(check, 500);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    const was = st.settings && st.settings.on;
    st.settings = await S.load();
    if (!st.settings.on) { st.ranges = []; hold(false); unmute(); return; }
    if (!was) { st.video = null; check(); return; }
    replan();
  });

  // ---------- the settings window asks what was found ----------
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type !== "state") return;
    const v = videoEl();
    reply({ video: st.video, title: document.title.replace(/ - Netflix$/, ""), captions: st.captions,
      status: st.status, source: st.plan && "netflix", now: v ? v.currentTime : 0,
      mutes: st.plan ? st.plan.mutes.map(m => ({ s: m.s, text: CS.mask(m.text), why: m.why, guess: false })) : [],
      left: st.plan ? st.plan.left.map(m => ({ s: m.s, text: m.text, why: m.why })) : [],
      scenes: [], picture: null, site: "netflix" });
  });

  (async () => { st.settings = await S.load(); check(); })();
})();
