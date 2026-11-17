// The picture check: NudeNet (the same nudity checker and model file CleanView uses), run
// with onnxruntime-web in a hidden extension page. Gets a still as a small JPEG and answers
// with the scores CleanView keeps for each frame.
const NUDE_CLASSES = ["FEMALE_GENITALIA_COVERED", "FACE_FEMALE", "BUTTOCKS_EXPOSED",
  "FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_BREAST_EXPOSED", "ANUS_EXPOSED",
  "FEET_EXPOSED", "BELLY_COVERED", "FEET_COVERED", "ARMPITS_COVERED", "ARMPITS_EXPOSED",
  "FACE_MALE", "BELLY_EXPOSED", "MALE_GENITALIA_EXPOSED", "ANUS_COVERED",
  "FEMALE_BREAST_COVERED", "BUTTOCKS_COVERED"];
// the classes CleanView keeps (cleanview.KEEP): nudity, then bare skin
const KEEP = ["FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED",
  "BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "MALE_BREAST_EXPOSED", "BELLY_EXPOSED", "ARMPITS_EXPOSED"];
const COLS = KEEP.map(k => NUDE_CLASSES.indexOf(k));
const SIZE = 320;

ort.env.wasm.wasmPaths = chrome.runtime.getURL("ai/");
ort.env.wasm.numThreads = 1;
let session = null, loading = null;
async function model() {
  if (session) return session;
  loading = loading || ort.InferenceSession.create(chrome.runtime.getURL("ai/nudenet-320n.onnx"),
    { executionProviders: ["wasm"] }).then(s => (session = s));
  return loading;
}

const canvas = new OffscreenCanvas(SIZE, SIZE);
const g = canvas.getContext("2d", { willReadFrequently: true });

/** NudeNet's input the way CleanView makes it (cleanview_ai.nudenet_input): padded to a
 *  square at the bottom/right, shrunk to 320, BGR order, 0..1. */
function input(bitmap) {
  const s = SIZE / Math.max(bitmap.width, bitmap.height);
  const w = Math.max(1, Math.round(bitmap.width * s)), h = Math.max(1, Math.round(bitmap.height * s));
  g.fillStyle = "#000"; g.fillRect(0, 0, SIZE, SIZE);
  g.drawImage(bitmap, 0, 0, w, h);
  const px = g.getImageData(0, 0, SIZE, SIZE).data, n = SIZE * SIZE;
  const x = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    x[i] = px[i * 4 + 2] / 255;            // B
    x[n + i] = px[i * 4 + 1] / 255;        // G
    x[2 * n + i] = px[i * 4] / 255;        // R
  }
  return x;
}

async function check(jpeg) {
  const s = await model();
  const blob = await (await fetch(jpeg)).blob();
  const bmp = await createImageBitmap(blob);
  const x = input(bmp);
  bmp.close();
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", x, [1, 3, SIZE, SIZE]) });
  const y = out[s.outputNames[0]];          // [1, 4 + 18, anchors]
  const anchors = y.dims[2], d = y.data;
  // best score per kept class over all anchors (as CleanView: y[:, 4:, :].max(axis=2))
  return COLS.map(c => {
    let best = 0;
    const row = (4 + c) * anchors;
    for (let a = 0; a < anchors; a++) if (d[row + a] > best) best = d[row + a];
    return Math.round(best * 1000) / 1000;
  });
}

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.to !== "offscreen") return;
  if (msg.type === "check") {
    const t0 = performance.now();
    check(msg.jpeg).then(scores => reply({ scores, ms: Math.round(performance.now() - t0) }),
      e => reply({ error: String(e && e.message || e) }));
    return true;
  }
  if (msg.type === "warm") { model().then(() => reply({ ok: true }), e => reply({ error: String(e) })); return true; }
});
