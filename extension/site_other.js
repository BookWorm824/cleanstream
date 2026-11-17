// What site.js needs to know about Hulu, Disney+, Max, Peacock and Paramount+. A title's page
// address has watch / video / play in it on all of them.
(function () {
  const NAMES = { "www.hulu.com": "Hulu", "www.disneyplus.com": "Disney+", "play.max.com": "Max",
    "www.max.com": "Max", "www.peacocktv.com": "Peacock", "www.paramountplus.com": "Paramount+" };
  const biggest = () => [...document.querySelectorAll("video")]
    .filter(v => v.readyState > 0 || !v.paused)
    .sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0] || null;
  globalThis.CS_SITE = {
    name: NAMES[location.hostname] || location.hostname,
    pageTag: "ot-page", contentTag: "ot-content",
    ask: false,                                      // other_page.js sends subtitles as it sees them
    titleFromUrl: () => (/\/(watch|video|play|playback|movies?|episode)\b/i.test(location.pathname) ? location.pathname : null),
    video: biggest,
    host: () => document.fullscreenElement || (biggest() && biggest().parentElement),
    // without a list of subtitle files, the pieces only come with subtitles turned on
    holdMost: 10,
    noSubsHint: "CleanStream can't see this title's subtitles. Turn on English subtitles (CC) in the player " +
      "so it can mute bad language.",
  };
})();
