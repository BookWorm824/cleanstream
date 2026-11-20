// Seals a CleanStream release (0.4.25; the owner, 2026-11-19: every app's updates sealed with its
// own secret key, "label the key so its obvious what it is", "put the keys in a master folder").
//
// The Chrome copy updates itself: "Update CleanStream" (extension/update.cmd) downloads the
// repo's main.zip from GitHub. Since 0.4.25 it only takes a download whose extension/release.sig
// fits the public key written in update.cmd, and whose every file matches its fingerprint in
// extension/release.json. So nobody can send people a fake update, even from inside the GitHub
// account. (The Firefox copy is signed by Mozilla instead, and Firefox checks that itself.)
//
//   node tools/sign_release.mjs              fingerprints from git's staged files, then the seal
//   node tools/sign_release.mjs check        the staged release checks out, as a copy would see it
//   node tools/sign_release.mjs check origin/main     what's on GitHub now
//   node tools/sign_release.mjs new-key      once only: makes the key file (refuses to replace one)
//
// Run it after every other change is staged (git add), as the last step before the commit. It
// works on git's staged copy, which is exactly what GitHub's main.zip will hold, and writes
// release.json and release.sig there and in the working copy. The secret key is read from
// KEY_FILE (or the file named by CLEANSTREAM_SEAL_KEY); it's never printed and never goes in
// the repo. The seal is ECDSA P-256 with SHA-256 (Windows PowerShell 5.1 can check that with
// nothing extra installed; it has no Ed25519).
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY_DIR = path.join(os.homedir(), "App update keys");
const KEY_FILE = process.env.CLEANSTREAM_SEAL_KEY || path.join(KEY_DIR, "CleanStream update key - SECRET.txt");
const LIST = "extension/release.json", SIG = "extension/release.sig";
const SECRET_HEAD = "SECRET KEY (ECDSA P-256, hex):";
const PUBLIC_HEAD = "Public half (it's in CleanStream's update.cmd; safe to share):";

const git = (args, input) => execFileSync("git", ["-C", REPO, ...args], { input, maxBuffer: 1 << 28 });
const blob = (ref, name) => git(["show", `${ref}:${name}`]);
/** The files under extension/ in the index (ref "") or in a commit, without the seal's own two. */
function files(ref) {
  const out = ref === "" ? git(["ls-files", "-s", "--", "extension/"]) : git(["ls-tree", "-r", ref, "--", "extension/"]);
  return out.toString().split("\n").filter(Boolean).map(l => l.split("\t")[1])
    .filter(n => n !== LIST && n !== SIG).sort();
}
const sha256 = b => crypto.createHash("sha256").update(b).digest("hex");
const b64u = b => Buffer.from(b).toString("base64url");

function readKey() {
  if (!fs.existsSync(KEY_FILE)) throw new Error(`No key file at ${KEY_FILE}`);
  const lines = fs.readFileSync(KEY_FILE, "utf8").split(/\r?\n/).map(s => s.trim());
  const after = head => lines[lines.indexOf(head) + 1] || "";
  const d = Buffer.from(after(SECRET_HEAD), "hex");
  if (d.length !== 32) throw new Error("The key file looks damaged (no secret key found).");
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const x = pub.subarray(1, 33), y = pub.subarray(33);
  return crypto.createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(x), y: b64u(y) }, format: "jwk" });
}

/** The public key written in update.cmd (in the index or a commit): "CS_SEAL_X=..." and "_Y". */
function publicKey(ref) {
  const cmd = blob(ref, "extension/update.cmd").toString();
  const get = n => (new RegExp(`\\$${n} = '([A-Za-z0-9+/=]+)'`).exec(cmd) || [])[1];
  const x = get("sealX"), y = get("sealY");
  if (!x || !y) throw new Error("update.cmd has no public key in it.");
  return crypto.createPublicKey({ key: { kty: "EC", crv: "P-256", x: b64u(Buffer.from(x, "base64")), y: b64u(Buffer.from(y, "base64")) }, format: "jwk" });
}

function putStaged(name, data) {
  const id = git(["hash-object", "-w", "--stdin"], data).toString().trim();
  git(["update-index", "--add", "--cacheinfo", `100644,${id},${name}`]);
  fs.writeFileSync(path.join(REPO, name), data);
}

function seal() {
  const key = readKey();
  const version = JSON.parse(blob("", "extension/manifest.json")).version;
  const sums = {};
  for (const name of files("")) sums[name.slice("extension/".length)] = sha256(blob("", name));
  const list = Buffer.from(JSON.stringify({ app: "CleanStream", version, sha256: sums }, null, 1) + "\n");
  const sig = crypto.sign("sha256", list, { key, dsaEncoding: "ieee-p1363" }).toString("base64") + "\n";
  putStaged(LIST, list);
  putStaged(SIG, Buffer.from(sig));
  console.log(`Sealed CleanStream ${version}: ${Object.keys(sums).length} files.`);
  return check("");
}

function check(ref = "") {
  const problems = [];
  let list, sig;
  try { list = blob(ref, LIST); sig = Buffer.from(blob(ref, SIG).toString().trim(), "base64"); }
  catch (e) { console.log("No seal in this release."); return 1; }
  if (!crypto.verify("sha256", list, { key: publicKey(ref), dsaEncoding: "ieee-p1363" }, sig))
    problems.push("the seal doesn't fit the key in update.cmd");
  const info = JSON.parse(list);
  const manifest = JSON.parse(blob(ref, "extension/manifest.json"));
  if (info.version !== manifest.version) problems.push(`sealed ${info.version}, but manifest says ${manifest.version}`);
  const have = files(ref).map(n => n.slice("extension/".length));
  for (const n of have) {
    if (!(n in info.sha256)) problems.push(`not sealed: ${n}`);
    else if (info.sha256[n] !== sha256(blob(ref, "extension/" + n))) problems.push(`changed since sealing: ${n}`);
  }
  for (const n of Object.keys(info.sha256)) if (!have.includes(n)) problems.push(`missing: ${n}`);
  if (problems.length) { console.log("NOT OK:\n  " + problems.join("\n  ")); return 1; }
  console.log(`OK: CleanStream ${info.version} (${ref || "staged"}), ${have.length} files, seal fits.`);
  return 0;
}

function newKey() {
  if (fs.existsSync(KEY_FILE)) throw new Error(`There is already a key at ${KEY_FILE}; it's never replaced.`);
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const pub = ecdh.getPublicKey();
  const x = pub.subarray(1, 33).toString("base64"), y = pub.subarray(33).toString("base64");
  const today = new Date().toISOString().slice(0, 10);
  const version = JSON.parse(fs.readFileSync(path.join(REPO, "extension/manifest.json"), "utf8")).version;
  const text = `CLEANSTREAM UPDATE KEY  -  SECRET, DO NOT SHARE

What this is: the secret key that seals every CleanStream update. The Chrome copy of
CleanStream ("Update CleanStream") only installs an update that carries this seal, so nobody
else can send an update to the people using CleanStream, even if they get into the GitHub
account. (The Firefox copy is signed by Mozilla instead; this key isn't used for it.)

Keep it secret: anyone with this key could seal an update. Don't email it, post it,
or put it on GitHub.

If it's lost: the Chrome copy of CleanStream can't be updated any more. Everyone would need
to install CleanStream again from a new download with a new key. So keep both copies:
  - on the owner's PC: ${KEY_DIR}
  - Google Drive: Cleaning up > App update keys

Made ${today} for CleanStream ${version}, with tools/sign_release.mjs.

${PUBLIC_HEAD}
X ${x}
Y ${y}

${SECRET_HEAD}
${ecdh.getPrivateKey().toString("hex")}
`;
  fs.mkdirSync(KEY_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, text, { flag: "wx" });
  console.log(`Made ${KEY_FILE}\nPut this public half in extension/update.cmd:\n  $sealX = '${x}'\n  $sealY = '${y}'`);
  return 0;
}

const [cmd, arg] = process.argv.slice(2);
try {
  process.exitCode = cmd === "new-key" ? newKey() : cmd === "check" ? check(arg || "") : seal();
} catch (e) { console.log(e.message); process.exitCode = 1; }
