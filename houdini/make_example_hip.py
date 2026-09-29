"""Build examples/ringloom_example.hip headlessly and check it against the engine.

    hython houdini/make_example_hip.py

Creates /obj/ringloom (Python SOP with the engine embedded) and /obj/ringloom_cam, points the SOP
at $HIP/example.ringloom.json, sets the frame range to one sequence loop, then verifies:
  1. the SOP's geometry equals the engine's rings (glue: order, scale, attributes), and
  2. the SOP's camera settings reproduce the page's projection of those rings.
Exits non-zero if either check fails, and saves the .hip only when both pass.
"""
import json
import math
import os
import sys

import hou
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import ringloom_engine as E  # noqa: E402

EXAMPLES = os.path.join(ROOT, "examples")
SEQ_FILE = os.path.join(EXAMPLES, "example.ringloom.json")
HIP = os.path.join(EXAMPLES, "ringloom_example.hip")
FPS = 24

code = open(os.path.join(HERE, "ringloom_sop.py"), encoding="utf-8").read()

hou.hipFile.clear(suppress_save_prompt=True)
hou.hipFile.setName(HIP.replace("\\", "/"))
hou.setFps(FPS)

geo_obj = hou.node("/obj").createNode("geo", "ringloom")
sop = geo_obj.createNode("python", "ringloom_import")
sop.parm("python").set(code)

ptg = sop.parmTemplateGroup()
folder = hou.FolderParmTemplate("ringloom", "Ring Loom", folder_type=hou.folderType.Simple)
folder.addParmTemplate(hou.StringParmTemplate("file", "Sequence File", 1, default_value=("$HIP/example.ringloom.json",),
                       string_type=hou.stringParmType.FileReference, file_type=hou.fileType.Any,
                       help="A .ringloom.json from Ring Loom (Saved sequences > Save to file), or a saved settings code."))
folder.addParmTemplate(hou.IntParmTemplate("look", "Look", 1, default_value=(0,), min=0, max=20,
                       help="0 plays the whole sequence. 1, 2, ... shows just that look, still animating."))
folder.addParmTemplate(hou.FloatParmTemplate("fps", "Seconds Per Frame (FPS)", 1, default_value=(FPS,), min=1, max=120,
                       help="Frames per second of sequence time. Defaults to the scene rate."))
folder.addParmTemplate(hou.IntParmTemplate("start_frame", "Start Frame", 1, default_value=(1,),
                       help="The frame where the sequence clock is 0."))
folder.addParmTemplate(hou.IntParmTemplate("points_per_ring", "Points Per Ring", 1, default_value=(0,), min=0, max=2000,
                       help="0 uses each look's Smoothness from the file."))
folder.addParmTemplate(hou.FloatParmTemplate("scale", "Scale", 1, default_value=(1.0,), min=0.01, max=100,
                       help="World size. At 1 the outer ring has a radius of about 1."))
folder.addParmTemplate(hou.IntParmTemplate("render_res", "Render Resolution", 1, default_value=(1080,), min=64, max=8192,
                       help="Square camera resolution. Also converts the page's line width (pixels) to the width attribute."))
ptg.append(folder)
sop.setParmTemplateGroup(ptg)
sop.parm("fps").setExpression("$FPS")

out = geo_obj.createNode("null", "OUT")
out.setInput(0, sop)
out.setDisplayFlag(True)
out.setRenderFlag(True)
sop.setComment("Ring Loom sequence importer. Engine port of src/ring-loom.html; see houdini/ in the repo.")
sop.setGenericFlag(hou.nodeFlag.DisplayComment, True)
geo_obj.layoutChildren()

cam = hou.node("/obj").createNode("cam", "ringloom_cam")
det = 'detail("/obj/ringloom/OUT", "%s", 0)'
cam.parm("tz").setExpression(det % "cam_distance")
cam.parm("focal").setExpression(det % "cam_focal")
cam.parm("aperture").setExpression(det % "cam_aperture")
cam.parm("resx").setExpression('ch("/obj/ringloom/ringloom_import/render_res")')
cam.parm("resy").setExpression('ch("/obj/ringloom/ringloom_import/render_res")')
cam.setComment("Driven by the ringloom SOP: matches the page's view, perspective and zoom.")
hou.node("/obj").layoutChildren()

name, cards, _ = E.load_sequence(open(SEQ_FILE, encoding="utf-8").read())
total = E.total_length(cards)
last = int(math.ceil(total * FPS))
hou.playbar.setFrameRange(1, last)
hou.playbar.setPlaybackRange(1, last)
hou.setFrame(1)

# ---- checks ----
fails = []
frames = [1, 30, 61, 97, 150, 230, last]
for f in frames:
    hou.setFrame(f)
    geo = out.geometry()
    errs = sop.errors()
    if errs:
        fails.append("frame %d: SOP errors %s" % (f, errs))
        continue
    P = np.array(geo.pointFloatAttribValues("P"), dtype=np.float64).reshape(-1, 3)
    clock = (f - 1) / FPS
    frame, label = E.evaluate(cards, clock)
    rings = E.world_rings(frame)
    want = np.concatenate([r[0] for r in rings])
    if P.shape != want.shape:
        fails.append("frame %d: %s points vs engine %s" % (f, P.shape, want.shape))
        continue
    geo_err = float(np.max(np.abs(P - want)))
    cd = np.array(geo.primFloatAttribValues("Cd")).reshape(-1, 3)
    cd_err = float(np.max(np.abs(cd - np.array([r[1] for r in rings]))))
    if geo_err > 1e-5 or cd_err > 1e-6:
        fails.append("frame %d: geometry off by %.2e, colour by %.2e" % (f, geo_err, cd_err))

    # Camera check: project the SOP's points with the camera's own parameter values and compare
    # with the page's screen projection (engine.project), in pixels at the render resolution.
    res = sop.evalParm("render_res")
    D, F, A = cam.evalParm("tz"), cam.evalParm("focal"), cam.evalParm("aperture")
    first = P[: frame["pre"].shape[0] * frame["pre"].shape[1]]  # first kaleidoscope copy = unrotated rings
    xs = first[:, 0] * (F / A) * res / (D - first[:, 2])
    ys = -first[:, 1] * (F / A) * res / (D - first[:, 2])
    page = E.project(frame, res).reshape(-1, 2)
    cam_err = float(np.max(np.abs(np.stack([xs, ys], axis=1) - page)))
    if cam_err > 1e-3:
        fails.append("frame %d: camera view off from the page by %.4f px" % (f, cam_err))
    print("frame %4d  %-40s rings %4d  geo err %.1e  camera err %.1e px"
          % (f, label[:40], geo.intrinsicValue("primitivecount"), geo_err, cam_err))

if fails:
    print("\nFAILED:")
    for m in fails:
        print("  " + m)
    sys.exit(1)

hou.setFrame(1)
hou.hipFile.save(HIP)
print("\nall checks pass; saved %s (frames 1-%d at %d fps, %.1f s loop)" % (HIP, last, FPS, total))
