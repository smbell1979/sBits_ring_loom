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
  - *Two Lanes (measured)* - 31 ellipses measured from the Two Lanes "Searching" cover. The two
    outermost are near-circles whose measured angles were noise, so they follow the fitted trend
    of the rest (otherwise Minor scale or Side flare turned the outer ring 70 degrees off).
- **Randomize** (R) rolls a reproducible look from a seed; **Mutate** (M) nudges the current one.
- **Sequence:** add looks as cards, give each a hold time, a blend time and an easing, and play
  them in a loop. Blends morph every ring point into the next look while both keep animating, so
  generator, base-shape and ring-count changes read as motion. They work in 3D: ring shapes mix
  before the view is applied, and the view mixes as angles (Rotate, yaw and roll the short way
  round, spin as a speed), so a view change between looks is a real turn rather than a flat
  picture squashing through the middle. Perspective and zoom mix for the whole picture.
  Points are matched around each ring: a ring's points are numbered from wherever its generator
  starts, so point-for-point blending can send them across the ring, folding it through itself.
  Each pair of rings is renumbered (a start offset, either way round) for the least travel,
  chosen when the blend begins. On the presets that removed every hard fold (26 pairs had a
  ring shrink past half its size mid-blend; none do now). The ⇄ on a card turns it off for that
  blend, for the twisting fold-through look. When ring or kaleidoscope counts
  differ, the extra copies split out of their nearest neighbour instead of fading in; the only
  setting that switches outright is Light blend, at the midpoint. Colours (rings and background)
  mix in OKLCH, the hue taking the short way round, so opposite colours stay vivid and even in
  brightness mid-blend instead of dipping to a dark grey; colours too vivid for the screen are
  pulled toward grey just enough to fit, which keeps every blend smooth. A change of View roll turns the
  whole picture the short way round. Three per-card settings shape the blend into the next look:
  - **Turns** adds whole extra roll turns (positive counter-clockwise, negative clockwise).
  - **Stagger** (-0.9 to 0.9) blends the rings one after another, so the change ripples through
    them: positive starts with the first ring, negative with the last. The number is how much of
    the blend time the ripple spreads over; each ring still runs its whole morph.
  - **Swirl** (degrees) twists the picture like a whirlpool mid-blend, the middle turning most,
    and unwinds exactly as the look arrives. It is a twist of the whole picture rather than each
    point taking its own arc, because points whose start and end lie opposite each other across
    the centre could pick different ways round and tear a ring apart.
- **Saved sequences:** name a sequence and Save it to a list in this browser, then Load,
  re-save or delete entries. **Save to file** writes `name.ringloom.json` (every look, hold, blend,
  easing, turns, stagger and swirl) and **Open file** loads one back on any computer; it also accepts a settings code.
  Anything that would replace unsaved changes asks for a second press first.
- **Colour preview:** the strip under the Colour menu shows every ring's colour as drawn, first
  ring on the left, from the same colour code the rings use, so the palette, Spread, ring count
  and Custom A/B all show exactly; it moves with Cycle.
- **Ring fade** dims the rings along a ramp: the amount (0 off, 1 fades the far end out), a
  **Fade curve** that works like a gamma (1 straight; above 1 the fade comes late and steep, below
  1 early), and which rings fade: the last, the first, both ends, or the middle. It sets each
  ring's brightness, so it morphs in sequence blends and reaches Houdini as `Alpha`.
- Controls that do nothing in the current combination are dimmed, with the reason on hover.
- **Typed values:** click the number beside any slider to type an exact value, then Enter (or
  click away); Esc cancels, Up/Down nudge by one step (Shift for ten). Values between the slider's
  steps are kept exactly, saved and read by Houdini. Out-of-range values are clamped and counts
  (rings, sides, lobes, kaleidoscope, smoothness, harmonograph frequencies) round to whole
  numbers; the field flashes when it used something other than what was typed.
- **Save** a PNG frame, an SVG of the current lines, or a video clip, including exactly one loop
  of the sequence.
- **Settings code** copies the exact look as JSON so it can be pasted back later.

Drag the canvas to orbit the view, shift-drag to roll it; double-click resets it. Space plays and pauses.

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

The view is baked into the geometry (the page's yaw, pitch, roll, rotation and spin), and the camera sits
on +Z at the page's perspective distance with a focal that reproduces its zoom. You can still
orbit freely in the viewport. Blends work exactly as on the page (both blend in 3D), so the
importer matches the page on every blend, including view changes, turns, stagger and swirl;
perspective and zoom blend on the camera.

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

That compares every parameter default and range, 177 look frames across all generators, base
shapes and view angles (roll included), blends, and the sequence clock against numbers the page
computes itself. After changing the page's maths, run it, then rebuild the SOP code and refresh
the engine inside the example scene:

```bash
python houdini/build_sop.py
hython houdini/update_hip_code.py examples/ringloom_example.hip
```

A saved `.hip` carries its own copy of the engine in the Python SOP, so it works without this repo
but does not pick up changes on its own. `update_hip_code.py` swaps the new code into every Ring
Loom SOP in the scenes you give it and leaves the rest of each scene alone, the render setup
included. It saves a scene only after that scene's SOP output matches the engine mid-way through
a blend between two rolled, tilted looks with an extra roll turn, stagger and swirl. Use it on your own scenes too:

```bash
hython houdini/update_hip_code.py path/to/your_scene.hip
```

`make_example_hip.py` builds the example scene from scratch: the importer and camera only, with no
render setup. It saves only after checking the SOP's geometry against the engine and the camera
against the page's projection.

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
script produces a scene without it. Use `update_hip_code.py` to bring the engine up to date.

## Layout

- `src/ring-loom.html` - the page. This is the only file to edit.
- `build.js` - wraps it into a full HTML document at `public/index.html`.
- `vercel.json` - Vercel runs the build on every push and serves `public/`.
- `tools/set-default.js` - sets what first-time visitors see (below).

The same source also runs as a Claude artifact, which supplies its own `<head>`; that is why the
source has no doctype and `build.js` exists.

```bash
node build.js src/ring-loom.html
node test/check-blend.js src/ring-loom.html
```

`test/check-blend.js` runs the page script under a stub DOM and checks the morph guarantees: a
blend starts exactly on look A and ends exactly on look B, split rings share brightness so nothing
flashes, and no point jumps between neighbouring steps, including blends with extra roll turns,
stagger and swirl (and that turning a finished frame equals rendering it rolled, which the roll
blend relies on). It also checks saving: files round-trip
exactly, unreadable looks are counted rather than dropped, and blocked or silently dropped browser
storage is reported as a failure instead of an empty list.

## Choosing what first-time visitors see

Out of the box, a first visit shows the opening look (`START_PARAMS` in `src/ring-loom.html`)
animating on its own, with a three-look example sequence loaded but not playing. Returning
visitors see their own last settings instead, which the browser remembers per device.

The current default is `default.ringloom.json` in the repo root. To change it, save a sequence
from the page with **To file** (or a single look with **Look file**) over that file, then:

```bash
node tools/set-default.js
node tools/set-default.js --apply
```

The first command is a dry run showing the current and new defaults (or "No change" if the file
is already what's live). Commit `default.ringloom.json` with the page, so history shows which
file each default came from. To use a different file, name it:
`node tools/set-default.js path/to/name.ringloom.json [--apply]`. A sequence of two or more
looks starts playing on the first visit; add `--still` to load it without playing. `--clear` goes
back to the built-in example. Before writing, the script boots the new page as a first-time
visitor and compares what it shows against the file, and stops if any look, setting or value
wouldn't come through exactly. Commit and push to publish; Vercel deploys on push.
Because returning visitors keep their own state, open the page in a private window to see the new
default yourself.

Seeds reproduce a look only while `randomize()` and the order of `SCHEMA` stay the same: adding or
reordering randomized parameters changes what every seed produces. Randomize picks from every
palette, so adding a palette changes the colour a seed number gives (only its colour: the palette
is one random draw). Saved looks, sequences and the default store the palette by name, so they
never change.
