// CleanStream on a YouTube page: gets the video's captions (through page.js), works out what
// to mute (captions.js, with CleanView's word lists), mutes at the right moments, and shows a
// short status line on the video. Language only (the owner, 2026-11-18: "language checker only").
// Nothing is saved or copied: it all happens while the video plays.
(function () {
  if (window.__cleanstream) return;
  window.__cleanstream = true;
  const TAG = "cleanstream";
  const CC = globalThis.CSCaptions, CS = globalThis.CSWords, S = globalThis.CSSettings;

  const st = { video: null, settings: null, ticks: null, tracks: null, plan: null, ranges: [],
    status: "", captions: "waiting", weMuted: false, title: "" };
  globalThis.__cleanstreamState = st;          // for the tests

  // ---------- the status line on the video ----------
  let pill, pillTimer;
  function say(text, secs = 6) {
    st.status = text;
    const host = document.getElementById("movie_player");
    if (!host) return;
    if (!pill || !host.contains(pill)) {
      pill = document.createElement("div");
      pill.id = "cleanstream-status";
      pill.style.cssText = "position:absolute;top:12px;left:12px;z-index:60;max-width:70%;" +
        "padding:7px 12px;border-radius:14px;background:rgba(20,40,35,.82);color:#fff;" +
        "font:500 14px/1.35 Roboto,Arial,sans-serif;pointer-events:none;transition:opacity .4s;";
      host.appendChild(pill);
    }
    pill.textContent = text;
    pill.style.opacity = "1";
    clearTimeout(pillTimer);
    if (secs) pillTimer = setTimeout(() => { pill.style.opacity = "0"; }, secs * 1000);
  }

  // ---------- which video ----------
  const videoEl = () => document.querySelector("#movie_player video.html5-main-video") ||
    document.querySelector("#movie_player video");
  const adShowing = () => !!document.querySelector("#movie_player.ad-showing, #movie_player.ad-interrupting");
  function currentVideo() {
    if (location.pathname !== "/watch") return null;
    return new URLSearchParams(location.search).get("v");
  }

  // ---------- captions ----------
  function parse(text, asr) {
    if (!text) return null;
    text = text.trim();
    if (text.startsWith("{")) {
      try { return CC.readJson3(JSON.parse(text), asr); } catch (e) { return null; }
    }
    if (text.startsWith("<")) {                 // srv3 / XML captions, just in case
      const doc = new DOMParser().parseFromString(text, "text/xml");
      const events = [...doc.querySelectorAll("p")].map(p => {
        const segs = [...p.querySelectorAll("s")];
        return { tStartMs: +p.getAttribute("t"), dDurationMs: +p.getAttribute("d") || 0,
          segs: segs.length ? segs.map(s => ({ utf8: s.textContent + " ", tOffsetMs: +s.getAttribute("t") || 0 }))
            : [{ utf8: p.textContent }] };
      });
      return CC.readJson3({ events }, asr);
    }
    return null;
  }

  function replan() {
    if (!st.tracks || !st.settings) return;
    st.ticks = S.ticksFor(st.settings);
    st.plan = CC.plan(st.tracks, st.ticks, st.settings.mine);
    st.ranges = st.settings.on ? CC.ranges(st.plan.mutes) : [];
    chrome.runtime.sendMessage({ type: "found", video: st.video, count: st.plan.mutes.length }).catch(() => {});
  }

  // The sound is kept off from the start of a video until its captions are in (or it's known
  // there are none), so nothing said in the first seconds slips through (the owner's comedy
  // video, 2026-11-17: an F word 8 seconds in). Ads aren't held.
  const HOLD_MOST = 25;                       // seconds: give up waiting and let the sound on
  let holdTimer = null;
  function hold(on) {
    st.holding = on;
    clearTimeout(holdTimer);
    if (on) holdTimer = setTimeout(() => {
      if (!st.holding) return;
      st.holding = false;
      say("CleanStream couldn't get this video's captions in time, so bad language won't be muted. " +
        "Reloading the page may help.", 10);
    }, HOLD_MOST * 1000);
    tick();
  }

  function captionsArrived(d) {
    if (d.video !== st.video) return;
    // asked while an ad was starting, or the player wasn't ready: ask once more before giving up
    // (the owner, 2026-11-18: after an ad it didn't find the captions; F5 found 170 things)
    if ((d.error || (!d.none && !d.written && !d.auto)) && !st.askedAgain && st.askAgain) {
      st.askedAgain = true;
      st.askAgain();
      return;
    }
    hold(false);
    if (d.error) {
      st.captions = "error";
      say("CleanStream couldn't read this video's captions, so bad language won't be muted. " +
        "Reloading the page may help.", 10);
      return;
    }
    if (d.none) {
      st.captions = "none";
      say(d.others ? "CleanStream: this video only has captions in another language, so bad " +
        "language can't be muted yet." : "CleanStream: this video has no captions, so bad " +
        "language can't be muted.", 9);
      return;
    }
    const written = parse(d.written, false), auto = parse(d.auto, true);
    if (!(written && written.length) && !(auto && auto.length)) {
      st.captions = "empty";
      say("CleanStream couldn't read this video's captions, so bad language won't be muted. " +
        "Reloading the page may help.", 10);
      return;
    }
    st.tracks = { written, auto };
    st.captions = "ok";
    replan();
    const n = st.plan.mutes.length;
    say(n ? `CleanStream: ${n} ${n === 1 ? "word or phrase" : "words or phrases"} will be muted.`
      : "CleanStream: nothing to mute in this video's captions.");
  }

  function startVideo(id) {
    st.video = id; st.tracks = null; st.plan = null; st.ranges = []; st.captions = "waiting";
    // early.js may have muted it before this started: take that mute over (so it's undone
    // when the captions are in, or now if CleanStream is off)
    const early = globalThis.__csEarlyMuted;
    globalThis.__csEarlyMuted = false; globalThis.__csArmed = false;
    if (early) st.weMuted = true; else unmute();
    hold(false);
    if (!st.settings || !st.settings.on) { unmute(); return; }
    hold(true);
    say("CleanStream is getting this video's captions (the sound is off until it's ready)…", 0);
    // the player must have this video loaded before its captions can be asked for, and not be
    // playing an ad: asked during an ad, the answer was the ad's (no captions)
    let tries = 0, adFirst = false;
    st.askedAgain = false;
    const ask = () => {
      if (st.video !== id) return;
      if (adShowing()) {
        if (!adFirst) say("CleanStream will get this video's captions when the ad ends…", 0);
        adFirst = true;
        hold(true);                             // the waiting starts again after the ad
        setTimeout(ask, 500);
        return;
      }
      if (adFirst) {                            // the ad just ended: let the video load first
        adFirst = false;
        say("CleanStream is getting this video's captions (the sound is off until it's ready)…", 0);
        setTimeout(ask, 1000);
        return;
      }
      const p = document.getElementById("movie_player");
      if (!p || !videoEl() || tries++ > 60) {
        if (tries > 60) say("CleanStream couldn't find the video player on this page.", 8);
        else setTimeout(ask, 500);
        return;
      }
      window.postMessage({ [TAG]: "content", type: "get-captions", video: id }, "*");
    };
    st.askAgain = () => { tries = 0; hold(true); setTimeout(ask, 1500); };
    setTimeout(ask, 800);
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== "page") return;
    if (d.type === "captions-done") captionsArrived(d);
  });

  // ---------- muting at the right moment ----------
  function inRange(t, ranges, lead) {
    let lo = 0, hi = ranges.length - 1;
    while (lo <= hi) {                          // binary search: the last range starting <= t+lead
      const mid = (lo + hi) >> 1;
      if (ranges[mid][0] <= t + lead) lo = mid + 1; else hi = mid - 1;
    }
    return hi >= 0 && t < ranges[hi][1];
  }
  function mute() {
    const v = videoEl();
    if (v && !v.muted) { v.muted = true; st.weMuted = true; }
  }
  function unmute() {
    const v = videoEl();
    if (st.weMuted && v) v.muted = false;
    st.weMuted = false;
  }
  function tick() {
    const v = videoEl();
    if (!v || !st.settings || !st.settings.on) return;
    if (adShowing()) { unmute(); return; }
    const t = v.currentTime, rate = v.playbackRate || 1;
    // muted a moment early (the tick runs every 20 ms, and muting takes a moment to be heard)
    const want = st.holding || (!v.paused && inRange(t, st.ranges, 0.08 * rate));
    // muted whenever it should be, even when something (YouTube putting its own sound setting
    // back as a video starts) turned the sound on again: that used to let the first "porn" of a
    // video through (2026-11-17)
    if (want && !v.muted) mute();
    else if (!want && st.weMuted) unmute();
  }
  setInterval(tick, 20);
  document.addEventListener("seeked", tick, true);
  document.addEventListener("play", tick, true);
  // the sound turned on while CleanStream wants it off (YouTube restoring its own setting, or a
  // click on the speaker during a muted word or the first seconds): off again straight away
  document.addEventListener("volumechange", e => {
    if (e.target !== videoEl() || e.target.muted) return;
    if (st.weMuted) st.weMuted = false;
    tick();
  }, true);

  // ---------- captions shown on screen: listed words shown as d***, so they aren't read ----------
  function maskShown() {
    if (!st.settings || !st.settings.on || !st.ticks) return;
    const cats = CS.catsFor(st.ticks);
    for (const seg of document.querySelectorAll("#movie_player .ytp-caption-segment")) {
      if (seg.dataset.csShown === seg.textContent) continue;
      const parts = seg.textContent.split(/(\s+)/);
      const idx = [], words = [];
      parts.forEach((p, k) => { if (p.trim()) { idx.push(k); words.push(CS.norm(p)); } });
      const hits = CS.findLanguage(words, cats, []);
      for (const [a, b] of hits) for (let k = a; k < b; k++) parts[idx[k]] = CS.mask(parts[idx[k]]);
      const out = parts.join("");
      seg.textContent = out;
      seg.dataset.csShown = out;
    }
  }
  new MutationObserver(maskShown).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  // ---------- following YouTube's page changes ----------
  function check() {
    // CleanStream was updated (it reloads itself): this page still runs the old copy
    if (!(chrome.runtime && chrome.runtime.id) && !st.toldUpdated) {
      st.toldUpdated = true;
      say("CleanStream was updated. Press F5 to use the new version.", 12);
    }
    const id = currentVideo();
    if (id !== st.video) {
      if (id) startVideo(id);
      else { st.video = null; st.ranges = []; unmute(); }
    }
  }
  document.addEventListener("yt-navigate-finish", () => setTimeout(check, 300));
  setInterval(check, 1000);

  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "sync") return;
    const was = st.settings && st.settings.on;
    st.settings = await S.load();
    if (!st.settings.on) { st.ranges = []; unmute(); return; }
    if (!was) { st.video = null; check(); return; }
    replan();
  });

  // ---------- the popup asks what was found ----------
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg.type !== "state") return;
    const v = videoEl();
    reply({ video: st.video, title: document.title.replace(/ - YouTube$/, ""), captions: st.captions,
      status: st.status, source: st.plan && st.plan.source, now: v ? v.currentTime : 0,
      mutes: st.plan ? st.plan.mutes.map(m => ({ s: m.s, text: CS.mask(m.text), why: m.why,
        guess: !m.timed })) : [],
      left: st.plan ? st.plan.left.map(m => ({ s: m.s, text: m.text, why: m.why })) : [] });
  });

  (async () => { st.settings = await S.load(); check(); })();
})();
