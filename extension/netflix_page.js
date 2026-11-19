// Netflix (the owner, 2026-11-17: "yes. just language is fine"): runs inside Netflix's own page
// (MAIN world, from the very start) so it can see the subtitle files Netflix's player downloads,
// read the list of subtitle files each title comes with, and ask the player for the English
// ones. It talks to site.js with window.postMessage.
// Language only, like all of CleanStream.
(function () {
  if (window.__cleanstreamNetflix) return;
  window.__cleanstreamNetflix = true;
  const TAG = "cleanstream";
  const said = (type, data) => window.postMessage({ [TAG]: "nf-page", type, ...data }, "*");
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const got = [];                         // subtitle files seen on this page: {text, at}

  const looksLikeSubs = t => typeof t === "string" &&
    (/^\s*WEBVTT/.test(t) || /<tt[\s>]/.test(t.slice(0, 3000)));
  function caught(text) {
    if (looksLikeSubs(text)) { got.push({ text, at: Date.now() }); said("subs-seen", {}); }
  }
  const decode = buf => {
    try {
      const b = new Uint8Array(buf);
      if (!b.length || b.length > 8e6) return null;
      // text starts with "<" (XML), "W" (WEBVTT) or a byte-order mark
      if (b[0] !== 0x3C && b[0] !== 0x57 && b[0] !== 0xEF && b[0] !== 0xFE && b[0] !== 0xFF) return null;
      return new TextDecoder(b[0] === 0xFE || b[0] === 0xFF ? "utf-16" : "utf-8").decode(b);
    } catch (e) { return null; }
  };

  // ---- watching the player's downloads ----
  const XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        const rt = this.responseType;
        if (rt === "" || rt === "text") caught(this.responseText);
        else if (rt === "arraybuffer") caught(decode(this.response));
      } catch (e) { /* not ours to read */ }
    });
    return XS.apply(this, arguments);
  };
  const F = window.fetch;
  window.fetch = function () {
    const p = F.apply(this, arguments);
    p.then(r => {
      const type = (r.headers.get("content-type") || "").toLowerCase();
      const len = +(r.headers.get("content-length") || 0);
      if (len > 8e6 || /video|audio|image|json|javascript|html/.test(type)) return;
      return r.clone().arrayBuffer().then(b => caught(decode(b)));
    }).catch(() => {});
    return p;
  };

  // ---- asking the player for the English subtitles ----
  function player() {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const id = vp.getAllPlayerSessionIds()[0];
      return id ? vp.getVideoPlayerBySessionId(id) : null;
    } catch (e) { return null; }
  }
  function hideSubs(on) {
    let st = document.getElementById("cleanstream-hide-subs");
    if (on && !st) {
      st = document.createElement("style"); st.id = "cleanstream-hide-subs";
      st.textContent = ".player-timedtext, .player-timedtext-text-container { visibility: hidden !important; }";
      document.documentElement.appendChild(st);
    } else if (!on && st) st.remove();
  }

  // ---- the title's own list of subtitle files (its "manifest") ----
  // Netflix's player gets a list for each title it starts, with every subtitle track and where
  // its file is. Read as the page parses it, the English file can be fetched straight away,
  // without touching the viewer's own subtitle choice. (The owner, 2026-11-18: "netflix doesnt
  // work ... it says it has no subtitle": the player was asked for its tracks before it had
  // them, and an empty list was taken as "no subtitles".)
  const manifests = new Map();            // title id -> its subtitle tracks
  const JP = JSON.parse;
  JSON.parse = function () {
    const v = JP.apply(this, arguments);
    try {
      const m = v && (v.result && v.result.timedtexttracks ? v.result : v.timedtexttracks ? v : null);
      if (m && Array.isArray(m.timedtexttracks) && m.movieId != null) manifests.set(String(m.movieId), m.timedtexttracks);
    } catch (e) { /* not a manifest */ }
    return v;
  };
  const TEXT_KINDS = ["webvtt-lssdh-ios8", "dfxp-ls-sdh", "simplesdh", "imsc1.1"];   // not the picture ones
  const isEnglish = t => /^en\b/i.test(t.bcp47 || t.language || t.languageCode || "") ||
    /^english\b/i.test(t.displayName || t.languageDescription || "");
  const isCC = t => /ASSISTIVE|CLOSEDCAPTIONS|SDH/i.test(t.trackType || t.rawTrackType || "");
  function fileOf(track) {
    const d = track.ttDownloadables || {};
    for (const kind of TEXT_KINDS) {
      const x = d[kind];
      if (!x) continue;
      const urls = (Array.isArray(x.urls) ? x.urls.map(u => u && u.url) : [])
        .concat(x.downloadUrls ? Object.values(x.downloadUrls) : []).filter(u => typeof u === "string");
      if (urls.length) return urls;
    }
    return null;
  }
  /** From the title's manifest: {text} when the English file came, {none} when it lists no English. */
  async function fromManifest(ids) {
    const tracks = ids.map(id => manifests.get(String(id))).find(Boolean);
    if (!tracks) return null;
    const real = tracks.filter(t => t && !t.isNoneTrack && !t.isForcedNarrative);
    const en = real.filter(isEnglish).filter(fileOf);
    if (!en.length) return real.length ? { none: true, others: real.filter(t => !isEnglish(t)).length } : null;
    const pick = en.find(isCC) || en[0];
    for (const url of fileOf(pick).slice(0, 3)) {
      try {
        const text = await F.call(window, url).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && decode(b));
        if (looksLikeSubs(text)) return { text };
      } catch (e) { /* the next address */ }
    }
    return null;
  }

  /** Through the player: choose the English track (hidden), and keep the file it downloads. */
  async function fromPlayer(p, list, en) {
    // the closed captions (they have every line, and sounds) before plain subtitles
    const pick = en.find(isCC) || en[0];
    const before = p.getTimedTextTrack && p.getTimedTextTrack();
    const already = before && before.trackId === pick.trackId;
    if (already && got.length) return got[got.length - 1].text;
    hideSubs(!already);
    const n = got.length;
    try {
      await p.setTimedTextTrack(pick);
      for (let k = 0; k < 60 && got.length === n; k++) await wait(250);          // up to 15 s
    } catch (e) { /* the player said no */ }
    const text = got.length > n ? got[got.length - 1].text : null;
    if (!already) {
      try { await p.setTimedTextTrack(before || list.find(t => t && t.isNoneTrack)); } catch (e) { /* left */ }
      setTimeout(() => hideSubs(false), 600);
    }
    return text;
  }

  let asking = 0;
  async function getSubs(title) {
    const mine = ++asking;
    let p = null, sawTracks = 0;
    // up to 20 s for the title's list or the player's tracks to be there
    for (let k = 0; k < 80 && mine === asking; k++) {
      p = player();
      const ids = [title];
      try { if (p && p.getMovieId) ids.push(p.getMovieId()); } catch (e) { /* no id */ }
      const m = await fromManifest(ids);
      if (m && m.text) return said("subs-done", { title, text: m.text });
      const list = (p && p.getTimedTextTrackList && p.getTimedTextTrackList()) || [];
      const real = list.filter(t => t && !t.isNoneTrack && !t.isForcedNarrative);
      const en = real.filter(isEnglish);
      if (en.length) {
        const text = await fromPlayer(p, list, en);
        return said("subs-done", { title, text, error: text ? undefined : "no download" });
      }
      // "no English" only when a full list says so, and has stayed that way for 3 s
      if (real.length || (m && m.none)) sawTracks++;
      if (sawTracks > 12) return said("subs-done", { title, none: true, others: real.length || (m && m.others) || 0 });
      await wait(250);
    }
    if (mine === asking) said("subs-done", { title, error: p ? "no tracks" : "no player" });
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== "nf-content") return;
    if (d.type === "get-subs") getSubs(d.title);
  });
})();
