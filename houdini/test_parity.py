"""Check ringloom_engine.py against numbers computed by the web page itself.

    node test/dump-golden.js src/ring-loom.html > golden.json
    python houdini/test_parity.py golden.json

Exits non-zero on any mismatch. Tolerances are rounding-level: the page stores points as float32
and the reference file rounds to 5 decimals, so a correct port lands within about 1e-3 px on a
600 px frame. A porting mistake shows up as whole pixels.
"""
import json
import math
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ringloom_engine as E  # noqa: E402

PX_TOL = 2e-3     # px, point positions
RGB_TOL = 1e-4    # 0-255 colour values
W_TOL = 1e-8      # brightness shares and copy angles


def main(path):
    g = json.load(open(path, encoding="utf-8"))
    size, M = g["size"], g["M"]
    fails = []

    # 1. Schema: same parameters, defaults, ranges and menu options as the page.
    mine = {s[0]: s for s in E.SCHEMA}
    if [s["id"] for s in g["schema"]] != [s[0] for s in E.SCHEMA]:
        fails.append("schema: parameter ids or order differ from the page")
    for s in g["schema"]:
        m = mine.get(s["id"])
        if not m:
            continue
        if m[1] != s["type"] or m[2] != s["def"]:
            fails.append(f"schema {s['id']}: type/default {m[1]}/{m[2]!r} vs page {s['type']}/{s['def']!r}")
        if s["type"] == "range" and (m[3] != s["min"] or m[4] != s["max"]):
            fails.append(f"schema {s['id']}: range {m[3]}..{m[4]} vs page {s['min']}..{s['max']}")
        if s["type"] == "select" and list(m[3]) != s["options"]:
            fails.append(f"schema {s['id']}: options differ from the page")

    def compare(label, frame, ref):
        pts = E.project(frame, size)
        if len(ref["rings"]) != pts.shape[0]:
            fails.append(f"{label}: {pts.shape[0]} rings vs page {len(ref['rings'])}")
            return 0.0
        worst = 0.0
        for k, r in enumerate(ref["rings"]):
            rp = np.array(r["pts"]).reshape(-1, 2)
            if rp.shape != pts[k].shape:
                fails.append(f"{label} ring {k}: {pts[k].shape[0]} points vs page {rp.shape[0]}")
                continue
            worst = max(worst, float(np.max(np.abs(pts[k] - rp))))
            if np.max(np.abs(frame["rgb"][k] - np.array(r["rgb"]))) > RGB_TOL:
                fails.append(f"{label} ring {k}: colour {frame['rgb'][k].round(3).tolist()} vs page {r['rgb']}")
            if abs(frame["w"][k] - r["w"]) > W_TOL:
                fails.append(f"{label} ring {k}: brightness {frame['w'][k]} vs page {r['w']}")
        if worst > PX_TOL:
            fails.append(f"{label}: points off by up to {worst:.4f} px")
        got = frame["copies"]
        if len(got) != len(ref["copies"]) or any(abs(a - b[0]) > W_TOL or abs(w - b[1]) > W_TOL for (a, w), b in zip(got, ref["copies"])):
            fails.append(f"{label}: kaleidoscope copies {got} vs page {ref['copies']}")
        return worst

    # 2. Every look at several moments.
    worst_case = (0.0, "")
    for c in g["cases"]:
        label = f"look '{c['name']}' ({c['params']['gen']}/{c['params']['base']}) at t={c['tau']}"
        w = compare(label, E.look3d(E.clean_params(c["params"]), c["tau"], M), c["frame"])
        worst_case = max(worst_case, (w, label))

    # 3. Blends between flat looks sharing yaw and pitch (where 2D and 3D blending must agree
    #    exactly), including roll changes with extra whole turns.
    for b in g["blends"]:
        A = E.look3d(E.clean_params(b["a"]), b["tau"], M)
        B = E.look3d(E.clean_params(b["b"]), b["tau"], M)
        label = f"blend '{b['name']}' at e={b['e']}"
        w = compare(label, E.blend3d(A, B, b["e"], b.get("turns", 0)), b["frame"])
        worst_case = max(worst_case, (w, label))

    # 4. Sequence clock.
    cards = [E.clean_card(c) for c in g["sequence"]]
    for s in g["seqAt"]:
        got, ref = E.seq_at(cards, s["clock"]), s["at"]
        if (got is None) != (ref is None) or (got and (got["i"], got["j"]) != (ref["i"], ref["j"])) \
                or (got and (abs(got["u"] - ref["u"]) > 1e-9 or abs(got["e"] - ref["e"]) > 1e-9)):
            fails.append(f"seqAt({s['clock']}): {got} vs page {ref}")

    n_rings = sum(len(c["frame"]["rings"]) for c in g["cases"]) + sum(len(b["frame"]["rings"]) for b in g["blends"])
    print(f"checked {len(g['schema'])} parameters, {len(g['cases'])} look frames, {len(g['blends'])} blend frames "
          f"({n_rings} rings), {len(g['seqAt'])} sequence times")
    print(f"worst point error: {worst_case[0]:.2e} px  ({worst_case[1]})")
    if fails:
        print(f"\n{len(fails)} MISMATCHES:")
        for f in fails[:40]:
            print("  " + f)
        if len(fails) > 40:
            print(f"  ... and {len(fails) - 40} more")
        sys.exit(1)
    print("all match the page")


if __name__ == "__main__":
    main(sys.argv[1])
