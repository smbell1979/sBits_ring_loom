# ---------- Houdini Python SOP: builds the rings for the current frame ----------
# build_sop.py appends this after ringloom_engine.py, so the engine's functions are in scope and
# the saved .hip needs nothing from this repo.
import os

import hou

node = hou.pwd()
geo = node.geometry()

path = node.evalParm("file").strip()
if not path:
    raise hou.NodeError("Set File to a .ringloom.json sequence (Ring Loom > Saved sequences > Save to file).")
if not os.path.isfile(path):
    raise hou.NodeError("Can't find the sequence file: %s" % path)

# Parse once per file version, not every frame.
key = (path, os.path.getmtime(path))
cached = node.cachedUserData("ringloom")
if not cached or cached[0] != key:
    try:
        with open(path, encoding="utf-8") as fh:
            name, cards, skipped = load_sequence(fh.read(), os.path.splitext(os.path.basename(path))[0])
    except ValueError as err:
        raise hou.NodeError(str(err))
    cached = (key, name, cards, skipped)
    node.setCachedUserData("ringloom", cached)
_, name, cards, skipped = cached
if skipped:
    node.addWarning("%d look(s) in the file couldn't be read and were skipped." % skipped)

look = node.evalParm("look")
if look > len(cards):
    raise hou.NodeError("Look %d doesn't exist: the file has %d looks." % (look, len(cards)))
use = [cards[look - 1]] if look > 0 else cards

fps = node.evalParm("fps")
clock = (hou.frame() - node.evalParm("start_frame")) / fps
ppr = node.evalParm("points_per_ring")
frame, label = evaluate(use, clock, ppr if ppr > 0 else None)

scale = node.evalParm("scale")
res = node.evalParm("render_res")
rings = world_rings(frame)
if not rings:
    raise hou.NodeError("The look has no rings.")

view = frame["view"]
# Line width: the page's pixels at its frame size, as world units at render_res.
px = 1 / (res * 0.44 * view["zoom"]) * scale
width = frame["look"]["width"] * px
# Drawn as dots (the page crossfades lines and dots through a blend; here it is one or the other,
# dots from halfway): points only, no polylines, each ring's last point dropped since it repeats
# the first, with Cd, Alpha and pscale (the page's dot size in pixels) on the points.
dots = frame["look"].get("dots", 0.0) >= 0.5
if dots:
    count = rings[0][0].shape[0] - 1
    pos = np.concatenate([r[0][:-1] for r in rings]) * scale
    geo.createPoints(pos.tolist())
    for name, default in (("Cd", (1.0, 1.0, 1.0)), ("Alpha", 1.0), ("pscale", 0.0)):
        geo.addAttrib(hou.attribType.Point, name, default)
    geo.setPointFloatAttribValues("Cd", [float(v) for r in rings for _ in range(count) for v in r[1]])
    geo.setPointFloatAttribValues("Alpha", [float(r[2]) for r in rings for _ in range(count)])
    geo.setPointFloatAttribValues("pscale", [float(frame["look"]["dot"] * px)] * (count * len(rings)))
else:
    count = rings[0][0].shape[0]
    pos = np.concatenate([r[0] for r in rings]) * scale
    geo.createPoints(pos.tolist())
    geo.createPolygons([tuple(range(i * count, (i + 1) * count)) for i in range(len(rings))], False)
    geo.addAttrib(hou.attribType.Prim, "Cd", (1.0, 1.0, 1.0))
    geo.addAttrib(hou.attribType.Prim, "Alpha", 1.0)
    geo.addAttrib(hou.attribType.Prim, "width", 0.0)
    geo.setPrimFloatAttribValues("Cd", [float(v) for r in rings for v in r[1]])
    geo.setPrimFloatAttribValues("Alpha", [float(r[2]) for r in rings])
    geo.setPrimFloatAttribValues("width", [float(width)] * len(rings))

# Camera settings for the page's view. Perspective strength k is 1 / the camera's distance: a
# camera on +Z at distance 1/k sees the rings the way the page projects them, with the focal
# chosen so the frame shows what the page's zoom shows. At k = 0 (Perspective 0) the page is
# orthographic, and so is the camera: cam_ortho switches it, and its ortho width is the page's
# frame, 1 / (0.44 zoom). Below ORTHO_K (camera past 1000 units, which a blend from an
# orthographic look passes through) the camera stays orthographic too; the page's remaining
# perspective there is under 0.1% of the size.
ORTHO_K = 1e-3
aperture = 41.4214
ortho = view["k"] < ORTHO_K
D = 10.0 if ortho else 1 / view["k"]  # an orthographic camera just needs to sit in front of the rings
details = {
    "cam_ortho": 1.0 if ortho else 0.0,
    "cam_orthowidth": scale / (0.44 * view["zoom"]),
    "cam_distance": D * scale,
    "cam_far": max(10000.0, 4 * D * scale),
    "cam_focal": D * aperture * 0.44 * view["zoom"],
    "cam_aperture": aperture,
    "dots": 1.0 if dots else 0.0,
    "glow": frame["look"]["glow"],
    "trails": frame["look"]["trails"],
    "additive": 1.0 if frame["look"]["additive"] else 0.0,
    "clock": clock,
}
for k, v in details.items():
    geo.addAttrib(hou.attribType.Global, k, 0.0)
    geo.setGlobalAttribValue(k, float(v))
geo.addAttrib(hou.attribType.Global, "bg", (0.0, 0.0, 0.0))
geo.setGlobalAttribValue("bg", tuple(c / 255.0 for c in frame["look"]["bg"]))
geo.addAttrib(hou.attribType.Global, "label", "")
geo.setGlobalAttribValue("label", "%s: %s" % (name, label))
