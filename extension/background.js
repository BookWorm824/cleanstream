// CleanStream's background part: keeps a count on the toolbar button, and picks up new
// versions put in its folder.

// Updating: "Update CleanStream.bat" puts new files in the extension's folder. Chrome keeps
// running the old ones until the extension is reloaded, so the files on disk are looked at
// every minute (and when the settings window opens), and CleanStream reloads itself when
// their version differs from the one running.
async function checkFiles() {
  try {
    const r = await fetch(chrome.runtime.getURL("manifest.json"), { cache: "no-store" });
    const onDisk = (await r.json()).version;
    if (onDisk && onDisk !== chrome.runtime.getManifest().version) chrome.runtime.reload();
  } catch (e) { /* half-copied files: try again next time */ }
}
chrome.alarms.create("check-files", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(a => { if (a.name === "check-files") checkFiles(); });

// CleanStream is language only since 0.4.0 (the owner, 2026-11-18): the old nudity check's
// saved results ("pic:<video>") and its setting are cleared away
chrome.runtime.onInstalled.addListener(async () => {
  try {
    const all = await chrome.storage.local.get(null);
    const old = Object.keys(all).filter(k => k.startsWith("pic:"));
    if (old.length) await chrome.storage.local.remove(old);
    await chrome.storage.sync.remove("picture");
    const { ticks } = await chrome.storage.sync.get("ticks");
    if (ticks && Object.values(ticks).some(t => t && "nudity" in t)) {
      for (const t of Object.values(ticks)) if (t) delete t.nudity;
      await chrome.storage.sync.set({ ticks });
    }
  } catch (e) { /* nothing to clear */ }
});

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === "check-files") { checkFiles(); return; }
  if (msg.type === "found" && sender.tab) {
    chrome.action.setBadgeBackgroundColor({ color: "#2F6F62", tabId: sender.tab.id });
    chrome.action.setBadgeText({ text: msg.count ? String(msg.count) : "", tabId: sender.tab.id });
  }
});
