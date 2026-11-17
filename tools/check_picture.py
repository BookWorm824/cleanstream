r"""CleanStream's nudity scores are CleanView's: the same stills through CleanView's own
picture scan code (cleanview_ai.nudenet_input + NudeNet in onnxruntime) and through the
extension (offscreen.js in a hidden browser). Run with CleanView's Python:

    "%LOCALAPPDATA%\CleanView\venv\Scripts\python.exe" tools\check_picture.py VIDEO [VIDEO...]

Takes a few stills from each video (kept in a temporary folder), prints both sets of scores
and the biggest difference. Changes nothing.
"""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CLEANVIEW = Path(os.environ.get("CLEANVIEW_REPO") or HERE.parent.parent / "CleanView Setup" / "cleanview-repo")
KEEP = ["FEMALE_BREAST_EXPOSED", "FEMALE_GENITALIA_EXPOSED", "MALE_GENITALIA_EXPOSED",
        "BUTTOCKS_EXPOSED", "ANUS_EXPOSED", "MALE_BREAST_EXPOSED", "BELLY_EXPOSED", "ARMPITS_EXPOSED"]


def main(videos):
    os.environ["LOCALAPPDATA"] = tempfile.mkdtemp(prefix="cleanstream-pic-")
    real = Path(os.environ["USERPROFILE"]) / "AppData" / "Local" / "CleanView"
    sys.path.insert(0, str(CLEANVIEW))
    import numpy as np
    import onnxruntime as ort
    import cleanview_ai as ai
    import cleanview as engine
    ffmpeg = real / "app" / "bin" / "ffmpeg.exe"
    tmp = Path(tempfile.mkdtemp(prefix="cleanstream-stills-"))
    stills = []
    for n, v in enumerate(videos):
        for k, t in enumerate((60, 240, 600)):
            out = tmp / f"{n}_{k}.jpg"
            subprocess.run([str(ffmpeg), "-v", "error", "-ss", str(t), "-i", v, "-frames:v", "1",
                            "-vf", "scale=320:-2", "-q:v", "3", str(out)], check=False)
            if out.exists():
                stills.append(out)
    model = Path(ai.__file__).parent  # noqa
    sess = ort.InferenceSession(str(engine.nudity_model()), providers=["CPUExecutionProvider"])
    name = sess.get_inputs()[0].name
    cols = [engine.NUDE_CLASSES.index(k) for k in KEEP]
    py = []
    for f in stills:
        # the JPEG decoded by ffmpeg (CleanView reads its frames through ffmpeg too)
        probe = subprocess.run([str(ffmpeg).replace("ffmpeg.exe", "ffprobe.exe"), "-v", "error",
                                "-show_entries", "stream=width,height", "-of", "csv=p=0", str(f)],
                               capture_output=True, text=True).stdout.strip().split(",")
        w, h = int(probe[0]), int(probe[1])
        raw = subprocess.run([str(ffmpeg), "-v", "error", "-i", str(f), "-f", "rawvideo",
                              "-pix_fmt", "rgb24", "-"], capture_output=True).stdout
        rgb = np.frombuffer(raw, np.uint8).reshape(h, w, 3)
        x = ai.nudenet_input(rgb)[None].astype(np.float32)
        y = sess.run(None, {name: x})[0]
        best = y[:, 4:, :].max(axis=2)[0]
        py.append([round(float(best[c]), 3) for c in cols])
    js = json.loads(subprocess.run(["node", str(HERE / "picture_scores.mjs"), *map(str, stills)],
                                   capture_output=True, text=True, check=True).stdout)
    worst = 0.0
    for f, a, b in zip(stills, py, js["scores"]):
        d = max(abs(p - q) for p, q in zip(a, b))
        worst = max(worst, d)
        print(f"{f.name}: CleanView {a}\n{' ' * len(f.name)}  CleanStream {b}  (most apart {d:.3f})")
    print(f"{len(stills)} stills, biggest difference {worst:.3f}; "
          f"about {js['msEach']:.0f} ms a still in the browser")
    return 0 if worst < 0.08 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
