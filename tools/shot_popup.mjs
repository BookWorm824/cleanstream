// A picture of the settings window, for checking how it looks (hidden browser).
import fs from "node:fs";
import { Browser, sleep } from "./cdp.mjs";
const ext = new URL("../extension/", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
const out = process.argv[2] || "popup.png";
const b = await Browser.start({ extension: ext });
try {
  const page = await b.open(null);
  await page.send("Emulation.setDeviceMetricsOverride", { width: 340, height: 900, deviceScaleFactor: 1, mobile: false });
  await page.goto(`chrome-extension://${b.extensionId}/popup.html`, 1500);
  const h = await page.eval("document.documentElement.scrollHeight");
  await page.send("Emulation.setDeviceMetricsOverride", { width: 340, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  const { data } = await page.send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(out, Buffer.from(data, "base64"));
  console.log("saved", out, "height", h, page.logs.filter(l => /ERROR/.test(l)));
} finally { await b.close(); }
