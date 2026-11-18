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
  if (!/3 words/.test(status || "") || !near(log, "title", 6.0, 7.4) || !near(log, "title", 10.4, 12.4) || !near(log, "title", 14.4, 15.9))
    problems.push("Prime muting");

  s = await serve("127.0.0.3", netflixPage, u => u.startsWith("/subs/") ? ["application/ttml+xml", ttml] : null);
  servers.push(s);
  p = await fx.open(`http://127.0.0.3:${s.address().port}/watch/81234567`, 15000);
  log = await p.eval("log"); status = await p.eval(STATUS);
  console.log("Netflix:", status, JSON.stringify(log));
  if (!/2 words/.test(status || "") || !near(log, "nf", 6.0, 7.4) || !near(log, "nf", 10.4, 12.4)) problems.push("Netflix muting");

  s = await serve("127.0.0.4", youtubePage);
  servers.push(s);
  p = await fx.open(`http://127.0.0.4:${s.address().port}/watch?v=TEST`, 11000);
  log = await p.eval("log"); status = await p.eval(STATUS);
  console.log("YouTube:", status, JSON.stringify(log));
  // the sound is off from the first moment until the captions are in, then off for "damn" only
  if (!/1 word/.test(status || "") || !log.length || log[0][2] !== true || !near(log, "yt", 8.5, 8.9)) problems.push("YouTube muting");

  const errs = fx.logs.filter(l => /^error/i.test(l) && /moz-extension|cleanstream/i.test(l));
  if (errs.length) { console.log("add-on errors:", errs.slice(0, 8)); problems.push("add-on errors"); }
} finally {
  await fx.close();
  for (const s of servers) s.close();
}
console.log(problems.length ? "PROBLEMS: " + problems.join(", ") : "ALL OK IN FIREFOX");
process.exit(problems.length ? 1 : 0);
