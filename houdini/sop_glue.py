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

count = rings[0][0].shape[0]
pos = np.concatenate([r[0] for r in rings]) * scale
geo.createPoints(pos.tolist())
geo.createPolygons([tuple(range(i * count, (i + 1) * count)) for i in range(len(rings))], False)

view = frame["view"]
# Line width: the page's pixels at its frame size, as world units at render_res.
width = frame["look"]["width"] / (res * 0.44 * view["zoom"]) * scale
geo.addAttrib(hou.attribType.Prim, "Cd", (1.0, 1.0, 1.0))
geo.addAttrib(hou.attribType.Prim, "Alpha", 1.0)
geo.addAttrib(hou.attribType.Prim, "width", 0.0)
geo.setPrimFloatAttribValues("Cd", [float(v) for r in rings for v in r[1]])
geo.setPrimFloatAttribValues("Alpha", [float(r[2]) for r in rings])
geo.setPrimFloatAttribValues("width", [float(width)] * len(rings))

# Camera settings for the page's view: a camera on +Z at distance D sees the rings the way the
# page projects them; focal is chosen so the frame shows what the page's zoom shows.
aperture = 41.4214
details = {
    "cam_distance": view["D"] * scale,
    "cam_focal": view["D"] * aperture * 0.44 * view["zoom"],
    "cam_aperture": aperture,
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
