// What site.js needs to know about Prime Video (on primevideo.com and amazon.com). A title plays
// over the page it was started from, so the page script says which title is starting.
globalThis.CS_SITE = {
  name: "Prime Video",
  pageTag: "pv-page", contentTag: "pv-content",
  ask: false,                                       // prime_page.js sends the subtitles as they come
  titleFromUrl: null,
  // Prime's player, not a trailer playing on the page: the one in the player box, else the
  // biggest video that's playing
  video: () => document.querySelector(".webPlayerSDKContainer video, .webPlayerContainer video, #dv-web-player video") ||
    [...document.querySelectorAll("video")].filter(v => !v.paused)
      .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null,
  host: () => document.querySelector(".webPlayerSDKContainer, .webPlayerContainer, #dv-web-player"),
};
