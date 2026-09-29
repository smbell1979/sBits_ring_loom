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
