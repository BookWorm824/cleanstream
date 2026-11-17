// Look inside the hidden look-ahead player (for working out problems).
import { Browser, sleep } from "./cdp.mjs";
const id = process.argv[2] || "dQw4w9WgXcQ";
const ext = new URL("../extension/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const b = await Browser.start({ extension: ext });
try {
  const page = await b.open(null);
  await page.goto(`https://www.youtube.com/watch?v=${id}`, 2000);
  await page.waitFor("document.getElementById('cleanstream-scout')", 30000);
  await sleep(+process.env.WAIT || 40000);
  const tree = await page.send("Page.getFrameTree");
  const kids = (tree.frameTree.childFrames || []).map(f => f.frame).filter(f => f.url.includes("watch"));
  console.log("embed frames:", kids.map(f => f.url.slice(0, 120)));
  for (const f of kids) {
    const cs = page.contexts.filter(c => c.frameId === f.id);
    console.log("contexts in it:", cs.map(c => `${c.type}:${c.name}`));
    for (const iso of cs.filter(c => c.type === "isolated")) {
      try { console.log("scout state in", iso.id, JSON.stringify(await page.eval("[window.name, location.href.slice(0,80), globalThis.__cleanstreamScout ? globalThis.__cleanstreamScout() : 'scout.js not active']", { contextId: iso.id }))); }
      catch (e) { console.log("context", iso.id, "gone"); }
    }
    const main = cs.find(c => c.isDefault);
    if (main) console.log("in the embed:", JSON.stringify(await page.eval(`(() => { const v = document.querySelector('video');
      return { video: !!v, t: v && v.currentTime, paused: v && v.paused, rate: v && v.playbackRate, rs: v && v.readyState,
        w: v && v.videoWidth, err: document.querySelector('.ytp-error')?.textContent?.slice(0, 200) || null,
        text: document.body.innerText.slice(0, 120), name: window.name, ad: !!document.querySelector('#movie_player.ad-showing') }; })()`, { contextId: main.id })));
  }
  console.log("logs:", page.logs.slice(-15));
} finally { await b.close(); }
