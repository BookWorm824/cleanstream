"""CleanStream finds exactly the Spanish words CleanView finds (cvlang.py).

Every quoted phrase in CleanView's Spanish tests (and some sentences of our own) goes through
cvlang's norm() and find_language("es") and through CleanStream's esNorm() and
esFindLanguage() (extension/words.js, in Node.js), with every word group ticked and with only
some. Also checks that the language of some lines is told right (CSWords.lineLang). Run with
CleanView's Python:

    "%LOCALAPPDATA%\\CleanView\\venv\\Scripts\\python.exe" tools\\check_spanish.py

Prints the differences, if any; exits 1 when there are some. Changes nothing anywhere.
"""
import json
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXT = HERE.parent / "extension"
CLEANVIEW = Path(os.environ.get("CLEANVIEW_REPO") or
                 HERE.parent.parent / "CleanView Setup" / "cleanview-repo")
TEST_FILES = ["test_spanish.py", "test_language_switch.py", "test_auto_language.py"]
SENTENCES = [
    "¡Cállate, pendejo!", "¿Qué demonios haces?", "Hijo de perra", "Ay, Dios mío", "No seas tonto",
    "Los rayos X del hospital", "Comimos ostras frescas", "Ostras, qué frío", "la hostia sagrada",
    "Vete al infierno", "Ese cabrón me debe dinero", "Coño, qué susto", "Jesús llegó tarde",
    "Me da vergüenza", "Es un folleto", "Mierda, se me olvidó", "Gracias a Dios", "Gilipollas",
]
GROUP_SETS = [["strong", "moderate", "mild", "deity", "minced", "samesex", "rude"],
              ["strong", "moderate"], ["mild", "deity"], ["minced", "rude"], ["samesex"]]
MINE = [["grafi"], ["que", "rollo"]]
# a line, and the language it's told as (None: nothing to go by)
LANGS = [("What the hell are you doing?", "en"), ("¿Qué haces aquí?", "es"),
         ("No sé lo que quieres de mí", "es"), ("Pendejo.", None), ("Okay.", "en"),
         ("Te dije que no, cabrón", "es"), ("I told you, man, it's over", "en"),
         ("Cállate", "es"), ("Mira, el coche no tiene gasolina", "es"),
         ("Shut up and get in the car", "en"), ("Hola, amigo", "es"), ("No.", None)]
JS = r"""
require(process.argv[2] + "/words_data.js"); require(process.argv[2] + "/words.js");
const W = globalThis.CSWords;
const input = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = [];
for (const cats of input.groups) for (const t of input.cases) {
  const words = t.split(/\s+/).filter(Boolean).map(W.esNorm);
  out.push([words, W.esFindLanguage(words, cats, input.mine)]);
}
console.log(JSON.stringify({ out, langs: input.langs.map(W.lineLang) }));
"""


def phrases():
    found = set(SENTENCES)
    for name in TEST_FILES:
        p = CLEANVIEW / "tests" / name
        if p.exists():
            found |= set(re.findall(r'"([^"\\\n]{2,160})"', p.read_text(encoding="utf-8")))
    return sorted(found)


def main():
    os.environ["LOCALAPPDATA"] = tempfile.mkdtemp(prefix="cleanstream-check-")
    sys.path.insert(0, str(CLEANVIEW))
    import cvlang
    cases = phrases()
    script = Path(tempfile.mkdtemp(prefix="cleanstream-js-")) / "check.js"
    script.write_text(JS, encoding="utf-8")
    out = subprocess.run(["node", str(script), str(EXT)], capture_output=True, text=True,
                         encoding="utf-8", input=json.dumps({"cases": cases, "groups": GROUP_SETS,
                                                            "mine": MINE,
                                                            "langs": [t for t, _ in LANGS]}))
    if out.returncode:
        print(out.stderr)
        return 1
    res = json.loads(out.stdout)
    js = res["out"]
    bad, k = 0, 0
    mine = [tuple(m) for m in MINE]
    for cats in GROUP_SETS:
        for text in cases:
            js_words, js_hits = js[k]
            k += 1
            words = [w for w in (cvlang.norm(t, "es") for t in text.split()) if True]
            py = [list(h) for h in cvlang.find_language(words, cats, mine=mine, lang="es")]
            if js_words != words or js_hits != py:
                bad += 1
                if bad <= 30:
                    print(f"DIFFERENT {cats}: {text!r}\n  CleanView: {words} {py}\n"
                          f"  CleanStream: {js_words} {js_hits}")
    for (text, want), got in zip(LANGS, res["langs"]):
        if got != want:
            bad += 1
            print(f"LANGUAGE {text!r}: told as {got}, should be {want}")
    print(f"{len(cases)} Spanish phrases x {len(GROUP_SETS)} word-group choices, {len(LANGS)} lines' "
          f"language: {'all the same' if not bad else f'{bad} different'}")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
