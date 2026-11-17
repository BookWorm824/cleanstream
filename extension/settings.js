// CleanStream's settings: who it's filtering for, and what's ticked for each. The ages and
// their standard ticks are CleanView's (CleanView.pyw PRESETS), for the filters CleanStream
// has so far. Each age remembers its own changes.
(function () {
  const PROFILES = [["young", "Young kids"], ["kids", "Kids"], ["teens", "Teens"], ["adults", "Adults"]];
  const FILTERS = [
    // [key, label, group]
    ["swearing", "Swearing (f-word, s-word, b-word…)", "words"],
    ["mild", "Mild words (damn, hell, crap)", "words"],
    ["deity", "God's name used as a swear", "words"],
    ["minced", "Soft substitutes (gosh, heck, freaking)", "words"],
    ["rude", "Rude words kids copy (stupid, dumb, idiot, shut up…)", "words"],
    ["samesexwords", "Words about same-sex relationships (gay, lesbian…)", "words"],
    ["sexref", "Sexual words (sex, sexy, condom…)", "words"],
    ["casual", "Sleeping around (slept with, an affair…)", "words"],
    ["crude", "Crude humor words (fart, poop…)", "words"],
    ["nudity", "Nudity (skips the scene)", "picture"],
  ];
  const ALL = Object.fromEntries(FILTERS.map(([k]) => [k, true]));
  const PRESETS = {
    young: { ...ALL },
    kids: { ...ALL },
    teens: { ...ALL, rude: false, minced: false, crude: false },
    adults: { ...ALL, minced: false, rude: false, crude: false },
  };
  const DEFAULTS = { on: true, profile: "kids", ticks: {}, mine: "", picture: true };

  async function load() {
    const s = await chrome.storage.sync.get(DEFAULTS);
    return { ...DEFAULTS, ...s };
  }
  /** The ticks in use for the chosen age: her changes over the standard ones. */
  function ticksFor(s, profile = s.profile) {
    return { ...PRESETS[profile], ...((s.ticks || {})[profile] || {}) };
  }
  async function save(changes) { await chrome.storage.sync.set(changes); }

  globalThis.CSSettings = { PROFILES, FILTERS, PRESETS, DEFAULTS, load, save, ticksFor };
})();
