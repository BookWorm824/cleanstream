r"""Makes the Firefox copy of CleanStream from the same files as the Chrome one (the owner,
2026-11-18: "can we turn our extension to work there also"). Every fix reaches both.

    python tools\make_firefox.py          -> build\firefox\ and build\CleanStream-firefox-<version>.zip
    python tools\make_firefox.py --test   -> build\firefox-test\: the same, but the sites are also
                                             matched on 127.0.0.2-5, for the stand-in pages in
                                             tools\test_firefox.mjs (never handed out)

What differs for Firefox (Firefox 128 or newer, for scripts that run in the page's own world):
- the background part runs as a background script, not a Chrome service worker;
- Firefox needs an add-on id (kept the same forever: updates and saved settings go by it);
- the Windows updater and its icon aren't included: Firefox updates signed add-ons itself.
"""
import json
import shutil
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
ADDON_ID = "cleanstream@bookworm824"
LEAVE_OUT = {"update.cmd"}
# stand-in addresses for the tests: each site's scripts on its own address
TEST_HOSTS = {"www.primevideo.com": "127.0.0.2", "www.netflix.com": "127.0.0.3",
              "www.youtube.com": "127.0.0.4", "www.hulu.com": "127.0.0.5"}


def firefox_manifest(m, test=False):
    m = json.loads(json.dumps(m))
    m["background"] = {"scripts": [m["background"]["service_worker"]]}
    m["browser_specific_settings"] = {"gecko": {"id": ADDON_ID, "strict_min_version": "128.0"}}
    if test:
        for cs in m["content_scripts"]:
            extra = []
            for pat in cs["matches"]:
                for host, ip in TEST_HOSTS.items():
                    if f"://{host}/" in pat:
                        extra.append(pat.replace("https://" + host, "http://" + ip))
            cs["matches"] += [p for p in extra if p not in cs["matches"]]
        m["host_permissions"] += [f"http://{ip}/*" for ip in TEST_HOSTS.values()]
    return m


def build(test=False):
    out = ROOT / "build" / ("firefox-test" if test else "firefox")
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(EXT, out, ignore=lambda d, names: [n for n in names if n in LEAVE_OUT or n.endswith(".ico")])
    m = json.loads((EXT / "manifest.json").read_text(encoding="utf-8"))
    (out / "manifest.json").write_text(json.dumps(firefox_manifest(m, test), indent=2) + "\n", encoding="utf-8")
    if test:
        return out, None
    z = ROOT / "build" / f"CleanStream-firefox-{m['version']}.zip"
    with zipfile.ZipFile(z, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in sorted(out.rglob("*")):
            if f.is_file():
                zf.write(f, f.relative_to(out).as_posix())
    return out, z


if __name__ == "__main__":
    folder, z = build("--test" in sys.argv)
    print("made", folder, "and", z) if z else print("made", folder)
