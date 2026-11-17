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

  function caught(url, text) {
    try {
      const u = new URL(url, location.href);
      if (!u.pathname.includes("/api/timedtext")) return;
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

  const player = () => document.getElementById("movie_player");
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

  /** The English caption tracks the video has: the written ones first, then auto-made. */
  function englishTracks(p) {
    const pr = (p.getPlayerResponse && p.getPlayerResponse()) || window.ytInitialPlayerResponse || {};
    const all = (pr.captions && pr.captions.playerCaptionsTracklistRenderer &&
      pr.captions.playerCaptionsTracklistRenderer.captionTracks) || [];
    const en = all.filter(t => /^en\b/i.test(t.languageCode || ""));
    const written = en.filter(t => t.kind !== "asr");
    const auto = en.filter(t => t.kind === "asr");
    return { written: written[0] || null, auto: auto[0] || null, others: all.length - en.length,
      video: pr.videoDetails && pr.videoDetails.videoId };
  }

  async function fetchTrack(p, t, video) {
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
    const tracks = englishTracks(p);
    if (tracks.video && tracks.video !== video) return said("captions-done", { video, error: "other video" });
    if (!tracks.written && !tracks.auto)
      return said("captions-done", { video, none: true, others: tracks.others });
    const before = p.getOption("captions", "track") || {};
    const wasOn = !!(before && before.languageCode);
    hideCaptions(true);
    const out = {};
    try {
      p.loadModule && p.loadModule("captions");
      await wait(300);
      if (tracks.written) out.written = await fetchTrack(p, tracks.written, video);
      if (tracks.auto) out.auto = await fetchTrack(p, tracks.auto, video);
    } finally {
      try {
        if (wasOn) p.setOption("captions", "track", before);
        else { p.setOption("captions", "track", {}); p.unloadModule && p.unloadModule("captions"); }
      } catch (e) { /* left as it is */ }
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
