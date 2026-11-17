// Prime Video (the owner, 2026-11-17: "start prime"; language only, like Netflix): runs inside
// Prime's own page (MAIN world, from the very start). When a title starts, Prime's player asks
// Amazon for its playback resources, a list that includes the subtitle files' addresses. This
// reads that list as it arrives, fetches the English subtitles itself (closed captions first),
// and passes them to prime.js. Subtitle files the player downloads itself are kept too.
(function () {
  if (window.__cleanstreamPrime) return;
  window.__cleanstreamPrime = true;
  const TAG = "cleanstream";
  const said = (type, data) => window.postMessage({ [TAG]: "pv-page", type, ...data }, "*");
  const F = window.fetch;

  const RESOURCES = /GetPlaybackResources|GetVodPlaybackResources|\/playback\/prs\//i;
  const looksLikeSubs = t => typeof t === "string" && (/^\s*WEBVTT/.test(t) || /<tt[\s>]/.test(t.slice(0, 3000)));

  /** Every {url, languageCode, type...} that looks like a subtitle file, anywhere in the JSON. */
  function subtitleFiles(obj, out = [], depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 12) return out;
    if (Array.isArray(obj)) { for (const x of obj) subtitleFiles(x, out, depth + 1); return out; }
    const url = obj.url || obj.urls && obj.urls[0];
    const lang = obj.languageCode || obj.language || obj.lang;
    if (typeof url === "string" && typeof lang === "string" &&
        (/\.(dfxp|ttml2?|xml|vtt)(\?|$)/i.test(url) || /ttml|dfxp|vtt/i.test(obj.format || "") || /subtitle|sdh|caption/i.test(obj.type || ""))) {
      out.push({ url, lang, type: String(obj.type || obj.subtype || ""), forced: /forced|narrative/i.test(String(obj.type) + String(obj.subtype)) });
    }
    for (const k of Object.keys(obj)) subtitleFiles(obj[k], out, depth + 1);
    return out;
  }
  const titleOf = url => { try { return new URL(url, location.href).searchParams.get("asin") || null; } catch (e) { return null; } };

  let lastTitle = null;
  async function resourcesArrived(url, text) {
    let json; try { json = JSON.parse(text); } catch (e) { return; }
    const files = subtitleFiles(json);
    const title = titleOf(url) || (json.catalogMetadata && json.catalogMetadata.catalog && json.catalogMetadata.catalog.id) || "prime";
    if (!files.length && !/subtitle|timedText/i.test(text)) return;    // not the playback list
    lastTitle = title;
    said("title", { title });
    const en = files.filter(f => /^en\b/i.test(f.lang) && !f.forced);
    if (!en.length) return said("subs-done", { title, none: true, others: files.filter(f => !f.forced).length });
    const pick = en.find(f => /sdh|caption/i.test(f.type)) || en[0];
    let subs = null;
    try { subs = await F.call(window, pick.url).then(r => r.ok ? r.text() : null); } catch (e) { subs = null; }
    said("subs-done", { title, text: looksLikeSubs(subs) ? subs : null, error: looksLikeSubs(subs) ? undefined : "no download" });
  }
  function caught(url, text) {
    if (typeof text !== "string") return;
    if (RESOURCES.test(url)) resourcesArrived(url, text);
    else if (looksLikeSubs(text)) said("subs-seen", { title: lastTitle, text });
  }

  const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, url) { this.__csUrl = String(url); return XO.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    this.addEventListener("load", () => {
      try {
        const rt = this.responseType;
        if (rt === "" || rt === "text") caught(this.__csUrl || "", this.responseText);
        else if (rt === "json" && RESOURCES.test(this.__csUrl || "")) caught(this.__csUrl, JSON.stringify(this.response));
      } catch (e) { /* not ours to read */ }
    });
    return XS.apply(this, arguments);
  };
  window.fetch = function (input) {
    const url = typeof input === "string" ? input : (input && input.url) || "";
    const p = F.apply(this, arguments);
    p.then(r => {
      const type = (r.headers.get("content-type") || "").toLowerCase();
      if (RESOURCES.test(url) || /xml|ttml|dfxp|vtt|text\/plain/.test(type)) return r.clone().text().then(t => caught(url, t));
    }).catch(() => {});
    return p;
  };
})();
