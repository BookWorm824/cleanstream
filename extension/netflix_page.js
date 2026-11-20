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
  function player(title) {
    try {
      const vp = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      // Netflix keeps more than one player going (the episode before, previews): the one
      // playing this title, else the newest "watch" one, else the newest (the owner,
      // 2026-11-18: the first episode worked, the next two said "no subtitle")
      const all = vp.getAllPlayerSessionIds().map(id => ({ id: String(id), p: vp.getVideoPlayerBySessionId(id) })).filter(x => x.p);
      const movie = x => { try { return String(x.p.getMovieId()); } catch (e) { return ""; } };
      const pick = (title != null && all.filter(x => movie(x) === String(title)).pop()) ||
        all.filter(x => /^watch/i.test(x.id)).pop() || all.pop();
      return pick ? pick.p : null;
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
  // English, or Spanish, German or Italian (the owner, 2026-11-19: Spanish, "yes"; German and
  // Italian, "share the lists with cleanstream"): the language the title is playing in first,
  // else English first, then the others when there's no English
  const langOf = t => {
    const code = String(t.bcp47 || t.language || t.languageCode || "").toLowerCase();
    const name = String(t.displayName || t.languageDescription || "").toLowerCase();
    if (/^en\b/.test(code) || /^english\b/.test(name)) return "en";
    if (/^es\b/.test(code) || /^(spanish|español|espanol)\b/.test(name)) return "es";
    if (/^de\b/.test(code) || /^(german|deutsch)\b/.test(name)) return "de";
    if (/^it\b/.test(code) || /^(italian|italiano)\b/.test(name)) return "it";
    return "";
  };
  function order(p) {
    try {
      const a = p && p.getAudioTrack && p.getAudioTrack();
      const L = a && langOf(a);
      if (L && L !== "en") return [L, ...["en", "es", "de", "it"].filter(x => x !== L)];
    } catch (e) { /* not known */ }
    return ["en", "es", "de", "it"];
  }
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
  /** From the title's manifest: {text} when the file came, {none} when it lists no English or
   *  Spanish. */
  async function fromManifest(ids, langs) {
    const tracks = ids.map(id => manifests.get(String(id))).find(Boolean);
    if (!tracks) return null;
    const real = tracks.filter(t => t && !t.isNoneTrack && !t.isForcedNarrative);
    for (const L of langs) {
      const listed = real.filter(t => langOf(t) === L), en = listed.filter(fileOf);
      // listed without its file yet (Netflix fills that in when the track is chosen) isn't
      // "none": the player is asked instead
      if (listed.length && !en.length) return null;
      if (!en.length) continue;
      const pick = en.find(isCC) || en[0];
      for (const url of fileOf(pick).slice(0, 3)) {
        try {
          const text = await F.call(window, url).then(r => r.ok ? r.arrayBuffer() : null).then(b => b && decode(b));
          if (looksLikeSubs(text)) return { text };
        } catch (e) { /* the next address */ }
      }
      return null;
    }
    return real.length ? { none: true, others: real.length } : null;
  }

  /** Through the player: choose the English track (hidden), and keep the file it downloads. */
  async function fromPlayer(p, list, en, since) {
    // the closed captions (they have every line, and sounds) before plain subtitles
    const pick = en.find(isCC) || en[0];
    const before = p.getTimedTextTrack && p.getTimedTextTrack();
    const already = before && before.trackId === pick.trackId;
    const recent = got.filter(g => g.at >= since - 3000);
    if (already && recent.length) return recent[recent.length - 1].text;
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
    const mine = ++asking, since = Date.now();
    let p = null, sawTracks = 0;
    // up to 20 s for the title's list or the player's tracks to be there
    for (let k = 0; k < 80 && mine === asking; k++) {
      p = player(title);
      const ids = [title];
      try { if (p && p.getMovieId) ids.push(p.getMovieId()); } catch (e) { /* no id */ }
      const langs = order(p);
      const m = await fromManifest(ids, langs);
      if (m && m.text) return said("subs-done", { title, text: m.text });
      const list = (p && p.getTimedTextTrackList && p.getTimedTextTrackList()) || [];
      const real = list.filter(t => t && !t.isNoneTrack && !t.isForcedNarrative);
      const use = langs.find(L => real.some(t => langOf(t) === L));
      const en = use ? real.filter(t => langOf(t) === use) : [];
      if (en.length) {
        const text = await fromPlayer(p, list, en, since);
        return said("subs-done", { title, text, error: text ? undefined : "no download" });
      }
      // "no English" only when a full list says so, and has stayed that way for 5 s
      if (real.length || (m && m.none)) sawTracks++; else sawTracks = 0;
      if (sawTracks > 20) return said("subs-done", { title, none: true, others: real.length || (m && m.others) || 0 });
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
