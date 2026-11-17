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
    $("mine").value = s.mine || "";
  }

  $("on").addEventListener("change", async e => { s.on = e.target.checked; await S.save({ on: s.on }); draw(); });
  // her own words: saved a moment after each change, and at once when the window closes (it used
  // to wait half a second, so words typed just before clicking back on the video were lost:
  // "i added the words but when i hit enter they didnt take", 2026-11-17)
  let typing = null;
  const saveMine = () => {
    clearTimeout(typing); typing = null;
    if (($("mine").value || "") === (s.mine || "")) return;
    s.mine = $("mine").value;
    S.save({ mine: s.mine }).then(() => { $("mine-saved").textContent = "Saved."; });
  };
  $("mine").addEventListener("input", () => {
    $("mine-saved").textContent = "";
    clearTimeout(typing); typing = setTimeout(saveMine, 150);
  });
  $("mine").addEventListener("change", saveMine);
  addEventListener("blur", saveMine);
  addEventListener("pagehide", saveMine);
  document.addEventListener("visibilitychange", () => { if (document.hidden) saveMine(); });
  $("reset").addEventListener("click", async () => {
    s.ticks = { ...(s.ticks || {}), [s.profile]: {} };
    await S.save({ ticks: s.ticks }); draw();
  });
  draw();

  // ---------- what was found in the video open in this tab ----------
  async function showVideo() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !/^https:\/\/www\.youtube\.com\//.test(tab.url || "")) {
      $("video-box").hidden = false;
      $("video-say").textContent = "Open a YouTube video to use CleanStream.";
      return;
    }
    let r = null;
    try { r = await chrome.tabs.sendMessage(tab.id, { type: "state" }); } catch (e) { /* not loaded yet */ }
    $("video-box").hidden = false;
    if (!r) { $("video-say").textContent = "Reload the YouTube page to start CleanStream on it."; return; }
    if (!r.video) { $("video-say").textContent = "Open a video to see what CleanStream found."; return; }
    const say = {
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
        `double-click "Update CleanStream" in the CleanStream folder.`;
      $("update-say").hidden = false;
    }
  } catch (e) { /* offline: say nothing */ }
})();
