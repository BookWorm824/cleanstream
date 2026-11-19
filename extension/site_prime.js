// What site.js needs to know about Prime Video (on primevideo.com and amazon.com). A title plays
// over the page it was started from, so the page script says which title is starting.
//
// The owner, 2026-11-18: "its stopped working altogether partway through the video". Prime's
// player can swap video elements (an ad break, a new stream quality), and with ads stitched into
// the stream the video's own clock runs on through each ad, so after the first break every mute
// would come at the wrong moment. So: use the player box's video that is actually playing, and go
// by the time Prime shows on screen (the clock at the bottom of the player) when there is one.
(function () {
  const BOX = [".webPlayerSDKContainer", ".webPlayerContainer", "#dv-web-player"];
  const CLOCK = ".atvwebplayersdk-timeindicator-text";
  const AD = ".atvwebplayersdk-ad-timer, .atvwebplayersdk-ad-timer-text, .atvwebplayersdk-adtimeindicator-text, [class*='adtimeindicator']";

  const seen = el => !!el && el.getClientRects().length > 0;
  // an "Ad" / "Ad 1 of 2" / "Ad · 0:15" label shown over the player (looked at 20 times a second,
  // so an ad's start and end are noted closely: its length comes off CleanStream's clock)
  // (not "Ad-free" or "Ad: learn more": 2026-11-19, the owner: listed words played on Prime)
  const AD_TEXT = /^(?:ad|ads|advertisement)(?:\s*(?:\d+\s*of\s*\d+|[·•|(]\s*\d|\d+:\d\d)|$)/i;
  let adSeen = false, adLooked = 0;
  function adLabel() {
    const now = Date.now();
    if (now - adLooked < 50) return adSeen;
    adLooked = now;
    const box = document.querySelector(BOX.join(","));
    adSeen = !!box && [...box.querySelectorAll("span, div, p")].some(el =>
      el.childElementCount === 0 && el.textContent.length < 40 && AD_TEXT.test(el.textContent.trim()) && seen(el));
    return adSeen;
  }
  /** "8:43 / 44:10" or "1:02:03 / 1:45:00" -> the first time, in seconds */
  function clockSecs(text) {
    const m = String(text || "").match(/(\d+):(\d{2})(?::(\d{2}))?/);
    if (!m) return null;
    return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2];
  }

  // how far the video's own clock is ahead of the title's: the smallest gap seen since the last
  // jump (the clock on screen shows whole seconds, so the gap wobbles up to a second above it)
  let offset = 0, base = null, jumps = [], trusted = true;
  function title(v) {
    const ad = [...document.querySelectorAll(AD)].some(seen) || adLabel();
    if (trusted && !ad && !v.paused && v.readyState >= 2) {
      const shown = clockSecs((document.querySelector(CLOCK) || {}).textContent);
      if (shown != null) {
        const gap = v.currentTime - shown;
        if (base === null || Math.abs(gap - base) > 1.5) {
          base = gap; offset = gap;
          const now = Date.now();
          jumps = jumps.filter(t => now - t < 60000).concat(now);
          // jumping all the time means it isn't the clock we think it is: stop using it
          if (jumps.length > 6) { trusted = false; offset = 0; }
        } else if (gap < offset) offset = gap;
      }
    }
    // clocked: Prime's clock on screen was read (then its time is the title's, ads and all)
    return { t: v.currentTime - offset, ad, clocked: trusted && base !== null };
  }

  globalThis.CS_SITE = {
    name: "Prime Video",
    pageTag: "pv-page", contentTag: "pv-content",
    ask: false,                                       // prime_page.js sends the subtitles as they come
    titleFromUrl: null,
    // Prime's player, not a trailer playing on the page: the player box's video that is playing
    // (it can have more than one), else its first, else the biggest video that's playing
    video: () => {
      const inBox = [...document.querySelectorAll(BOX.map(s => s + " video").join(","))];
      // the one playing; when two are (an ad over the show), the longer one
      const len = v => isFinite(v.duration) ? v.duration : 0;
      const playing = inBox.filter(v => !v.paused && v.readyState >= 2).sort((a, b) => len(b) - len(a));
      return playing[0] || inBox[0] ||
        [...document.querySelectorAll("video")].filter(v => !v.paused)
          .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
    },
    time: title,
    adShowing: () => [...document.querySelectorAll(AD)].some(seen) || adLabel(),
    newTitle: () => { offset = 0; base = null; jumps = []; trusted = true; },
    host: () => document.querySelector(BOX.join(",")),
  };
})();
