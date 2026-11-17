// Runs first on every YouTube page (document_start): keeps a video's sound off from its very
// first moment until content.js (which starts later, when the page is ready) takes over and
// holds it until the captions are in. YouTube starts playing before content.js runs, so a word
// in the first second used to get through (the owner, 2026-11-17: "porn" 1 second into a Rory
// Scovel video). Also on moving to another video without reloading the page.
(function () {
  if (window.top !== window) return;
  let on = true;
  chrome.storage.sync.get({ on: true }).then(s => { on = s.on !== false; }, () => {});
  globalThis.__csArmed = true;                      // content.js disarms it when it takes over
  globalThis.__csEarlyMuted = false;                // ... and adopts this mute (to undo it later)
  const hush = e => {
    const v = e.target;
    if (!globalThis.__csArmed || !on || !(v instanceof HTMLVideoElement) || !v.closest("#movie_player")) return;
    if (location.pathname !== "/watch" || document.querySelector("#movie_player.ad-showing")) return;
    if (!v.muted) { v.muted = true; globalThis.__csEarlyMuted = true; }
  };
  for (const type of ["loadstart", "loadeddata", "canplay", "play", "playing"]) document.addEventListener(type, hush, true);
  // YouTube puts back its own volume setting as it loads: mute again until content.js takes over
  document.addEventListener("volumechange", e => {
    if (globalThis.__csEarlyMuted && globalThis.__csArmed && e.target instanceof HTMLVideoElement &&
        e.target.closest("#movie_player") && !e.target.muted) e.target.muted = true;
  }, true);
  document.addEventListener("yt-navigate-start", () => { globalThis.__csArmed = true; }, true);
})();
