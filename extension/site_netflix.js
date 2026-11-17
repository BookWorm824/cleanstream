// What site.js needs to know about Netflix.
globalThis.CS_SITE = {
  name: "Netflix",
  pageTag: "nf-page", contentTag: "nf-content",
  ask: true,                                        // netflix_page.js fetches the subtitles when asked
  titleFromUrl: () => (/^\/watch\/(\d+)/.exec(location.pathname) || [])[1] || null,
  video: () => document.querySelector(".watch-video video") || document.querySelector("video"),
  host: () => document.querySelector(".watch-video"),
};
