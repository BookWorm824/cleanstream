"""Copy CleanView's word lists into CleanStream (extension/words_data.js).

CleanStream finds words the way CleanView does. The lists themselves live in CleanView
(cvcore.py, and the short phrase lists in cleanview.py); this reads them from there and
writes them as JavaScript, so a word added to CleanView reaches CleanStream by running:

    "%LOCALAPPDATA%\\CleanView\\venv\\Scripts\\python.exe" tools\\sync_words.py

(CleanView's own Python, which has what cvcore imports.) Then run tools\\check_words.py to
make sure both still find the same words. Nothing in CleanView is changed.
"""
import json
import os
import re
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "extension" / "words_data.js"
CLEANVIEW = Path(os.environ.get("CLEANVIEW_REPO") or
                 HERE.parent.parent / "CleanView Setup" / "cleanview-repo")


def load():
    # keep CleanView's real settings out of the way while its modules are imported
    os.environ["LOCALAPPDATA"] = tempfile.mkdtemp(prefix="cleanstream-sync-")
    sys.path.insert(0, str(CLEANVIEW))
    import cvcore as cl
    import cleanview as engine
    return cl, engine


def pats(lst):
    return [p.pattern if hasattr(p, "pattern") else p for p in lst]


def js_regex(rx):
    """A Python pattern as [source, flags] for new RegExp()."""
    rx = getattr(rx, "rx", rx)                 # cleanview.Listed wraps the pattern
    flags = "i" if rx.flags & re.I else ""
    src = rx.pattern
    if src.startswith("(?i)"):
        src, flags = src[4:], "i"
    return [src, flags]


def build():
    cl, engine = load()
    sets = lambda d: {k: sorted(v) for k, v in d.items()}
    data = {
        "from": "CleanView " + json.loads((CLEANVIEW / "version.json").read_text())["version"],
        "STRONG": cl.STRONG, "MODERATE": cl.MODERATE, "MILD": cl.MILD, "MINCED": cl.MINCED,
        "DEITY_WORDS": cl.DEITY_WORDS, "SAMESEX_WORDS": cl.SAMESEX_WORDS, "RUDE": cl.RUDE,
        "NEVER_FINE": pats(cl.NEVER_FINE), "ALWAYS_REMOVED": pats(cl.ALWAYS_REMOVED),
        "DEITY_PHRASES": [list(p) for p in cl.DEITY_PHRASES],
        "CRUDE_PHRASES": [list(p) for p in cl.CRUDE_PHRASES],
        "RUDE_PHRASES": [list(p) for p in cl.RUDE_PHRASES],
        "REVERENT_BEFORE": sorted(cl.REVERENT_BEFORE), "REVERENT_NEXT": sorted(cl.REVERENT_NEXT),
        "REVERENT_IS": sorted(cl.REVERENT_IS),
        "INNOCENT_NEXT": sets(cl.INNOCENT_NEXT), "INNOCENT_PREV": sets(cl.INNOCENT_PREV),
        "BODY_SLANG": pats(cl.BODY_SLANG), "MILD_SLANG": pats(cl.MILD_SLANG),
        "MINCED_SLANG": pats(cl.MINCED_SLANG),
        "SHUT_UP_SAFE_NEXT": sorted(cl.SHUT_UP_SAFE_NEXT), "BULL_BEFORE": cl.BULL_BEFORE.pattern,
        "BULL_SWEAR_NEXT": sorted(cl.BULL_SWEAR_NEXT), "BULL_NOT_NEXT": sorted(cl.BULL_NOT_NEXT),
        "SQUAT_BEFORE": sorted(cl.SQUAT_BEFORE), "SQUAT_NOT_NEXT": sorted(cl.SQUAT_NOT_NEXT),
        "SUCK_WORDS": sorted(cl.SUCK_WORDS), "SUCK_NOT_NEXT": sorted(cl.SUCK_NOT_NEXT),
        "SUCK_NOT_BEFORE": sorted(cl.SUCK_NOT_BEFORE),
        "SCREW_NOUN_AFTER": sorted(cl.SCREW_NOUN_AFTER), "GAY_HAPPY": sorted(cl.GAY_HAPPY),
        "PHRASE_OBJECTS": sorted(cl.PHRASE_OBJECTS), "NOT_RUDE_NEXT": sorted(cl.NOT_RUDE_NEXT),
        "BLOODY_SWEAR_NEXT": sorted(cl.BLOODY_SWEAR_NEXT),
        "UP_YOURS_NOT_AFTER": sorted(cl.UP_YOURS_NOT_AFTER), "GOD_NOT_OATH": sorted(cl.GOD_NOT_OATH),
        "KNOWS_NOT_OATH": sorted(cl.KNOWS_NOT_OATH), "HELP_NOT_OATH": sorted(cl.HELP_NOT_OATH),
        "MY_GOD_AFTER": sorted(cl.MY_GOD_AFTER), "CALL_YOU": sorted(" ".join(p) for p in cl.CALL_YOU),
        "FREAK_WORDS": sorted(cl.FREAK_WORDS), "LEAD_IN": sorted(cl.LEAD_IN),
        "BLEEPED": cl.BLEEPED, "GROUPS": cl.GROUPS,
        "ABBREVIATIONS": [[p.pattern, full] for p, full in cl.ABBREVIATIONS],
        "SEX_TERMS_3": cl.SEX_TERMS[3],
        # the rules CleanView added 2026-11-14..17 (CleanListen 1.17.44-1.17.57, Black Beauty,
        # Forest Gump, Person of Interest): closed doors, sucking food, faces screwed up, being
        # called a fool or dumb, a jerk as a movement, pussy the cat, the donkey, a faggot of
        # sticks, the booby bird, dazed "stupid", and 'd/'ll/'re/'ve joined on
        "CONTRACTED": list(cl.CONTRACTED),
        "SHUT_UP_CLOSED_PREV": sorted(cl.SHUT_UP_CLOSED_PREV), "SUCK_FOOD": sorted(cl.SUCK_FOOD),
        "SCREW_FACE_WORDS": sorted(cl.SCREW_FACE_WORDS),
        "FOOL_NOUN_PREV": sorted(cl.FOOL_NOUN_PREV), "DUMB_CALLED_PREV": sorted(cl.DUMB_CALLED_PREV),
        "JERK_MOTION_NEXT": sorted(cl.JERK_MOTION_NEXT), "JERK_PERSON_NEXT": sorted(cl.JERK_PERSON_NEXT),
        "JERK_GIVE": sorted(cl.JERK_GIVE), "JERK_CALLED_BEFORE": sorted(cl.JERK_CALLED_BEFORE),
        "PUSSY_WORDS": sorted(cl.PUSSY_WORDS), "PUSSY_CAT_NEXT": sorted(cl.PUSSY_CAT_NEXT),
        "CAT_WORDS": sorted(cl.CAT_WORDS), "PUSSY_INSULT_BEFORE": sorted(cl.PUSSY_INSULT_BEFORE),
        "PUSSY_CAT_REACH": cl.PUSSY_CAT_REACH,
        "ASS_ANIMAL_NEAR": sorted(cl.ASS_ANIMAL_NEAR), "ASS_INSULT_BEFORE": sorted(cl.ASS_INSULT_BEFORE),
        "ASS_BODY_BEFORE": sorted(cl.ASS_BODY_BEFORE), "ASS_ANIMAL_STRONG": sorted(cl.ASS_ANIMAL_STRONG),
        "FAGGOT_WOOD": sorted(cl.FAGGOT_WOOD), "BOOBY_BIRDS": sorted(cl.BOOBY_BIRDS),
        "STUPID_DAZED_NEXT": sorted(cl.STUPID_DAZED_NEXT), "STUPID_DAZED_PREV": sorted(cl.STUPID_DAZED_PREV),
        # the short phrase lists that need no AI (cleanview.LINE_WORDS), and the rules around them
        "LINE_WORDS": {k: js_regex(engine.LINE_WORDS[k]) for k in ("sexref", "casual", "crude")},
        "LIST_WORD_TRIM": js_regex(engine.LIST_WORD_TRIM),
        "STRIPPER_NEXT": sorted(engine.STRIPPER_NEXT),
        "STRIPPER_BEFORE": sorted(engine.STRIPPER_BEFORE),
        "STRIPPER_THINGS": sorted(engine.STRIPPER_THINGS),
        "NAME_CATS": list(engine.NAME_CATS), "NOT_NAME_AFTER": sorted(engine.NOT_NAME_AFTER),
        "SAID_IN_TITLES": sorted(engine.SAID_IN_TITLES),
        "GOD_PRAYER_NEXT": sorted(engine.GOD_PRAYER_NEXT),
    }
    text = ("// Made by tools/sync_words.py from CleanView's word lists. Don't edit by hand:\n"
            "// change the words in CleanView, then run the tool again.\n"
            "globalThis.CV_WORDS = " + json.dumps(data, ensure_ascii=False, indent=0) + ";\n")
    OUT.write_text(text, encoding="utf-8")
    print(f"Wrote {OUT} from {data['from']}")


if __name__ == "__main__":
    build()
