// Netflix (the owner, 2026-11-17: "yes. just language is fine"): runs inside Netflix's own page
// (MAIN world, from the very start) so it can see the subtitle files Netflix's player downloads,
// and ask the player for the English ones. It talks to netflix.js with window.postMessage.
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

  async function getSubs(title) {
    let p = null;
    for (let k = 0; k < 60 && !(p = player()); k++) await wait(250);
    if (!p || !p.getTimedTextTrackList) return said("subs-done", { title, error: "no player" });
    const list = p.getTimedTextTrackList() || [];
    const en = list.filter(t => t && !t.isNoneTrack && !t.isForcedNarrative && /^en\b/i.test(t.bcp47 || t.language || ""));
    if (!en.length) return said("subs-done", { title, none: true, others: list.filter(t => t && !t.isNoneTrack).length });
    // the closed captions (they have every line, and sounds) before plain subtitles
    const pick = en.find(t => /ASSISTIVE|CLOSEDCAPTIONS|SDH/i.test(t.trackType || t.rawTrackType || "")) || en[0];
    const before = p.getTimedTextTrack && p.getTimedTextTrack();
    const already = before && before.trackId === pick.trackId;
    if (already && got.length) return said("subs-done", { title, text: got[got.length - 1].text });
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
    said("subs-done", { title, text, error: text ? undefined : "no download" });
  }

  window.addEventListener("message", e => {
    const d = e.data;
    if (e.source !== window || !d || d[TAG] !== "nf-content") return;
    if (d.type === "get-subs") getSubs(d.title);
  });
})();
