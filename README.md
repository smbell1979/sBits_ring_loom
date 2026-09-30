# Ring Loom

An animated editor for twisting ring patterns: stacks of rings that each turn, squash or tilt a
little more than the last, drawn as additive light. Live at https://ring-loom.vercel.app

- **Base shapes:** circle / squircle, polygon, star, flower, heart, infinity loop, superformula.
  - *Superformula* - Gielis' formula: Symmetry (repeats round the ring), Pinch, Shape A and B.
    Odd symmetry with Shape A and B unequal is drawn over two turns, the only way it closes
    without a kink.
- **Generators:** how each ring differs from the previous one.
  - *Transform again* - each ring is the previous one squashed and turned (a true repeated matrix).
  - *Sphere spin* - rings rotated about a tilted 3D axis.
  - *Slinky* - rings strung around an orbit.
  - *Harmonograph* - Lissajous loops with a phase drift per ring.
  - *Hopf fibration* - each ring is the fibre over one point of a sphere, stereographically
    projected: exact circles, every pair linked once. Latitude, Latitude spread (0 keeps them on
    one torus) and Turns place the points; the base shape and Wobble are ignored. Latitude stops
    at 150, where the biggest rings are about 3x the frame.
  - *Spirograph* - a pen on a wheel rolling inside or outside each ring (hypo/epitrochoid). Points
    sets the petals, Pen the pen's distance from the wheel centre (0 a circle, 1 sharp cusps, more
    loops), Pen change morphs it from ring to ring. The wheel is always a whole fraction of the ring,
    so every curve closes. Draws its own curves: the base shape is ignored.
  - *Pendulum wave* - rings of the base shape, each swinging about one axis; ring k makes
    Swings + k swings per Period, so they fall out of step into waves and snap back in line at the
    end of every period (a seamless loop of Period seconds at Time speed 1, up to 720). Period's
    slider is logarithmic so the short periods aren't squeezed into its first pixels; the field
    shows seconds. Axis tilt 0 tips them over like gimbals, 90 turns them in the picture. Drift is
    ignored.
  - *Möbius spiral* - the base shape carried along the orbit of one loxodromic Möbius map: rings
    stream out of one pole and spiral into the other. Circles stay exact circles; other shapes
    bend conformally. Spread (how far into the poles), Twist, Ring size; Drift streams the rings
    along the spiral, a seamless loop (pair it with Loop colours). A tight Twist with big rings
    swings a few rings out into huge arcs where they pass the map's pole: the true image.
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
  ring shrink past half its size mid-blend; none do now). The ⇄ on a card turns it on or off for
  that blend; newly added looks start with it off (the twisting fold-through look), while files
  keep what they saved (older files without the setting load with it on). When ring or kaleidoscope counts
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
- **Favourites and History** are tabs beside the Sequence. **★ Add current look** (or **F**) keeps
  what's on screen; click a favourite's picture to load it, **+ Seq** to add it to the sequence,
  rename it in place. History keeps the last 30 looks you moved away from (Randomize, Mutate,
  presets, seeds, loading), newest first, and **★** stars one. Both are kept in this browser;
  Favourites also **Save to file** and **Open** (a favourites, look or sequence file).
- **Saved sequences:** name a sequence and Save it to a list in this browser, then Load,
  re-save or delete entries. **Save to file** writes `name.ringloom.json` (every look, hold, blend,
  easing, turns, stagger and swirl) and **Open file** loads one back on any computer; it also accepts a settings code.
  Anything that would replace unsaved changes asks for a second press first.
- **Colour preview:** the strip under the Colour menu shows every ring's colour as drawn, first
  ring on the left, from the same colour code the rings use, so the palette, Spread, ring count
  and Custom A/B all show exactly; it moves with Cycle. The grey strip under it is each ring's
  brightness from Ring fade.
- **One full turn** (Slinky, Sphere spin, Transform again, Harmonograph): the rings' sweep becomes
  exactly one cycle, spaced evenly by the ring count, so the last ring never lands on the first
  (Turns, Sweep, Turn / ring and Phase / ring space rings first-to-last inclusive, so at exactly
  one cycle the last ring doubled the first). Add rings and the spacing adjusts.
- **Kaleidoscope** copies turn the picture evenly over **Copies over**: a full circle, or a half
  circle for looks that look the same turned 180 degrees (flat, centred rings such as Two Lanes),
  where full-circle copies land on each other (at 2, and half of them at 4 and 6). **Mirror
  copies** adds a left-right reflected twin to each copy, a true kaleidoscope; in a blend that
  turns it on or off the twins turn over like a card.
- **View motion:** yaw, pitch and roll can each **Swing** (a sine back and forth around the slider
  value, ±amount) or **Turn** (continuous, + or −), one cycle per the Seconds set. It runs on the
  animation clock; dragging the view moves the centre it swings around. In sequence blends each
  look's moving angle is mixed the way chosen when the blend began, so turning views never flip or
  whip round mid-blend.
- The top-right corner of the canvas shows the frame rate and the **build** (commit time in UTC and
  id, stamped by `build.js`; a `+` marks a local build with uncommitted changes).
- **Perspective** 0 is orthographic: depth doesn't change size, so near and far rings match. It
  eases into perspective up to 0.3; from there up it is the same as it always was. Blends mix
  perspective strength, so it grows evenly through a blend.
- **Squareness** (circle base) reads 0 for a perfect circle, up to 1 squarer, down to -1 pinched
  toward a diamond and star. Files still store the underlying exponent (2 = circle).
- **Loop colours:** the colours go round the rings and join up, through the palette and back
  (Spectrum: once round the hue wheel), so a closed circle of rings has no seam where the last
  ring's colour meets the first's. Cycle moves them round the loop; Spread isn't used.
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
on +Z at the page's perspective distance with a focal that reproduces its zoom. At Perspective 0
the page is orthographic and the camera switches to orthographic too (`cam_ortho`, with
`cam_orthowidth` matching the zoom); it also stays orthographic for the faint perspective a blend
passes through on its way out of 0 (camera past 1000 units, under 0.1% of the size). Cameras made
before this need the new expressions: `update_hip_code.py` adds them to any camera already reading
`cam_distance`. You can still orbit freely in the viewport. Blends work exactly as on the page (both blend in 3D), so the
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
Hopf fibration, Superformula, Spirograph, Pendulum wave and Möbius spiral were added without
disturbing old seeds: the original draw still picks among the original generators and base shapes,
and a second random stream gives the new ones their fair share (1 in 10 each for generators, 1 in
7 for the base shape) and draws the superformula settings. Measured on 20,000 seeds against the
release before any were added: 56% come out exactly as before; the rest became looks on a new
generator (about 10% each) or a Superformula (5%). Each addition also reshuffles a few seeds among
the earlier new generators (Möbius: 3.5%). Mutate is unchanged for every look on the original
generators; on Pendulum looks it now nudges Period along its log track. New generators or base shapes should follow the same pattern
(`pickKeepingSeeds`, `onBase`).
