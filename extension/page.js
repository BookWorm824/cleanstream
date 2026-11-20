// Runs inside YouTube's own page (not the extension's), because only there can CleanStream
// see the captions YouTube's player downloads, and ask the player for a caption track.
// YouTube now refuses caption downloads that don't come from its player, so CleanStream
// asks the player to load the English tracks and reads what comes back. It talks to
// content.js with window.postMessage (both run in the same page).
(function () {
  if (window.__cleanstreamPage) return;
  window.__cleanstreamPage = true;
  const TAG = "cleanstream";
  const said = (type, data) => window.postMessage({ [TAG]: "page", type, ...data }, "*");
  const seen = new Map();          // caption address -> text, for this page

  const pass = new Map();          // video -> a caption address the player made (it carries YouTube's pass)
  function caught(url, text) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.includes("/api/timedtext")) return;
      if (u.searchParams.get("pot")) pass.set(u.searchParams.get("v"), u);
      const key = [u.searchParams.get("v"), u.searchParams.get("lang"),
        u.searchParams.get("kind") || "", u.searchParams.get("tlang") || ""].join("|");
      seen.set(key, text);
      said("captions", { key, video: u.searchParams.get("v"), lang: u.searchParams.get("lang"),
        kind: u.searchParams.get("kind") || "", fmt: u.searchParams.get("fmt") || "",
        translated: !!u.searchParams.get("tlang"), text });
    } catch (e) { /* not a caption address */ }
  }

  // ---- watching the player's own caption downloads ----
  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__csUrl = String(url); return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    if (this.__csUrl && this.__csUrl.includes("/api/timedtext")) {
      this.addEventListener("load", () => {
        try { caught(this.__csUrl, typeof this.response === "string" ? this.response : this.responseText); }
        catch (e) { /* binary */ }
      });
    }
    return XS.apply(this, arguments);
  };
  const F = window.fetch;
  window.fetch = function (input) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const p = F.apply(this, arguments);
    if (url.includes("/api/timedtext"))
      p.then(r => r.clone().text()).then(t => caught(url, t)).catch(() => {});
    return p;
  };

  // the regular player on /watch, the Shorts one on /shorts/<id> (2026-11-19)
  const player = () => location.pathname.startsWith("/shorts/")
    ? document.querySelector("ytd-reel-video-renderer[is-active] #shorts-player") || document.getElementById("shorts-player") ||
      document.querySelector("ytd-reel-video-renderer[is-active] .html5-video-player")
    : document.getElementById("movie_player");
  const wait = ms => new Promise(r => setTimeout(r, ms));

  // hide captions on screen while CleanStream switches tracks, so nothing flashes up
  function hideCaptions(on) {
    let st = document.getElementById("cleanstream-hide-cc");
    if (on && !st) {
      st = document.createElement("style"); st.id = "cleanstream-hide-cc";
      st.textContent = ".ytp-caption-window-container{visibility:hidden!important}";
      document.documentElement.appendChild(st);
    } else if (!on && st) st.remove();
  }

  /** What YouTube has saved about captions in this browser (its "sticky caption" choice...). */
  function captionChoices() {
    const out = {};
    try {
      for (let k = 0; k < localStorage.length; k++) {
        const key = localStorage.key(k);
        if (/caption/i.test(key) && /^yt/i.test(key)) out[key] = localStorage.getItem(key);
      }
    } catch (e) { /* storage blocked: nothing to put back */ }
    return out;
  }
  function putBack(saved) {
    try {
      const now = captionChoices();
      for (const key of Object.keys(now)) if (!(key in saved)) localStorage.removeItem(key);
      for (const [key, v] of Object.entries(saved)) if (now[key] !== v) localStorage.setItem(key, v);
    } catch (e) { /* storage blocked */ }
  }

  /** The caption tracks to read: the written ones first, then auto-made. English, or Spanish,
   *  German or Italian when that's what is spoken (YouTube's auto-made captions are in the
   *  language said) or the video has no English ones (the owner, 2026-11-19: Spanish, "yes";
   *  German and Italian, "share the lists with cleanstream"). */
  function englishTracks(p) {
    const pr = (p.getPlayerResponse && p.getPlayerResponse()) || window.ytInitialPlayerResponse || {};
    const all = (pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    const lang = t => (/^(en|es|de|it)\b/i.exec(t.languageCode || "") || [""])[0].toLowerCase();
    const spoken = all.filter(t => t.kind === "asr").map(lang)[0];
    const LANGS = ["en", "es", "de", "it"];
    const order = spoken && spoken !== "en" ? [spoken, ...LANGS.filter(l => l !== spoken)] : LANGS;
    const use = order.find(l => all.some(t => lang(t) === l));
    const mine = use ? all.filter(t => lang(t) === use) : [];
    const written = mine.filter(t => t.kind !== "asr");
    const auto = mine.filter(t => t.kind === "asr");
    return { written: written[0] || null, auto: auto[0] || null, others: all.length - mine.length,
      video: pr.videoDetails && pr.videoDetails.videoId, lang: use || null };
  }

  // A track fetched straight from its own address, with the pass borrowed from one the player
  // made, always as json3 (each auto-made word with its own time, swears as "[ __ ]"). Asking
  // the player for each track didn't always bring the auto-made one back: on the owner's PC
  // CleanStream ended up with captions without word times, and the hidden swears at 3:07 of a
  // Rosebud Baker video went through (2026-11-17).
  const PASS_KEYS = ["pot", "potc", "c", "cver", "cplayer", "cos", "cosver", "cplatform", "cbr", "cbrver",
    "xorb", "xobt", "xovt"];
  async function fetchDirect(t, video) {
    const from = pass.get(video);
    if (!from || !t.baseUrl) return null;
    try {
      const u = new URL(t.baseUrl, location.href);
      for (const k of PASS_KEYS) if (from.searchParams.has(k)) u.searchParams.set(k, from.searchParams.get(k));
      u.searchParams.set("fmt", "json3");
      const text = await F.call(window, u.toString(), { credentials: "include" }).then(r => r.ok ? r.text() : "");
      return text && JSON.parse(text).events ? text : null;
    } catch (e) { return null; }
  }
  async function needPass(p, t, video) {          // the player makes one caption request for us
    if (pass.has(video)) return true;
    p.setOption("captions", "track", { languageCode: t.languageCode, kind: t.kind || "",
      vss_id: t.vssId, name: t.name && (t.name.simpleText || "") });
    for (let k = 0; k < 40 && !pass.has(video); k++) await wait(250);
    return pass.has(video);
  }

  async function fetchTrack(p, t, video) {
    const direct = await fetchDirect(t, video);
    if (direct) return direct;
    const key = [video, t.languageCode, t.kind === "asr" ? "asr" : "", ""].join("|");
    if (seen.has(key)) return seen.get(key);
    p.setOption("captions", "track", { languageCode: t.languageCode, kind: t.kind || "",
      vss_id: t.vssId, name: t.name && (t.name.simpleText || "") });
    for (let k = 0; k < 40; k++) {           // up to 10 s
      await wait(250);
      if (seen.has(key)) return seen.get(key);
    }
    return null;
  }

  async function getCaptions(video) {
    const p = player();
    if (!p || !p.getOption || !p.setOption) return said("captions-done", { video, error: "no player" });
    // moving to a video without the page reloading (from the home page, the list beside a video,
    // the YouTube app window), the player can still have the last video's details for a moment:
    // wait up to 10 s for this one's (the owner, 2026-11-19: "after refreshing it seems to work
    // better"; it worked "about half the time" in the app)
    // (a player that doesn't say which video it has: gone ahead with after 2 s, as before)
    let tracks = englishTracks(p);
    for (let k = 0; k < 40 && tracks.video !== video && !(tracks.video == null && k >= 8); k++) {
      await wait(250); tracks = englishTracks(p);
    }
    if (tracks.video && tracks.video !== video) return said("captions-done", { video, error: "other video" });
    if (!tracks.written && !tracks.auto)
      return said("captions-done", { video, none: true, others: tracks.others });
    const before = p.getOption("captions", "track") || {};
    const wasOn = !!(before && before.languageCode);
    // YouTube remembers turning captions on as the viewer's own choice (saved in the page's
    // storage), and then shows them on every video (the owner, 2026-11-18: "the captions are
    // coming onscreen by itself"): what it had saved about captions is put back afterwards
    const saved = captionChoices();
    hideCaptions(true);
    const out = {};
    try {
      p.loadModule && p.loadModule("captions");
      await wait(300);
      await needPass(p, tracks.auto || tracks.written, video);
      if (tracks.written) out.written = await fetchTrack(p, tracks.written, video);
      if (tracks.auto) out.auto = await fetchTrack(p, tracks.auto, video);
    } finally {
      try {
        if (wasOn) p.setOption("captions", "track", before);
        else { p.setOption("captions", "track", {}); p.unloadModule && p.unloadModule("captions"); }
      } catch (e) { /* left as it is */ }
      putBack(saved);
      setTimeout(() => putBack(saved), 600);              // YouTube may save a moment later
      setTimeout(() => putBack(saved), 2500);
      setTimeout(() => hideCaptions(false), 400);
    }
    said("captions-done", { video, written: out.written || null, auto: out.auto || null,
      hadWritten: !!tracks.written, hadAuto: !!tracks.auto });
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== "content") return;
    if (d.type === "get-captions") getCaptions(d.video);
    if (d.type === "seek") { const p = player(); if (p && p.seekTo) p.seekTo(d.to, true); }
  });
  said("ready", {});
})();
