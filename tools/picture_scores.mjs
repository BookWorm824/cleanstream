// CleanStream's nudity scores for some JPEG files (in a hidden browser, through the
// extension's own picture check). Prints JSON: [[scores...], ...]. Used by check_picture.py.
import fs from "node:fs";
import { Browser, sleep } from "./cdp.mjs";
const ext = new URL("../extension/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const b = await Browser.start({ extension: ext });
try {
  const page = await b.open(`chrome-extension://${b.extensionId}/offscreen.html`);
  await page.waitFor("typeof check === 'function' && typeof ort === 'object'", 15000);
  const out = [];
  for (const f of process.argv.slice(2)) {
    const url = "data:image/jpeg;base64," + fs.readFileSync(f).toString("base64");
    out.push(await page.eval(`check(${JSON.stringify(url)})`));
  }
  const t0 = Date.now();
  for (let k = 0; k < 10; k++) await page.eval(`check(${JSON.stringify("data:image/jpeg;base64," + fs.readFileSync(process.argv[2]).toString("base64"))})`);
  console.log(JSON.stringify({ scores: out, msEach: (Date.now() - t0) / 10 }));
} finally { await b.close(); }
