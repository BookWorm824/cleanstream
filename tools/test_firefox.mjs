// CleanStream's Firefox copy, installed in a hidden, silent Firefox, on stand-in pages for Prime
// Video, Netflix and YouTube (made-up subtitles with known bad words). Checks that the add-on's
// own scripts run there and mute at the right moments. Run tools/make_firefox.py --test first.
//   node tools/test_firefox.mjs
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { Firefox, sleep } from "./firefox.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const ADDON = path.join(ROOT, "build", "firefox-test");

// a 30-second test video (picture and a tone; what's said doesn't matter here)
const VIDEO = path.join(os.tmpdir(), "cleanstream-fx-test.mp4");
if (!fs.existsSync(VIDEO)) {
  const ffmpeg = path.join(process.env.LOCALAPPDATA, "CleanView", "app", "bin", "ffmpeg.exe");
  spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", "-movflags", "+faststart", VIDEO]);
}
const vid = fs.readFileSync(VIDEO);

const LOG = `<script>window.log = [];
  document.addEventListener("volumechange", e => log.push([e.target.id || "v", +(e.target.currentTime).toFixed(2), e.target.muted]), true);</script>`;
const STATUS = "document.getElementById('cleanstream-status')?.textContent";

// ---- Prime Video: the player asks for its playback resources, which list the subtitle files
const dfxp = `<?xml version="1.0" encoding="utf-8"?><tt xmlns="http://www.w3.org/ns/ttml"><body><div>
<p begin="00:00:06.000" end="00:00:09.500">It was a damn cold winter,<br/>and the snow piled up</p>
<p begin="00:00:10.000" end="00:00:13.500">My brother said, "What the hell are we going to do now?"</p>
<p begin="00:00:15.000" end="00:00:17.000">Oh, my God, the road was covered in ice.</p></div></body></tt>`;
const primePage = `<!doctype html>${LOG}<body><div class="webPlayerSDKContainer"></div><script>
setTimeout(async () => {
  await fetch("/cdp/catalog/GetPlaybackResources?asin=B0TEST&desiredResources=PlaybackUrls,SubtitleUrls").then(r => r.json());
  const v = document.createElement("video"); v.id = "title"; v.src = "/v.mp4"; v.autoplay = true;
  document.querySelector(".webPlayerSDKContainer").appendChild(v);
}, 1500);</script>`;
const resources = JSON.stringify({ catalogMetadata: { catalog: { id: "B0TEST" } }, timedTextUrls: { result: { subtitleUrls: [
  { url: "/subs/en-sdh.dfxp", languageCode: "en-us", type: "sdh", format: "TTMLv2" }] } } });

// ---- Netflix: a player API like Netflix's; the subtitle file comes when English is chosen
const ttml = `<?xml version="1.0" encoding="utf-8"?><tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttp="http://www.w3.org/ns/ttml#parameter" ttp:tickRate="10000000"><body><div>
<p begin="60000000t" end="95000000t">It was a damn cold winter,<br/>and the snow piled up</p>
<p begin="100000000t" end="135000000t">My brother said, "What the hell<br/>are we going to do now?"</p></div></body></tt>`;
const netflixPage = `<!doctype html>${LOG}<script>
  const tracks = [{ trackId: "none", isNoneTrack: true }, { trackId: "en-cc", bcp47: "en", trackType: "ASSISTIVE" }];
  let current = tracks[0];
  const p = { getTimedTextTrackList: () => tracks, getTimedTextTrack: () => current,
    setTimedTextTrack: t => { current = t; if (t.trackId === "en-cc") { const x = new XMLHttpRequest(); x.open("GET", "/subs/nf"); x.responseType = "arraybuffer"; x.send(); } return Promise.resolve(); } };
  window.netflix = { appContext: { state: { playerApp: { getAPI: () => ({ videoPlayer: { getAllPlayerSessionIds: () => ["s1"], getVideoPlayerBySessionId: () => p } }) } } } };
</script><body><div class="watch-video"><video id="nf" src="/v.mp4" autoplay></video></div>`;

// ---- YouTube: the player box and its video; the captions are handed over as page.js would
const youtubePage = `<!doctype html>${LOG}<body><div id="movie_player"><video id="yt" class="html5-main-video" src="/v.mp4" autoplay></video></div>
<script>setTimeout(() => window.postMessage({ cleanstream: "page", type: "captions-done", video: "TEST", written: null,
  auto: JSON.stringify({ events: [{ tStartMs: 8000, dDurationMs: 2000, segs: [{ utf8: "well" }, { utf8: " damn", tOffsetMs: 500 }, { utf8: " it", tOffsetMs: 1000 }] }] }) }, "*"), 3000);</script>`;

// ---- Hulu and the others: WebVTT pieces as the video plays; the player shows each line inside a
// closed shadow root, and notes any drawn frame in which a listed word could be read
const vttOf = cues => "WEBVTT\n\n" + cues.map(([a, b, t], k) => `${k + 1}\n00:00:${a} --> 00:00:${b}\n${t}\n`).join("\n");
const piece1 = vttOf([["06.000", "09.500", "It was a damn cold winter,"]]);
const piece2 = vttOf([["10.000", "13.500", "What the hell are we going to do?"]]);
const shownPage = `<!doctype html><body><x-player></x-player><script>
window.log = []; window.readable = []; window.pills = [];
const root = document.querySelector("x-player").attachShadow({ mode: "closed" });
root.innerHTML = '<div style="position:relative;width:320px"><video id="ot" src="/v.mp4" autoplay style="width:320px"></video><div class="cues" style="position:absolute;bottom:16px;left:0;right:0;text-align:center"></div></div>';
const v = root.querySelector("video"), box = root.querySelector(".cues");
v.addEventListener("volumechange", () => log.push(["ot", +v.currentTime.toFixed(2), v.muted]));
const CUES = [[6, 9.5, "It was a damn cold winter,"], [10, 13.5, "What the hell are we going to do?"]];
let cur = -1;
function draw() {
  const el = box.firstElementChild;           // the frame just drawn
  if (el && /damn|hell/.test(el.textContent) && getComputedStyle(el).opacity !== "0" && getComputedStyle(box).opacity !== "0") readable.push(+v.currentTime.toFixed(2));
  const k = CUES.findIndex(c => v.currentTime >= c[0] && v.currentTime < c[1]);
  if (k !== cur) { cur = k; box.innerHTML = k < 0 ? "" : '<div class="cue"><span></span></div>'; if (k >= 0) box.querySelector("span").textContent = CUES[k][2]; }
  const pill = document.getElementById("cleanstream-status") || root.getElementById("cleanstream-status");
  if (pill && pills[pills.length - 1] !== pill.textContent) pills.push(pill.textContent);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
setTimeout(() => fetch("/subs/1.vtt").then(r => r.text()), 1500);
setTimeout(() => fetch("/subs/2.vtt").then(r => r.text()), 7000);
</script>`;

const serve = (host, page, extra = () => null) => new Promise(res => {
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith("/v.mp4")) { r.writeHead(200, { "content-type": "video/mp4" }); return r.end(vid); }
    const x = extra(q.url);
    if (x) { r.writeHead(200, { "content-type": x[0] }); return r.end(x[1]); }
    r.writeHead(200, { "content-type": "text/html" }); r.end(page);
  });
  srv.listen(0, host, () => res(srv));
});

const problems = [];
const near = (log, id, from, to) => {      // muted close to `from` and unmuted close to `to`
  const on = log.find(([v, t, m]) => v === id && m && Math.abs(t - from) < 0.5);
  const off = log.find(([v, t, m]) => v === id && !m && Math.abs(t - to) < 0.5);
  return !!(on && off);
};
const servers = [];
const fx = await Firefox.start();
try {
  console.log("Firefox add-on installed:", await fx.install(ADDON));

  let s = await serve("127.0.0.2", primePage, u => u.startsWith("/cdp/") ? ["application/json", resources]
    : u.startsWith("/subs/") ? ["application/ttml+xml", dfxp] : null);
  servers.push(s);
  let p = await fx.open(`http://127.0.0.2:${s.address().port}/gp/video/detail/B0TEST`, 24000);
  let log = await p.eval("log"), status = await p.eval(STATUS);
  console.log("Prime:", status, JSON.stringify(log));
  if (!/3 words/.test(status || "") || !near(log, "title", 5.85, 7.4) || !near(log, "title", 10.25, 12.4) || !near(log, "title", 14.25, 15.9))
    problems.push("Prime muting");

  s = await serve("127.0.0.3", netflixPage, u => u.startsWith("/subs/") ? ["application/ttml+xml", ttml] : null);
  servers.push(s);
  p = await fx.open(`http://127.0.0.3:${s.address().port}/watch/81234567`, 15000);
  log = await p.eval("log"); status = await p.eval(STATUS);
  console.log("Netflix:", status, JSON.stringify(log));
  if (!/2 words/.test(status || "") || !near(log, "nf", 5.85, 7.4) || !near(log, "nf", 10.25, 12.4)) problems.push("Netflix muting");

  s = await serve("127.0.0.4", youtubePage);
  servers.push(s);
  p = await fx.open(`http://127.0.0.4:${s.address().port}/watch?v=TEST`, 11000);
  log = await p.eval("log"); status = await p.eval(STATUS);
  console.log("YouTube:", status, JSON.stringify(log));
  // the sound is off from the first moment until the captions are in, then off for "damn" only
  if (!/1 word/.test(status || "") || !log.length || log[0][2] !== true || !near(log, "yt", 8.1, 8.9)) problems.push("YouTube muting");

  // Hulu and the others: subtitles read in pieces, shown by the player inside a closed-off part of
  // the page (as Disney+): hidden on screen, the words muted (0.4.21)
  s = await serve("127.0.0.5", shownPage, u => u.startsWith("/subs/1") ? ["text/vtt", piece1]
    : u.startsWith("/subs/2") ? ["text/vtt", piece2] : null);
  servers.push(s);
  p = await fx.open(`http://127.0.0.5:${s.address().port}/watch/abc-123`, 21000);
  log = await p.eval("log"); status = await p.eval("pills.join(' | ')");
  const seen = await p.eval("readable");
  console.log("Hulu (closed player):", status, JSON.stringify(log), "readable:", JSON.stringify(seen));
  if (!/hiding the subtitles/.test(status || "") || seen.length || !near(log, "ot", 6.4, 8.2) || !near(log, "ot", 9.6, 11.8))
    problems.push("Hulu hidden subtitles");

  const errs = fx.logs.filter(l => /^error/i.test(l) && /moz-extension|cleanstream/i.test(l));
  if (errs.length) { console.log("add-on errors:", errs.slice(0, 8)); problems.push("add-on errors"); }
} finally {
  await fx.close();
  for (const s of servers) s.close();
}
console.log(problems.length ? "PROBLEMS: " + problems.join(", ") : "ALL OK IN FIREFOX");
process.exit(problems.length ? 1 : 0);
