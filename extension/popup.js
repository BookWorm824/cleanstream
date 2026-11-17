// CleanStream's settings window (opens from the toolbar button).
(async function () {
  const S = globalThis.CSSettings;
  let s = await S.load();
  const $ = id => document.getElementById(id);
  // the newest CleanStream (its manifest on GitHub; "Update CleanStream.bat" fetches it)
  const UPDATE_URL = "https://raw.githubusercontent.com/BookWorm824/cleanstream/main/extension/manifest.json";
  const clock = t => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), x = t % 60;
    return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

  function tickBox(key, label, ticks) {
    const l = document.createElement("label"); l.className = "tick";
    const c = document.createElement("input"); c.type = "checkbox"; c.checked = !!ticks[key];
    c.addEventListener("change", async () => {
      const mine = { ...((s.ticks || {})[s.profile] || {}) };
      mine[key] = c.checked;
      s.ticks = { ...(s.ticks || {}), [s.profile]: mine };
      await S.save({ ticks: s.ticks });
    });
    const t = document.createElement("span"); t.textContent = label;
    l.append(c, t);
    return l;
  }

  function draw() {
    document.body.classList.toggle("off", !s.on);
    $("on").checked = s.on;
    const prof = $("profiles"); prof.textContent = "";
    for (const [key, name] of S.PROFILES) {
      const b = document.createElement("button"); b.textContent = name;
      b.className = key === s.profile ? "on" : "";
      b.addEventListener("click", async () => { s.profile = key; await S.save({ profile: key }); draw(); });
      prof.appendChild(b);
    }
    const ticks = S.ticksFor(s);
    $("words").textContent = ""; $("picture").textContent = "";
    for (const [key, label, group] of S.FILTERS)
      $(group === "picture" ? "picture" : "words").appendChild(tickBox(key, label, ticks));
    drawMine();
  }

  // her own words: type one and press Enter (or Add) and it's added to the list under the box,
  // each with an x to take it off (the owner, 2026-11-17: "if enter is hit the word should be
  // added"). Kept as before, one per line in s.mine.
  const mineList = () => (s.mine || "").split("\n").map(w => w.trim()).filter(Boolean);
  function drawMine() {
    const ul = $("mine-list"); ul.textContent = "";
    for (const w of mineList()) {
      const li = document.createElement("li");
      const t = document.createElement("span"); t.textContent = w;
      const x = document.createElement("button"); x.className = "x"; x.textContent = "×";
      x.title = `Stop muting "${w}"`;
      x.addEventListener("click", () => saveMine(mineList().filter(m => m !== w), `Removed "${w}".`));
      li.append(t, x); ul.appendChild(li);
    }
    $("mine-none").hidden = mineList().length > 0;
  }
  async function saveMine(list, said) {
    s.mine = list.join("\n");
    await S.save({ mine: s.mine });
    drawMine();
    $("mine-saved").textContent = said;
  }
  function addMine() {
    const w = $("mine-new").value.replace(/\s+/g, " ").trim();
    if (!w) return;
    const list = mineList();
    $("mine-new").value = "";
    if (list.some(m => m.toLowerCase() === w.toLowerCase())) { $("mine-saved").textContent = `"${w}" is already on the list.`; return; }
    saveMine([...list, w], `Added "${w}". It's muted from now on.`);
  }

  $("on").addEventListener("change", async e => { s.on = e.target.checked; await S.save({ on: s.on }); draw(); });
  $("mine-new").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addMine(); } });
  $("mine-new").addEventListener("input", () => { $("mine-saved").textContent = ""; });
  $("mine-add").addEventListener("click", addMine);
  $("reset").addEventListener("click", async () => {
    s.ticks = { ...(s.ticks || {}), [s.profile]: {} };
    await S.save({ ticks: s.ticks }); draw();
  });
  draw();

  // ---------- what was found in the video open in this tab ----------
  async function showVideo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = tab && tab.url || "";
    const SITES = [[/^https:\/\/www\.netflix\.com\//, "Netflix"], [/^https:\/\/www\.(primevideo|amazon)\.com\//, "Prime Video"],
      [/^https:\/\/www\.youtube\.com\//, "YouTube"], [/^https:\/\/www\.hulu\.com\//, "Hulu"],
      [/^https:\/\/www\.disneyplus\.com\//, "Disney+"], [/^https:\/\/(play|www)\.max\.com\//, "Max"],
      [/^https:\/\/www\.peacocktv\.com\//, "Peacock"], [/^https:\/\/www\.paramountplus\.com\//, "Paramount+"]];
    const site = (SITES.find(([re]) => re.test(url)) || [])[1] || null;
    $("video-src").textContent = "";
    if (!site) {
      $("video-box").hidden = false;
      $("video-say").textContent = "Open a video on YouTube, Netflix, Prime Video, Hulu, Disney+, Max, Peacock or Paramount+ to use CleanStream.";
      return;
    }
    let r = null;
    try { r = await chrome.tabs.sendMessage(tab.id, { type: "state" }); } catch (e) { /* not loaded yet */ }
    $("video-box").hidden = false;
    if (!r) { $("video-say").textContent = `Reload the ${site} page to start CleanStream on it.`; return; }
    if (!r.video) { $("video-say").textContent = "Start a video to see what CleanStream found."; return; }
    const say = site !== "YouTube" ? {
      waiting: "Getting this title's subtitles…",
      none: "This title has no English subtitles, so bad language can't be muted.",
      empty: `${site} didn't share this title's subtitles. Reloading the page may help.`,
      error: "Couldn't read this title's subtitles.",
    }[r.captions] : {
      waiting: "Getting this video's captions…",
      none: "This video has no English captions, so bad language can't be muted.",
      empty: "YouTube didn't share this video's captions. Reloading the page may help.",
      error: "Couldn't read this video's captions.",
    }[r.captions];
    const n = r.mutes.length;
    let text = say || (n ? `${n} ${n === 1 ? "word or phrase" : "words or phrases"} will be muted.`
      : "Nothing to mute in the captions.");
    if (r.picture && r.picture.say) text += " " + r.picture.say;
    $("video-say").textContent = text;
    // which captions it's going by: a sign when something's off (only written ones: no word times)
    $("video-src").textContent = {
      auto: "Going by YouTube's automatic captions (each word's own time).",
      both: "Going by the video's written captions, timed by YouTube's automatic ones.",
      written: "Going by the video's written captions only, so word times are guessed.",
      subtitles: `Going by ${site}'s English subtitles (a line at a time, so each word's moment is ` +
        `guessed and muted a little wider). Scenes aren't checked on ${site}.`,
    }[r.source] || "";
    const items = [
      ...r.mutes.map(m => ({ t: m.s, w: m.text, why: m.why + (m.guess ? " (timing guessed)" : ""), cls: "" })),
      ...r.left.map(m => ({ t: m.s, w: m.text, why: "left alone: " + m.why, cls: "left" })),
      ...r.scenes.filter(x => x.skip).map(x => ({ t: x.from, w: "Scene skipped", why: `${x.why}, ${clock(x.from)}–${clock(x.to)}`, cls: "" })),
    ].sort((a, b) => a.t - b.t);
    $("found-box").hidden = !items.length;
    $("found-head").textContent = "What was found";
    const ul = $("found"); ul.textContent = "";
    for (const it of items) {
      const li = document.createElement("li"); li.className = it.cls;
      li.innerHTML = '<span class="t"></span><span class="w"></span><span class="why"></span>';
      li.children[0].textContent = clock(it.t); li.children[1].textContent = it.w; li.children[2].textContent = it.why;
      ul.appendChild(li);
    }
  }
  showVideo();
  setInterval(showVideo, 2000);

  // ---------- a newer version on GitHub? ----------
  const mine = chrome.runtime.getManifest().version;
  $("version").textContent = "CleanStream " + mine;
  const newer = (a, b) => {           // is version a newer than b? (compared as numbers: 0.1.10 > 0.1.9)
    const x = a.split(".").map(Number), y = b.split(".").map(Number);
    for (let k = 0; k < Math.max(x.length, y.length); k++) if ((x[k] || 0) !== (y[k] || 0)) return (x[k] || 0) > (y[k] || 0);
    return false;
  };
  chrome.runtime.sendMessage({ type: "check-files" }).catch(() => {});   // updated on disk: reload
  try {
    const r = await fetch(UPDATE_URL, { cache: "no-store" });
    const latest = r.ok ? (await r.json()).version : null;
    if (latest && newer(latest, mine)) {
      $("update-say").textContent = `A new version of CleanStream (${latest}) is ready. To get it, ` +
        `double-click "Update CleanStream" on your desktop.`;
      $("update-say").hidden = false;
    }
  } catch (e) { /* offline: say nothing */ }
})();
