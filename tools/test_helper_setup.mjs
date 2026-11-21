// Copyright (c) 2026 BookWorm824. All rights reserved. See LICENSE.
// Test: extension\helper\setup.ps1, which "Update CleanStream" runs after each update to set up the
// listening helper where CleanView is installed (the owner, 2026-11-21: "make it easier now").
// Into a scratch folder, never the registry. Silent: no window, nothing changed on the PC.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const REPO = path.resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"));
const SETUP = path.join(REPO, "extension", "helper", "setup.ps1");
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "cs-helper-setup-"));
let bad = 0;
const check = (ok, what) => { console.log((ok ? "  ok   " : "  FAIL ") + what); if (!ok) bad++; };
const run = (args, env = {}) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SETUP, ...args, "-NoRegistry"],
  { encoding: "utf8", windowsHide: true, env: { ...process.env, ...env } }).stdout.trim();
// Chrome's name for a copy loaded from a folder: the first half of the SHA-256 of the path (UTF-16,
// drive letter in capitals), in the letters a-p (two folders checked against Chrome on 2026-11-21)
const KNOWN = { "C:\\Users\\morga\\Downloads\\CleanStream\\extension": "lhhcdmdjkokbpnfnhmfekcbmdppaamcf" };

try {
  const fake = path.join(WORK, "local");                 // a stand-in for %LOCALAPPDATA%
  const to = path.join(WORK, "helper");
  check(run(["-To", to], { LOCALAPPDATA: fake }) === "no CleanView" && !fs.existsSync(to),
    "without CleanView it does nothing");

  fs.mkdirSync(path.join(fake, "CleanView", "venv", "Scripts"), { recursive: true });
  fs.writeFileSync(path.join(fake, "CleanView", "venv", "Scripts", "python.exe"), "");
  const [folder, id] = Object.entries(KNOWN)[0];
  check(run(["-Ext", folder, "-To", to], { LOCALAPPDATA: fake }) === "set up", "with CleanView it's set up");
  const json = () => JSON.parse(fs.readFileSync(path.join(to, "com.cleanstream.listen.json"), "utf8"));
  const raw = fs.readFileSync(path.join(to, "com.cleanstream.listen.json"));
  check(raw[0] === 0x7b, "the helper's file for Chrome has no byte-order mark");
  const h = json();
  check(h.name === "com.cleanstream.listen" && h.type === "stdio" && h.path === "listen_host.bat", "the helper's file says what Chrome needs");
  check(h.allowed_origins.includes(`chrome-extension://${id}/`), "the CleanStream copy in that folder is allowed");
  for (const f of ["listen_host.py", "listen_host.bat", "installed.txt"])
    check(fs.existsSync(path.join(to, f)), `${f} is there`);

  fs.writeFileSync(path.join(to, "com.cleanstream.listen.json"),
    JSON.stringify({ allowed_origins: ["chrome-extension://eapnjleldnohfnibikklgdndecbhdfle/", "https://bad.example/", "chrome-extension://short/"] }));
  run(["-Ext", folder.toLowerCase(), "-To", to], { LOCALAPPDATA: fake });
  const o = json().allowed_origins;
  check(o.includes(`chrome-extension://${id}/`), "the folder written in other capitals still gives the real name");
  check(o.includes("chrome-extension://eapnjleldnohfnibikklgdndecbhdfle/"), "a copy allowed before stays allowed");
  check(!o.some(x => /bad|short/.test(x)), "anything that isn't a CleanStream name is dropped");

  const cmd = fs.readFileSync(path.join(REPO, "extension", "update.cmd"), "utf8");
  check(/helper\\setup\.ps1/.test(cmd) && /-not \$env:CS_UPDATE_TEST/.test(cmd), "Update CleanStream runs it (not in its own test)");
  const ff = fs.readFileSync(path.join(REPO, "tools", "make_firefox.py"), "utf8");
  check(/LEAVE_OUT = \{[^}]*"helper"/.test(ff), "the Firefox copy leaves the helper out");
} finally { fs.rmSync(WORK, { recursive: true, force: true }); }
console.log(bad ? `${bad} FAILED` : "ALL OK");
process.exit(bad ? 1 : 0);
