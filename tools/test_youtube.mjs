// CleanStream on real YouTube, in a hidden browser (nothing shows on screen):
//  1. the extension loads, and says plainly when it can't get captions;
//  2. muting happens at the right moments on YouTube's real player (made-up captions with
//     known swear times are handed to it, since YouTube gives no captions to a test browser);
//  3. the look-ahead picture check starts and checks stills ahead of the video.
//   node tools/test_youtube.mjs [videoId]
import { Browser, sleep } from "./cdp.mjs";

const id = process.argv[2] || "dQw4w9WgXcQ";
const ext = new URL("../extension/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const b = await Browser.start({ extension: ext });
const errors = [];
try {
  console.log("extension loaded:", b.extensionId);
  const page = await b.open(null);
  await page.goto(`https://www.youtube.com/watch?v=${id}`, 2000);
  await page.waitFor("document.querySelector('#movie_player video')?.readyState >= 2", 30000);
  const world = await page.extWorld();
  console.log("CleanStream running on the page:", !!world);

  // 1. the status line
  const status = await page.waitFor(`(() => { const s = document.getElementById('cleanstream-status');
    return s && !/getting/.test(s.textContent) ? s.textContent : null; })()`, 25000);
  console.log("status line:", status);

  // 2. muting at the right moments: swears placed 3 s and 6 s ahead of where the video is
  const now = await page.eval("document.querySelector('#movie_player video').currentTime");
  const t1 = Math.ceil(now) + 3, t2 = t1 + 3;
  const json3 = { events: [
    { tStartMs: t1 * 1000 - 800, dDurationMs: 2000, segs: [{ utf8: "well" }, { utf8: " that", tOffsetMs: 400 }, { utf8: " damn", tOffsetMs: 800 }, { utf8: " thing", tOffsetMs: 1200 }] },
    { tStartMs: t2 * 1000 - 400, dDurationMs: 2000, segs: [{ utf8: "oh" }, { utf8: " my", tOffsetMs: 200 }, { utf8: " god", tOffsetMs: 400 }, { utf8: " look", tOffsetMs: 800 }] },
  ] };
  await page.eval(`window.postMessage({ cleanstream: "page", type: "captions-done", video: ${JSON.stringify(id)},
    written: null, auto: ${JSON.stringify(JSON.stringify(json3))} }, "*")`);
  const plan = await page.eval("JSON.stringify(globalThis.__cleanstreamState.ranges)", { contextId: world });
  console.log("mutes planned:", plan, "(swears at", t1, "and", t2 + ")");
  // watch video.muted against the video's clock
  const log = await page.eval(`(async () => {
    const v = document.querySelector('#movie_player video'), out = [];
    let last = v.muted; const end = performance.now() + 9000;
    while (performance.now() < end) {
      if (v.muted !== last) { out.push([+v.currentTime.toFixed(3), v.muted]); last = v.muted; }
      await new Promise(r => setTimeout(r, 5));
    }
    return out;
  })()`);
  console.log("muted / unmuted at (video time):", JSON.stringify(log));
  const ranges = JSON.parse(plan);
  const ok = ranges.length === 2 && log.length >= 4 && ranges.every(([a, z], k) =>
    Math.abs(log[2 * k][0] - a) < 0.1 && log[2 * k][1] === true && Math.abs(log[2 * k + 1][0] - z) < 0.1 && log[2 * k + 1][1] === false);
  console.log(ok ? "MUTE TIMING OK (within 0.1 s)" : "MUTE TIMING WRONG");
  if (!ok) errors.push("mute timing");

  // 3. the look-ahead picture check
  await page.waitFor(`Object.keys(globalThis.CSPicture._scores()).length > 20`, 90000, 1000, world)
    .then(() => {}, () => {});
  await sleep(1000);
  const pic = await page.eval(`(() => {
    const s = globalThis.CSPicture && globalThis.CSPicture._scores();
    const keys = Object.keys(s || {}).map(Number).sort((a, b) => a - b);
    const v = document.querySelector('#movie_player video');
    return { scout: !!document.getElementById('cleanstream-scout'), checked: keys.length,
      dark: keys.filter(k => s[k] === null).length, from: keys[0], to: keys[keys.length - 1],
      watching: v.currentTime, report: globalThis.CSPicture.report(),
      scenes: globalThis.__cleanstreamState.scenes.length,
      highest: keys.length ? Math.max(...keys.filter(k => s[k]).map(k => Math.max(...s[k]))) : null };
  })()`, { contextId: world });
  console.log("picture check:", JSON.stringify(pic));
  if (!pic.checked) errors.push("picture check didn't run");
  else if (pic.to <= pic.watching) errors.push("picture check isn't ahead");
  // 4. the look-ahead copy stays silent, even when YouTube turns its sound back on
  const hush = await page.eval(`(async () => {
    const f = document.getElementById('cleanstream-scout');
    const v = f && f.contentDocument && f.contentDocument.querySelector('#movie_player video');
    if (!v) return { found: false };
    const before = v.muted;
    v.muted = false;
    await new Promise(r => setTimeout(r, 250));
    return { found: true, before, after: v.muted, rate: v.playbackRate };
  })()`);
  console.log("look-ahead copy silent:", JSON.stringify(hush));
  if (!hush.found || !hush.before || !hush.after) errors.push("look-ahead copy not silent");
  const logs = page.logs.filter(l => /cleanstream|ERROR/i.test(l)).slice(0, 10);
  if (logs.length) console.log("page messages:", logs);
} finally {
  await b.close();
}
console.log(errors.length ? "PROBLEMS: " + errors.join(", ") : "ALL OK");
process.exit(errors.length ? 1 : 0);
