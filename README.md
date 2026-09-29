# Ring Loom

An animated editor for twisting ring patterns: stacks of rings that each turn, squash or tilt a
little more than the last, drawn as additive light. Live at https://ring-loom.vercel.app

- **Base shapes:** circle / squircle, polygon, star, flower, heart, infinity loop.
- **Generators:** how each ring differs from the previous one.
  - *Transform again* - each ring is the previous one squashed and turned (a true repeated matrix).
  - *Sphere spin* - rings rotated about a tilted 3D axis.
  - *Slinky* - rings strung around an orbit.
  - *Harmonograph* - Lissajous loops with a phase drift per ring.
  - *Two-ellipse blend* - interpolates a start ellipse into an end ellipse.
  - *Two Lanes (measured)* - 31 ellipses measured from the Two Lanes "Searching" cover.
- **Randomize** (R) rolls a reproducible look from a seed; **Mutate** (M) nudges the current one.
- **Sequence:** add looks as cards, give each a hold time, a blend time and an easing, and play
  them in a loop. Blends morph every ring point into the next look while both keep animating, so
  generator, base-shape and ring-count changes read as motion. When ring or kaleidoscope counts
  differ, the extra copies split out of their nearest neighbour instead of fading in; the only
  setting that switches outright is Light blend, at the midpoint.
- **Saved sequences:** name a sequence and Save it to a list in this browser, then Load,
  re-save or delete entries. **Save to file** writes `name.ringloom.json` (every look, hold, blend
  and easing) and **Open file** loads one back on any computer; it also accepts a settings code.
  Anything that would replace unsaved changes asks for a second press first.
- Controls that do nothing in the current combination are dimmed, with the reason on hover.
- **Save** a PNG frame, an SVG of the current lines, or a video clip, including exactly one loop
  of the sequence.
- **Settings code** copies the exact look as JSON so it can be pasted back later.

Drag the canvas to orbit the view; double-click resets it. Space plays and pauses.

## Houdini

`houdini/` brings a saved sequence into Houdini as real 3D curves. Open
`examples/ringloom_example.hip`: `/obj/ringloom` plays `examples/example.ringloom.json`, and
`/obj/ringloom_cam` shows it the way the page does.

- **Sequence File:** any `.ringloom.json` from the page (Saved sequences > Save to file), or a saved
  settings code.
- **Look:** 0 plays the whole sequence; 1, 2, ... shows one look, still animating.
- **FPS / Start Frame:** map sequence seconds to frames. The example is frames 1-432 at 24 fps, one
  18 s loop.
- **Points Per Ring, Scale, Render Resolution:** detail, world size, and the square camera
  resolution. Render resolution also converts the page's line width (pixels) into the `width`
  attribute.

The curves carry `Cd`, `Alpha` and `width` per ring. Detail attributes hold the camera settings,
plus `glow`, `trails`, `additive`, `bg` and a `label` naming the look or blend on screen, for use in
a render setup.

The view is baked into the geometry (the page's yaw, pitch, rotation and spin), and the camera sits
on +Z at the page's perspective distance with a focal that reproduces its zoom. You can still
orbit freely in the viewport. Blends happen in 3D: the rings blend, and the view blends separately,
taking the short way round. The page blends flat pictures instead, so the two match exactly only
when both looks share a view.

### Karma render

`/stage` in the example scene renders the rings with Karma XPU at the SOP's Render Resolution
(`/stage/ringloom_render`, frames 1-432, to `$HIP/render/ringloom.$F4.exr`):

- **Material:** `/materials/ringloom_lines` is a MtlX Surface Unlit that emits each curve's colour x
  alpha (`displayColor` x `displayOpacity`) and fully transmits, so overlapping lines add their
  light like the page's light blending instead of hiding each other.
- **Glow:** the `ringloom_glow` Image Filter LOP holds a Glow COP (threshold 0, gaussian) that Karma
  applies during the render. Its size in pixels follows the sequence's glow value.
- **Depth of field is off** in the render settings. The camera's focus still follows its distance
  to the rings, so turning DOF on focuses on them rather than at Houdini's default 5 units.
- **Alpha is 0 everywhere**, because the lines fully transmit. Comp the render with an additive
  (plus) merge over the background rather than an over, or treat it as a black-background plate.
- The page's **trails** aren't reproduced yet.

The render setup lives in the saved example scene; `make_example_hip.py` builds only the importer
and camera.

The engine (`houdini/ringloom_engine.py`) is a port of the page's maths and is checked against it:

```bash
node test/dump-golden.js src/ring-loom.html > golden.json
python houdini/test_parity.py golden.json
```

That compares every parameter default and range, 168 look frames across all generators and base
shapes, blends, and the sequence clock against numbers the page computes itself. After changing
the page's maths, run it, then rebuild the SOP code and the example scene:

```bash
python houdini/build_sop.py
hython houdini/make_example_hip.py
```

`make_example_hip.py` embeds the engine in the Python SOP, so a saved `.hip` works without this
repo. It saves only after checking the SOP's geometry against the engine and the camera against
the page's projection.

### Karma render

The example scene also has a Karma render in `/stage`: `ringloom_scene` imports the curves and
camera, `ringloom_mat` gives them a MaterialX Surface Unlit that emits the curve colour times its
alpha with full transmission (so crossing lines add their light, like the page's light blend),
`ringloom_glow` is an Image Filter with a Glow COP whose size follows the sequence's `glow` value,
and `ringloom_render` writes `examples/render/ringloom.####.exr` at the Render Resolution.

Two things to know. The camera's focus distance is tied to its distance and Karma's depth of field
is off; the camera sits about 42 units back for the page's near-flat view, so a default focus of 5
blurs everything. And because the lines fully transmit, the EXR's alpha is 0: the image is meant
to go over black, as on the page.

This render setup was built in the open scene, not by `make_example_hip.py`, so re-running that
script produces a scene without it.

## Layout

- `src/ring-loom.html` - the page. This is the only file to edit.
- `build.js` - wraps it into a full HTML document at `public/index.html`.
- `vercel.json` - Vercel runs the build on every push and serves `public/`.

The same source also runs as a Claude artifact, which supplies its own `<head>`; that is why the
source has no doctype and `build.js` exists.

```bash
node build.js src/ring-loom.html
node test/check-blend.js src/ring-loom.html
```

`test/check-blend.js` runs the page script under a stub DOM and checks the morph guarantees: a
blend starts exactly on look A and ends exactly on look B, split rings share brightness so nothing
flashes, and no point jumps between neighbouring steps. It also checks saving: files round-trip
exactly, unreadable looks are counted rather than dropped, and blocked or silently dropped browser
storage is reported as a failure instead of an empty list.

## Changing the opening look

The opening look is `START_PARAMS` in `src/ring-loom.html`. Get a new one from the page's
**Settings code -> Copy current** and paste the `params` object in. Returning visitors see their
own last settings instead, which the browser remembers per device.

Seeds reproduce a look only while `randomize()` and the order of `SCHEMA` stay the same: adding or
reordering randomized parameters changes what every seed produces.
