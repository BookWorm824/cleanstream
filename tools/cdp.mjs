// A hidden browser for testing CleanStream (nothing shows on screen).
// Starts Chrome or Edge headless with its own throwaway profile, loads the extension,
// and lets a test script open pages and run JavaScript in them through the DevTools
// protocol over a pipe.
//
//   import { Browser } from "./cdp.mjs";
//   const b = await Browser.start({ extension: "../extension" });
//   const page = await b.open("https://www.youtube.com/watch?v=...");
//   console.log(await page.eval("document.title"));
//   await b.close();
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BROWSERS = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];

export class Browser {
  static async start({ extension = null, exe = null, headless = true, args = [] } = {}) {
    exe = exe || process.env.CLEANSTREAM_BROWSER || BROWSERS.find(p => fs.existsSync(p));
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "cleanstream-test-"));
    const flags = [
      `--user-data-dir=${profile}`, "--remote-debugging-pipe",
      "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check",
      "--autoplay-policy=no-user-gesture-required", "--mute-audio", "--window-size=1280,800",
      "--disable-features=Translate,MediaRouter", "--lang=en-US",
      ...(headless ? ["--headless=new"] : []), ...args, "about:blank",
    ];
    const proc = spawn(exe, flags, { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] });
    const b = new Browser(proc, profile);
    if (extension) {
      const r = await b.send("Extensions.loadUnpacked", { path: path.resolve(extension) });
      b.extensionId = r.id;
    }
    return b;
  }

  constructor(proc, profile) {
    this.proc = proc; this.profile = profile; this.id = 0; this.waiting = new Map();
    this.listeners = []; let buf = "";
    proc.stdio[4].on("data", d => {
      buf += d.toString("utf8");
      let k;
      while ((k = buf.indexOf("\0")) >= 0) {
        const msg = JSON.parse(buf.slice(0, k)); buf = buf.slice(k + 1);
        if (msg.id && this.waiting.has(msg.id)) {
          const { ok, no } = this.waiting.get(msg.id); this.waiting.delete(msg.id);
          msg.error ? no(new Error(JSON.stringify(msg.error))) : ok(msg.result);
        } else for (const f of this.listeners) f(msg);
      }
    });
  }

  send(method, params = {}, sessionId) {
    const id = ++this.id;
    this.proc.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + "\0");
    return new Promise((ok, no) => this.waiting.set(id, { ok, no }));
  }

  on(f) { this.listeners.push(f); }

  async open(url) {
    const { targetId } = await this.send("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, sessionId, targetId);
    await page.send("Runtime.enable");
    await page.send("Page.enable");
    if (url) await page.goto(url);
    return page;
  }

  async close() {
    try { await this.send("Browser.close"); } catch { /* already gone */ }
    await new Promise(r => setTimeout(r, 500));
    try { this.proc.kill(); } catch { /* gone */ }
    try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch { /* in use */ }
  }
}

export class Page {
  constructor(b, sessionId, targetId) {
    this.b = b; this.sessionId = sessionId; this.targetId = targetId; this.logs = [];
    this.contexts = [];                // [{id, name, frameId, type}] incl. extension worlds
    b.on(msg => {
      if (msg.sessionId !== sessionId) return;
      if (msg.method === "Runtime.executionContextCreated") {
        const c = msg.params.context;
        this.contexts.push({ id: c.id, name: c.name, origin: c.origin, frameId: c.auxData && c.auxData.frameId,
          type: c.auxData && c.auxData.type, isDefault: c.auxData && c.auxData.isDefault });
      }
      if (msg.method === "Runtime.executionContextsCleared") this.contexts = [];
      if (msg.method === "Runtime.consoleAPICalled")
        this.logs.push(msg.params.args.map(a => a.value ?? a.description).join(" "));
      if (msg.method === "Runtime.exceptionThrown")
        this.logs.push("ERROR " + (msg.params.exceptionDetails.exception?.description ||
          msg.params.exceptionDetails.text));
    });
  }

  send(method, params = {}) { return this.b.send(method, params, this.sessionId); }

  async goto(url, wait = 4000) {
    await this.send("Page.navigate", { url });
    await new Promise(r => setTimeout(r, wait));
  }

  async eval(expr, { awaitPromise = true, contextId } = {}) {
    const r = await this.send("Runtime.evaluate", { expression: expr, awaitPromise,
      returnByValue: true, ...(contextId ? { contextId } : {}) });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ||
      r.exceptionDetails.text);
    return r.result.value;
  }

  /** The extension's own world in the top frame (where content.js runs). */
  async extWorld(ms = 15000) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const c = this.contexts.filter(x => x.type === "isolated" && /CleanStream/i.test(x.name || ""));
      const top = c.find(x => x.frameId === this.targetId) || c[0];
      if (top) return top.id;
      await new Promise(r => setTimeout(r, 250));
    }
    return null;
  }

  async waitFor(expr, ms = 20000, step = 250, contextId) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      try { const v = await this.eval(expr, { contextId }); if (v) return v; } catch { /* not yet */ }
      await new Promise(r => setTimeout(r, step));
    }
    return null;
  }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
