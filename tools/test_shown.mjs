// Subtitles the player shows on screen (Hulu, Disney+, Max, Peacock, Paramount+): hidden while
// CleanStream reads them in pieces, their listed words starred either way. Stand-in pages in a
// hidden, silent browser; each shows its subtitles a different way:
//   new     a new element for each line, inside the player
//   rows    one lasting box, each line put in as two rows
//   shadow  video and subtitles inside a closed-off part of the page (as Disney+)
//   track   the browser's own text track
//   whole   the whole subtitle file came by itself (Hulu's list): shown, words starred
//   node tools/test_shown.mjs
import fs from "node:fs"; import http from "node:http"; import os from "node:os"; import path from "node:path";
import { spawnSync } from "node:child_process";
import { Browser } from "./cdp.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "..");
const EXT = path.join(ROOT, "extension");
const VIDEO = path.join(os.tmpdir(), "cleanstream-fx-test.mp4");
if (!fs.existsSync(VIDEO)) {
  const ffmpeg = path.join(process.env.LOCALAPPDATA, "CleanView", "app", "bin", "ffmpeg.exe");
  spawnSync(ffmpeg, ["-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=25:duration=30",
    "-f", "lavfi", "-i", "sine=frequency=440:duration=30", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-c:a", "aac", "-shortest", "-movflags", "+faststart", VIDEO]);
}
const vid = fs.readFileSync(VIDEO);

const CUES = [[6, 9.5, "It was a damn cold winter,"], [10, 13.5, "My brother said, \"What the hell are we going to do?\""],
  [15, 17, "Oh, my God, the road was ice."], [18, 20, "No."]];
const stamp = t => `00:00:${t.toFixed(3).padStart(6, "0")}`;
const vtt = cues => "WEBVTT\n\n" + cues.map(([a, b, t], k) => `${k + 1}\n${stamp(a)} --> ${stamp(b)}\n${t}\n`).join("\n");
const playlist = JSON.stringify({ transcripts_urls: { webvtt: { en: "/subs/en.vtt" } } });
const src = f => fs.readFileSync(path.join(EXT, f), "utf8");
const FILES = ["words_data.js", "words.js", "captions.js", "settings.js", "site_other.js", "site.js"];
const stub = `<script>window.chrome = { runtime: { id: "x", sendMessage: async () => ({}), onMessage: { addListener() {} } },
  storage: { local: { get: async () => ({}), set: async () => {} }, sync: { get: async d => d, set: async () => {} }, onChanged: { addListener() {} } } };</script>`;

// the stand-in player: shows each line at its moment, and notes every drawn frame in which a
// listed word could be read (seen = text with the word in it, and not see-through)
const player = mode => `
const CUES = ${JSON.stringify(CUES)}, mode = ${JSON.stringify(mode)};
window.muteLog = []; window.readable = []; window.shownFrames = 0; window.pills = [];
let root = document, box = document.getElementById("player");
if (mode === "shadow") {
  const host = document.createElement("x-player"); document.body.appendChild(host);
  root = host.attachShadow({ mode: "open" });
  root.innerHTML = '<div id="player" style="position:relative;width:640px"><video src="/v.mp4" autoplay style="width:640px"></video>' +
    '<div class="hive-subtitle-renderer-wrapper"></div></div>';
  box = root.getElementById("player");
}
const v = root.querySelector("video");
v.addEventListener("volumechange", () => muteLog.push([+v.currentTime.toFixed(2), v.muted]));
let lines = [];                                    // the elements showing subtitles now
const shownEls = () => mode === "rows" ? [...box.querySelectorAll(".win")] : mode === "shadow" ? [...box.querySelectorAll(".hive-subtitle-renderer-cue")] : lines;
let cur = -1, track = null;
if (mode === "track") { track = v.addTextTrack("subtitles", "English", "en"); track.mode = "showing"; }
// what could be read in the frame just drawn (checked before this frame's own changes: a change
// made in this callback isn't on screen until CleanStream's watcher has seen it)
const seeThrough = el => { for (let e = el; e && e.nodeType === 1; e = e.parentElement) if (+getComputedStyle(e).opacity === 0) return true; return false; };
function seen() {
  for (const el of shownEls()) {
    if (!el.isConnected || !el.textContent.trim()) continue;
    if (!seeThrough(el)) { shownFrames++; if (/damn|hell\\b|God/.test(el.textContent)) readable.push([+v.currentTime.toFixed(2), el.textContent]); }
  }
}
function draw() {
  seen();
  const t = v.currentTime, k = CUES.findIndex(c => t >= c[0] && t < c[1]);
  if (k !== cur) {
    cur = k;
    const text = k < 0 ? "" : CUES[k][2];
    if (mode === "new" || mode === "whole") {
      lines.forEach(l => l.remove()); lines = [];
      if (text) { const w = document.createElement("div"); w.className = "subwrap"; w.style.cssText = "position:absolute;bottom:20px;left:0;right:0;text-align:center";
        w.innerHTML = '<div class="subline"><span></span></div>'; w.querySelector("span").textContent = text; box.appendChild(w); lines = [w]; }
    } else if (mode === "rows") {
      const win = box.querySelector(".win"), words = text.split(" "), half = Math.ceil(words.length / 2);
      win.innerHTML = "";
      if (text) for (const row of [words.slice(0, half), words.slice(half)]) if (row.length) { const p = document.createElement("p"); p.className = "row"; p.textContent = row.join(" "); win.appendChild(p); }
    } else if (mode === "shadow") {
      const w = box.querySelector(".hive-subtitle-renderer-wrapper");
      w.innerHTML = text ? '<div class="hive-subtitle-renderer-cue"><span></span></div>' : "";
      if (text) w.querySelector("span").textContent = text;
    }
  }
  const pill = (box.querySelector("#cleanstream-status") || document.getElementById("cleanstream-status"));
  if (pill && pill.textContent && pills[pills.length - 1] !== pill.textContent) pills.push(pill.textContent);
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);
if (mode === "track") setTimeout(() => { for (const [a, b, t] of CUES) track.addCue(new VTTCue(a, b, t)); }, 1200);
if (mode === "whole") setTimeout(() => fetch("/v6/playlist", { method: "POST" }).then(r => r.json()), 900);
else { setTimeout(() => fetch("/subs/seg1.vtt").then(r => r.text()), 1500); setTimeout(() => fetch("/subs/seg2.vtt").then(r => r.text()), 7000); }
`;
const page = mode => `<!doctype html>${stub}<script>${src("other_page.js")}</script><body style="margin:0">
${mode === "shadow" ? "" : `<div id="player" style="position:relative;width:640px"><video src="/v.mp4" autoplay style="width:640px"></video>
  <div class="controls"><button id="play">Play</button></div>
  <div id="overlay" class="title" style="position:absolute;top:10px;left:10px">Cold winter</div>
  ${mode === "rows" ? '<div class="cc" style="position:absolute;bottom:20px;left:0;right:0"><div class="win"></div></div>' : ""}</div>`}
<p id="below">It was a damn cold winter,</p>
<script>window.SRC = ${JSON.stringify(Object.fromEntries(FILES.map(f => [f, src(f)]))).replace(/<\/script/g, "<\\/script")};
setTimeout(() => { for (const f of ${JSON.stringify(FILES)}) { const s = document.createElement("script"); s.textContent = SRC[f]; document.body.appendChild(s); } }, 400);
${player(mode)}</script>`;

const problems = [];
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) problems.push(what); };
for (const mode of (process.argv[2] ? [process.argv[2]] : ["new", "rows", "shadow", "track", "whole"])) {
  const srv = http.createServer((q, r) => {
    if (q.url.startsWith("/v.mp4")) { r.writeHead(200, { "content-type": "video/mp4" }); return r.end(vid); }
    if (q.url.startsWith("/v6/playlist")) { r.writeHead(200, { "content-type": "application/json" }); return r.end(playlist); }
    if (q.url.startsWith("/subs/")) {
      r.writeHead(200, { "content-type": "text/vtt" });
      return r.end(q.url.includes("seg1") ? vtt(CUES.slice(0, 1)) : q.url.includes("seg2") ? vtt(CUES.slice(1)) : vtt(CUES));
    }
    r.writeHead(200, { "content-type": "text/html" }); r.end(page(mode));
  });
  await new Promise(r => srv.listen(0, "127.0.0.1", r));
  const b = await Browser.start({});
  try {
    const p = await b.open(null);
    await p.goto(`http://127.0.0.1:${srv.address().port}/watch/abc-123`, 21500);
    console.log(`--- ${mode}`);
    const r = await p.eval(`({ readable, shownFrames, pills, muteLog, shown: __cleanstreamState.shown, n: __cleanstreamState.plan && __cleanstreamState.plan.mutes.length,
      overlay: document.getElementById("overlay") && document.getElementById("overlay").style.opacity,
      below: document.getElementById("below").style.opacity + "|" + document.getElementById("below").textContent,
      play: document.getElementById("play") && document.getElementById("play").style.opacity,
      cues: typeof track !== "undefined" && track ? [...track.cues].map(c => c.text) : null,
      cueStyle: [...document.querySelectorAll("style")].some(s => /::cue/.test(s.textContent)) })`);
    console.log("  ", JSON.stringify(r));
    const muted = r.muteLog.filter(x => x[1]).map(x => x[0]);
    check(r.n === 3 && [6, 10, 15].every(t => muted.some(m => m >= t - 1 && m <= t + 3.6)), `the three words are muted (${JSON.stringify(muted)})`);
    check(r.readable.length === 0, `no frame where a listed word could be read (${r.readable.length})`);
    if (mode === "whole") {
      check(r.shownFrames > 200, `the subtitles stay on screen (${r.shownFrames} frames)`);
      check(!r.pills.some(x => /hiding/.test(x)), "no 'hiding' message");
    } else if (mode === "track") {
      check(r.cues && r.cues[0].includes("d***") && r.cues[1].includes("h***") && !/damn|hell\b/.test(r.cues.join(" ")), `the text track's words are starred ${JSON.stringify(r.cues)}`);
      check(r.cueStyle, "the text track is hidden with a style");
    } else {
      check(r.shownFrames === 0, `the subtitles are never on screen (${r.shownFrames} frames)`);
      check(r.pills.some(x => /hiding the subtitles/.test(x)), "says it is hiding them");
    }
    if (mode !== "shadow") check(!r.overlay && !r.play, "the title and the button stay");
    check(r.below.startsWith("|"), "text outside the video stays " + r.below);
  } finally { await b.close(); srv.close(); }
}
console.log(problems.length ? "PROBLEMS: " + problems.join(" | ") : "ALL OK");
process.exit(problems.length ? 1 : 0);
