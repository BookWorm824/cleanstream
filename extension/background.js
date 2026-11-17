// CleanStream's background part: starts the hidden picture-check page when it's needed and
// passes stills to it. Also keeps a count on the toolbar button.
let opening = null;
async function offscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  opening = opening || chrome.offscreen.createDocument({ url: "offscreen.html",
    reasons: ["DOM_PARSER"], justification: "Checks video stills for nudity on this computer." })
    .finally(() => { opening = null; });
  await opening;
}

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

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.type === "check-files") { checkFiles(); return; }
  if (msg.type === "frame") {
    offscreen().then(() => chrome.runtime.sendMessage({ to: "offscreen", type: "check", jpeg: msg.jpeg }))
      .then(r => reply(r || { error: "no answer" }), e => reply({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === "found" && sender.tab) {
    chrome.action.setBadgeBackgroundColor({ color: "#2F6F62", tabId: sender.tab.id });
    chrome.action.setBadgeText({ text: msg.count ? String(msg.count) : "", tabId: sender.tab.id });
  }
});
