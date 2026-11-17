// Runs in the hidden look-ahead copy's own page (MAIN world, before YouTube's scripts): every
// video and sound in it is muted before it can start, and can't be unmuted. scout_mute.js
// muted it as soon as it heard a video had started, but a split second could get out each
// time YouTube started something new in it (an ad, a jump): the owner heard "a random quick
// garble of noise with nothing playing" (2026-11-17).
(function () {
  if (window.top === window || window.name !== "cleanstream-scout") return;
  const P = HTMLMediaElement.prototype;
  const muted = Object.getOwnPropertyDescriptor(P, "muted");
  Object.defineProperty(P, "muted", {
    configurable: true, enumerable: muted.enumerable,
    get() { return muted.get.call(this); },
    set() { muted.set.call(this, true); },          // always muted, whatever YouTube asks for
  });
  const play = P.play;
  P.play = function () { muted.set.call(this, true); return play.call(this); };
  // a video made by YouTube's scripts gets muted the moment it's made
  const make = Document.prototype.createElement;
  Document.prototype.createElement = function (tag, ...rest) {
    const el = make.call(this, tag, ...rest);
    if (el instanceof HTMLMediaElement) muted.set.call(el, true);
    return el;
  };
})();
