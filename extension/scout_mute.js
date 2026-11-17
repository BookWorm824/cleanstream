// Keeps the hidden look-ahead copy (the frame named "cleanstream-scout") silent from the very
// start. It runs before YouTube's own player, so the copy is muted before it can make a sound,
// and it mutes it again whenever YouTube turns its sound back on. (In the owner's Chrome the
// copy played out loud, fast and garbled, under the video being watched: 2026-11-17.)
(function () {
  if (window.top === window || window.name !== "cleanstream-scout") return;
  const hush = el => { if (el instanceof HTMLMediaElement && !el.muted) el.muted = true; };
  // media events don't bubble, but a listener on the document in the capture phase hears them
  for (const type of ["loadstart", "loadeddata", "play", "playing", "volumechange", "canplay"])
    document.addEventListener(type, e => hush(e.target), true);
  setInterval(() => document.querySelectorAll("video, audio").forEach(hush), 100);
  // only the player is needed: the rest of the page (comments, suggestions, the top bar, live
  // chat) isn't drawn, and comments, which load when seen, aren't loaded
  const css = document.createElement("style");
  css.textContent = "#masthead-container, ytd-masthead, #secondary, #related, #comments, ytd-comments," +
    " #below, ytd-watch-metadata, #chat, #chat-container, ytd-live-chat-frame, tp-yt-app-drawer," +
    " ytd-mini-guide-renderer, #guide { display: none !important; }";
  (document.head || document.documentElement).appendChild(css);
})();
