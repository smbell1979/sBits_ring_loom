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
- **Save** a PNG frame, an SVG of the current lines, or a short video clip.
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
```

## Changing the opening look

The opening look is `START_PARAMS` in `src/ring-loom.html`. Get a new one from the page's
**Settings code -> Copy current** and paste the `params` object in. Returning visitors see their
own last settings instead, which the browser remembers per device.

Seeds reproduce a look only while `randomize()` and the order of `SCHEMA` stay the same: adding or
reordering randomized parameters changes what every seed produces.
