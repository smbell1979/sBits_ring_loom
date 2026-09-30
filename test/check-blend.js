// Runs the page script under a stub DOM and checks the sequence-blend guarantees:
//   node test/check-blend.js src/ring-loom.html
// Exits non-zero on the first failed check, so a broken morph is loud rather than subtle.
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const hook = "function draw() { renderFrame(currentFrame()); }";
if (!js.includes(hook)) { console.error("FAIL: draw() hook line not found; update this test"); process.exit(1); }
// Getters, not values: the hook line sits above some of these declarations, so reading them
// eagerly would hit the temporal dead zone. By the time the checks run, all exist.
const exposed = ["computeFrame", "blendFrames", "pairUp", "morphFrame", "rollFrame", "rollBetween", "rotBetween", "blendStartTau", "ringMatches", "look3d", "ringProgress", "cleanCard", "seqAt", "seq", "EASES", "defaults", "PRESETS", "START_PARAMS", "cleanParams",
  "readLibrary", "writeLibrary", "libraryUpsert", "parseSequenceFile", "sequenceFileData", "cardsForSave", "makeCard", "seqDirty", "seqKey",
  "lookFileData", "readLookFile", "params", "fmt", "readTyped", "BY_ID", "rgbToOklab", "oklabToRgb", "oklabToLinear", "mixColour", "hexToRgb",
  "historyPush", "favouritesAdd", "shelfEntry", "parseFavouritesFile", "applyParams", "hist", "randomize"];
js = js.replace(hook, hook + "\nglobalThis.__t = {" + exposed.map(n => `get ${n}() { return ${n}; }`).join(", ") + "};");

// In-memory localStorage whose behaviour the library tests can switch: normal, throwing
// (private window / blocked data) or silently dropping writes (full storage on some browsers).
const mem = new Map();
let storageMode = "ok";
const storage = {
  getItem: k => { if (storageMode === "throw") throw new Error("blocked"); return mem.has(k) ? mem.get(k) : null; },
  setItem: (k, v) => { if (storageMode === "throw") throw new Error("blocked"); if (storageMode !== "drop") mem.set(k, String(v)); },
};

const stub = () => new Proxy(function () {}, {
  get: (t, k) => {
    if (k === Symbol.toPrimitive) return () => 1;
    if (k === "then") return undefined;
    if (k === "width" || k === "height") return 112;
    if (k === "getBoundingClientRect") return () => ({ width: 800, height: 600 });
    if (k === "filter") return "blur(2px)";
    if (k === "children") return [];
    return stub();
  },
  set: () => true, apply: () => stub(), construct: () => stub(),
});
let frames = 0;
const g = {
  document: stub(), matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
  ResizeObserver: class { observe() {} }, Path2D: class { moveTo() {} lineTo() {} },
  requestAnimationFrame: fn => { if (frames++ < 3) setTimeout(() => fn(frames * 16), 0); },
  performance: { now: () => 0 }, localStorage: storage,
  navigator: {}, addEventListener() {}, setTimeout, clearTimeout, setInterval, clearInterval, console,
};
g.window = g;
new Function(...Object.keys(g), js)(...Object.values(g));

const D2R = Math.PI / 180;
// Largest distance from any point of one ring to the nearest point of the other, taken both ways:
// 0 when they are the same curve, however each is numbered.
function curveGap(p, q) {
  const one = (a, b) => { let w = 0; for (let j = 0; j < a.length; j += 2) { let m = Infinity; for (let k = 0; k < b.length; k += 2) m = Math.min(m, Math.hypot(a[j] - b[k], a[j + 1] - b[k + 1])); w = Math.max(w, m); } return w; };
  return Math.max(one(p, q), one(q, p));
}
let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) failed = true; };

setTimeout(() => {
  const t = globalThis.__t;
  check("page script loads and draws", frames >= 3, `${Math.min(frames, 3)} frames`);
  const look = name => Object.assign(t.defaults(), t.PRESETS[name]);
  const A = t.cleanParams(t.START_PARAMS);           // cover, 19 rings, 1 copy
  const B = look("Petal bloom");                      // blend generator, 54 rings, 6 kaleidoscope copies, wobble
  const M = 360, size = 600, time = 4.2;
  const fa = t.computeFrame(A, time, size, M), fb = t.computeFrame(B, time, size, M);
  check("test looks differ in ring count and copies", fa.rings.length !== fb.rings.length && fa.look.copies.length !== fb.look.copies.length,
    `${fa.rings.length}->${fb.rings.length} rings, ${fa.look.copies.length}->${fb.look.copies.length} copies`);

  // t = 0 must be look A exactly: every output ring sits on its A ring, and the rings sharing one
  // A ring carry a total brightness of exactly 1 (no flash of doubled lines).
  // Blends go through the page's real path: both looks in 3D, mixed, then projected.
  const blendAt = (u, how) => t.morphFrame(A, B, time, size, M, u, how);
  const f0 = blendAt(0), R = t.pairUp(fa.rings.length, fb.rings.length);
  let err0 = 0; const shareA = new Array(fa.rings.length).fill(0);
  f0.rings.forEach((r, i) => {
    const a = fa.rings[R.ia[i]];
    for (let j = 0; j < r.pts.length; j++) err0 = Math.max(err0, Math.abs(r.pts[j] - a.pts[j]));
    shareA[R.ia[i]] += r.w;
  });
  check("t=0 points equal look A", err0 < 1e-3, `max ${err0.toExponential(2)} px`);
  check("t=0 brightness per A ring sums to 1", shareA.every(s => Math.abs(s - 1) < 1e-9), `range ${Math.min(...shareA).toFixed(6)}..${Math.max(...shareA).toFixed(6)}`);
  const cw0 = f0.look.copies.reduce((s, c) => s + c.w, 0);
  check("t=0 kaleidoscope weight sums to A's copies", Math.abs(cw0 - fa.look.copies.length) < 1e-9, `sum ${cw0}`);

  // t = 1 must be look B exactly. With matched points B's rings may be numbered from another start
  // or the other way round, so compare them as curves: every point of each on the other, both ways.
  const f1 = blendAt(1);
  let err1 = 0;
  f1.rings.forEach((r, i) => { err1 = Math.max(err1, curveGap(r.pts, fb.rings[R.ib[i]].pts)); });
  check("t=1 rings equal look B's", err1 < 1e-3, `max ${err1.toExponential(2)} px`);
  let raw1 = 0;
  const f1raw = blendAt(1, { match: false });
  f1raw.rings.forEach((r, i) => { const b = fb.rings[R.ib[i]]; for (let j = 0; j < r.pts.length; j++) raw1 = Math.max(raw1, Math.abs(r.pts[j] - b.pts[j])); });
  check("t=1 with matching off: points equal look B's, point for point", raw1 < 1e-3, `max ${raw1.toExponential(2)} px`);
  check("t=1 every ring at full brightness", f1.rings.every(r => Math.abs(r.w - 1) < 1e-9));
  const ang1 = f1.look.copies.map(c => c.angle), want1 = fb.look.copies.map(c => c.angle);
  check("t=1 kaleidoscope angles equal B's", ang1.every((a, i) => Math.abs(a - want1[i]) < 1e-9));

  // No pops: the worst move of any point between neighbouring moments must halve when the steps
  // are twice as fine. A jump is a fixed size, so it wouldn't. (Points no longer travel in
  // straight lines when the views differ -- these two looks differ in Rotate, spin, yaw and
  // pitch -- so an "even share of the straight-line travel" bound no longer applies.)
  const stepsOf = (n, how) => { let w = 0, prev = blendAt(0, how); for (let s = 1; s <= n; s++) { const f = blendAt(s / n, how); f.rings.forEach((r, i) => { const q = prev.rings[i]; for (let j = 0; j < r.pts.length; j++) w = Math.max(w, Math.abs(r.pts[j] - q.pts[j])); }); prev = f; } return w; };
  const w200 = stepsOf(200), w400 = stepsOf(400);
  check("no jumps inside a blend", w200 / w400 > 1.8 && w200 / w400 < 2.2, `${w200.toFixed(3)} -> ${w400.toFixed(3)} px, ratio ${(w200 / w400).toFixed(2)}`);

  // ---- views blend in 3D ----
  {
    const base = Object.assign(look("Rolling sphere"), { spin: 0, drift: 0, yaw: 0, pitch: 0, persp: 0.3 });
    const radius = f => Math.max(...f.rings.flatMap(r => Array.from({ length: r.pts.length / 2 }, (_, j) => Math.hypot(r.pts[2 * j], r.pts[2 * j + 1]))));
    const mid = (pa, pb) => t.morphFrame(pa, pb, 0, size, M, 0.5, {});
    const still = t.computeFrame(base, 0, size, M), r0 = radius(still);
    // A 180-degree Rotate change used to collapse the picture to a dot mid-blend; now it turns.
    const rotMid = mid(Object.assign({}, base, { rotate: -90 }), Object.assign({}, base, { rotate: 90 }));
    check("a 180-degree Rotate change turns instead of collapsing to a dot", radius(rotMid) > 0.9 * r0, `mid-blend size ${(radius(rotMid) / r0 * 100).toFixed(0)}% of the look's`);
    // Same shape, views 90 degrees of yaw apart: mid-blend must be the shape rendered at the halfway
    // yaw -- a real turn, checked against the page's own renderer.
    const ya = Object.assign({}, base, { yaw: -45 }), yb = Object.assign({}, base, { yaw: 45 });
    const want = t.computeFrame(Object.assign({}, base, { yaw: 0 }), 0, size, M), got = mid(ya, yb);
    let dy = 0; got.rings.forEach((r, i) => { for (let j = 0; j < r.pts.length; j++) dy = Math.max(dy, Math.abs(r.pts[j] - want.rings[i].pts[j])); });
    check("a yaw change mid-blend is the shape seen from the halfway angle", dy < 1e-3, `max ${dy.toExponential(1)} px`);
    // Different spin speeds: the looks' angles drift apart over time. Late in a long sequence the
    // gap passes 180 degrees; the blend must stay smooth there (the old angle-based mix flipped).
    const sa = Object.assign({}, base, { spin: 20 }), sb = Object.assign({}, base, { spin: -25 });
    const late = 3.7;  // seconds: gap 45 deg/s x 3.7 s = 166.5 deg, and it grows through 180 during the blend
    // The blend began at `late`, as the sequence passes it (tau0).
    const across = n => { let w = 0, prev = t.morphFrame(sa, sb, late, size, M, 0, {}, late); for (let s = 1; s <= n; s++) { const u = s / n, f = t.morphFrame(sa, sb, late + u * 1.0, size, M, u, {}, late); f.rings.forEach((r, i) => { const q = prev.rings[i]; for (let j = 0; j < r.pts.length; j++) w = Math.max(w, Math.abs(r.pts[j] - q.pts[j])); }); prev = f; } return w; };
    const a1 = across(200), a2 = across(400);
    check("different spin speeds blend smoothly while their gap passes 180 degrees", a1 / a2 > 1.8 && a1 / a2 < 2.2, `${a1.toFixed(2)} -> ${a2.toFixed(2)} px, ratio ${(a1 / a2).toFixed(2)}`);
    // How far a blend turns. Beyond each look's own spin, a blend may add at most the short way
    // round (180) plus the looks' drift apart during the blend -- however long the page has been
    // playing. (Mixing spin speeds added spin difference x clock: 30 deg/s x 60 s = 5 extra turns.)
    // Measured on the drawn picture: follow one point of a ring through the blend and add up how
    // far it turns about the centre. (So this works on any version of the page, not only one with
    // this code's helpers.) The two looks differ only in Rotate and spin.
    const flatLook = Object.assign(t.defaults(), { gen: "cover", rings: 3, drift: 0, yaw: 0, pitch: 0, persp: 0, roll: 0, speed: 1 });
    const la = Object.assign({}, flatLook, { rotate: 40, spin: 20 }), lb = Object.assign({}, flatLook, { rotate: -70, spin: -10 });
    const blendSecs = 3, n = 600;
    const turning = start => {
      let total = 0, prev = null;
      for (let s = 0; s <= n; s++) {
        const u = s / n, f = t.morphFrame(la, lb, start + u * blendSecs, size, M, u, {}, start);
        const p = f.rings[0].pts, ang = Math.atan2(-p[1], p[0]) / D2R;
        if (prev !== null) total += ((ang - prev + 540) % 360) - 180;
        prev = ang;
      }
      return Math.abs(total);
    };
    // On its own, a look would turn at most |spin| x blend time; the blend may add at most the
    // short way round plus the two looks' drift apart during it.
    const ownMost = Math.max(Math.abs(la.spin), Math.abs(lb.spin)) * blendSecs;
    const allowed = ownMost + 180 + Math.abs(la.spin - lb.spin) * blendSecs;
    const turned = [0, 7.3, 60, 600].map(turning);
    check("a blend never adds more than the short way round, however long the page has played", turned.every(v => v <= allowed),
      `turned ${turned.map(v => v.toFixed(0)).join(", ")} deg starting at 0 s, 7 s, 1 min, 10 min; allowed ${allowed}`);
    // blendStartTau undoes what the clock gained during the blend so far.
    const card = { ease: "linear", blend: 4 };
    const back = t.blendStartTau(50, card, 1, 2, 0.5);  // gained 4 x integral_0^0.5 (1 + v) dv = 2.5
    check("the clock at a blend's start is worked back correctly", Math.abs(back - 47.5) < 1e-3, `${back.toFixed(4)} (want 47.5)`);
  }

  // ---- matching points around rings ----
  {
    // Folding, measured on the drawn picture: how much each ring shrinks mid-blend compared with its
    // two ends (spread of its points about their centre). A ring folding through itself shrinks a lot.
    const spread = p => { let cx = 0, cy = 0; const n = p.length / 2; for (let j = 0; j < p.length; j += 2) { cx += p[j]; cy += p[j + 1]; } cx /= n; cy /= n; let s = 0; for (let j = 0; j < p.length; j += 2) s += (p[j] - cx) ** 2 + (p[j + 1] - cy) ** 2; return Math.sqrt(s / n); };
    const worstFold = (pa, pb, how) => {
      const a = t.morphFrame(pa, pb, 3.1, size, M, 0, how), m = t.morphFrame(pa, pb, 3.1, size, M, 0.5, how), b = t.morphFrame(pa, pb, 3.1, size, M, 1, how);
      return Math.max(...m.rings.map((r, i) => 1 - spread(r.pts) / ((spread(a.rings[i].pts) + spread(b.rings[i].pts)) / 2)));
    };
    const pairs = [["Petal bloom", "Star weave"], ["Squircle tunnel", "Petal bloom"], ["Breathing cover", "Squircle tunnel"]];
    const folds = pairs.map(([x, y]) => [worstFold(look(x), look(y), { match: false }), worstFold(look(x), look(y), {})]);
    check("matching removes rings folding through themselves mid-blend", folds.every(([off, on]) => off > 0.5 && on < 0.5 && on < off / 2),
      folds.map(([off, on], i) => `${pairs[i].join(" -> ")}: worst shrink ${(off * 100).toFixed(0)}% -> ${(on * 100).toFixed(0)}%`).join("; "));
    // The numbering is chosen when the blend begins and kept while both looks keep animating, so
    // nothing jumps (worst step halves when the steps halve).
    const pa = Object.assign(look("Breathing cover"), { drift: 1.2 }), pb = Object.assign(look("Squircle tunnel"), { drift: 0.8 });
    const moving = n => { let w = 0, prev = t.morphFrame(pa, pb, 10, size, M, 0, {}, 10); for (let s = 1; s <= n; s++) { const u = s / n, f = t.morphFrame(pa, pb, 10 + 3 * u, size, M, u, {}, 10); f.rings.forEach((r, i) => { const q = prev.rings[i]; for (let j = 0; j < r.pts.length; j++) w = Math.max(w, Math.abs(r.pts[j] - q.pts[j])); }); prev = f; } return w; };
    const m1 = moving(150), m2 = moving(300);
    check("matched points don't jump while both looks animate through a blend", m1 / m2 > 1.8 && m1 / m2 < 2.2, `${m1.toFixed(2)} -> ${m2.toFixed(2)} px, ratio ${(m1 / m2).toFixed(2)}`);
    // Nothing to gain, nothing changed: a look blended into itself keeps its numbering.
    const same = look("Star weave");
    check("a look blended into itself keeps its own numbering", t.ringMatches(same, Object.assign({}, same), M, 3.1).every(m => m === null));
  }

  // ---- roll through a blend ----
  const maxDiff = (fx, fy) => { let m = 0; fx.rings.forEach((r, i) => { for (let j = 0; j < r.pts.length; j++) m = Math.max(m, Math.abs(r.pts[j] - fy.rings[i].pts[j])); }); return m; };
  // The whole approach rests on this: rolling a finished frame on screen is the same as rendering
  // it with that roll, even in 3D with perspective. Checked against the page's own renderer.
  const P3 = Object.assign(look("Rolling sphere"), { yaw: 35, pitch: -20, persp: 0.8, roll: 0 });
  const rolled = t.computeFrame(Object.assign({}, P3, { roll: 57 }), time, size, M);
  const turned = t.rollFrame(t.computeFrame(P3, time, size, M), 57);
  check("turning a frame on screen = rendering it with that roll (3D, perspective)", maxDiff(rolled, turned) < 1e-3, `max ${maxDiff(rolled, turned).toExponential(2)} px`);
  // Direction: positive roll is counter-clockwise on screen (screen y points down).
  const flatA = Object.assign({}, A, { roll: 0, mirror: 1 });
  const p0 = t.computeFrame(flatA, 0, size, M).rings[5].pts, p1 = t.computeFrame(Object.assign({}, flatA, { roll: 10 }), 0, size, M).rings[5].pts;
  const turn = Math.atan2(-p1[1], p1[0]) - Math.atan2(-p0[1], p0[0]);
  check("positive roll turns counter-clockwise on screen", Math.abs(((turn / D2R + 540) % 360) - 180 - 10) < 1e-3, `${(turn / D2R).toFixed(3)} deg`);

  const RA = Object.assign({}, A, { roll: 170 }), RB = Object.assign({}, B, { roll: -170 });
  const plainA = t.computeFrame(RA, time, size, M), plainB = t.computeFrame(RB, time, size, M);
  const hows = [
    ["turns 0", { turns: 0 }], ["turns 2", { turns: 2 }], ["turns -3", { turns: -3 }],
    ["stagger 0.6", { stagger: 0.6, ease: "smooth" }], ["stagger -0.9", { stagger: -0.9, ease: "in" }],
    ["swirl 360", { swirl: 360, ease: "smooth" }], ["swirl -720 + stagger 0.5 + turns 1", { swirl: -720, stagger: 0.5, turns: 1, ease: "out" }],
  ];
  for (const [name, how] of hows) {
    const m0 = t.morphFrame(RA, RB, time, size, M, 0, how), m1 = t.morphFrame(RA, RB, time, size, M, 1, how);
    const e0 = Math.max(...m0.rings.map((r, i) => maxDiff({ rings: [r] }, { rings: [plainA.rings[R.ia[i]]] })));
    const e1 = Math.max(...m1.rings.map((r, i) => curveGap(r.pts, plainB.rings[R.ib[i]].pts)));
    check(`${name}: blend starts on A and ends exactly on B`, e0 < 1e-3 && e1 < 1e-3, `start ${e0.toExponential(1)}, end ${e1.toExponential(1)} px`);
  }
  // Continuity for every blend style: halving the step size must halve the worst step between
  // neighbouring moments. A pop or tear is a fixed-size jump, so it would not shrink.
  for (const [name, how] of hows.slice(1)) {
    const worstStep = steps => {
      let w = 0, prev = t.morphFrame(RA, RB, time, size, M, 0, how);
      for (let s = 1; s <= steps; s++) { const f = t.morphFrame(RA, RB, time, size, M, s / steps, how); w = Math.max(w, maxDiff(f, prev)); prev = f; }
      return w;
    };
    const w1 = worstStep(300), w2 = worstStep(600);
    check(`${name}: no jumps (worst step halves when steps double)`, w1 / w2 > 1.7 && w1 / w2 < 2.3, `${w1.toFixed(3)} -> ${w2.toFixed(3)} px, ratio ${(w1 / w2).toFixed(2)}`);
  }
  // Stagger order: part-way through, the leading ring is further along than the trailing one.
  {
    const lin = t.EASES.linear.f, fwd = t.ringProgress(0.4, 10, 0.5, lin), back = t.ringProgress(0.4, 10, -0.5, lin);
    check("stagger + runs first ring first, - runs last ring first", fwd[0] > fwd[9] && back[9] > back[0] && Math.abs(fwd[0] - back[9]) < 1e-12,
      `+: ${fwd[0].toFixed(2)}..${fwd[9].toFixed(2)}, -: ${back[0].toFixed(2)}..${back[9].toFixed(2)}`);
    check("every staggered ring runs the full 0 -> 1", [0.3, 0.9].every(s => t.ringProgress(0, 7, s, lin).every(v => v === 0) && t.ringProgress(1, 7, s, lin).every(v => v === 1)));
    check("stagger is capped below 1 (1 would make rings jump)", t.cleanCard({ params: A, stagger: 1 }).stagger === 0.9 && t.ringProgress(0.5, 5, 5, lin) !== null);
  }
  // Swirl: the middle turns more than the edge, and it is gone at both ends (checked above).
  {
    const one = Object.assign({}, A, { roll: 0, mirror: 1, rings: 2, gen: "cover" });
    const plain = t.computeFrame(one, 0, size, M), sw = t.morphFrame(one, one, 0, size, M, 0.5, { swirl: 90 });
    const ang = (p, q) => { const d = Math.atan2(-q[1], q[0]) - Math.atan2(-p[1], p[0]); return ((d / D2R + 540) % 360) - 180; };
    const pts = plain.rings[0].pts, spts = sw.rings[0].pts;
    const rs = Array.from({ length: pts.length / 2 }, (_, j) => Math.hypot(pts[2 * j], pts[2 * j + 1]) / (0.44 * size));
    const jMin = rs.indexOf(Math.min(...rs)), jMax = rs.indexOf(Math.max(...rs));
    const aMin = ang([pts[2 * jMin], pts[2 * jMin + 1]], [spts[2 * jMin], spts[2 * jMin + 1]]);
    const aMax = ang([pts[2 * jMax], pts[2 * jMax + 1]], [spts[2 * jMax], spts[2 * jMax + 1]]);
    const want = r => 90 / (1 + r * r);
    check("swirl turns each point by the whirlpool angle (more near the middle)",
      Math.abs(aMin - want(rs[jMin])) < 1e-3 && Math.abs(aMax - want(rs[jMax])) < 1e-3 && aMin > aMax,
      `r ${rs[jMin].toFixed(2)}: ${aMin.toFixed(2)} deg, r ${rs[jMax].toFixed(2)}: ${aMax.toFixed(2)} deg`);
  }
  check("170 -> -170 goes the short way (through 180, not 0)", Math.abs(t.rollBetween(170, -170, 0.5, 0) - 180) < 1e-9);
  // Needs the other direction too: "always counter-clockwise" would pass the check above.
  check("-170 -> 170 goes the short way clockwise", Math.abs(t.rollBetween(-170, 170, 0.5, 0) + 180) < 1e-9);
  check("30 -> 10 goes clockwise, not 340 the other way", Math.abs(t.rollBetween(30, 10, 1, 0) - 10) < 1e-9);
  check("+2 turns adds two counter-clockwise turns", Math.abs(t.rollBetween(170, -170, 1, 2) - (170 + 20 + 720)) < 1e-9);
  check("-1 turn goes clockwise the long way", Math.abs(t.rollBetween(170, -170, 1, -1) - (170 + 20 - 360)) < 1e-9);
  // Turns in files: whole numbers only, clamped, and left out of files when 0.
  check("turns read from a file are whole and clamped", t.cleanCard({ params: A, turns: 2.6 }).turns === 3 && t.cleanCard({ params: A, turns: -99 }).turns === -10 && t.cleanCard({ params: A }).turns === 0);

  // ---- colour mixing (OKLCH) ----
  {
    // Reference OKLab values for the sRGB primaries, as published by Björn Ottosson and in the CSS
    // Color 4 spec -- a source independent of this code.
    const refs = [[[255, 255, 255], [1, 0, 0]], [[255, 0, 0], [0.627955, 0.224863, 0.125846]],
      [[0, 255, 0], [0.866440, -0.233888, 0.179498]], [[0, 0, 255], [0.452014, -0.032457, -0.311528]]];
    const refErr = Math.max(...refs.map(([rgb, lab]) => Math.max(...t.rgbToOklab(rgb).map((v, i) => Math.abs(v - lab[i])))));
    check("OKLab conversion matches published reference values", refErr < 1e-5, `max error ${refErr.toExponential(1)}`);
    // The published matrices are rounded to 10 decimals, so the round trip is exact to about 1e-4 of
    // a level: far below one 8-bit step, which is what matters.
    let rt = 0, changed = 0;
    for (let k = 0; k < 4000; k++) {
      const c = [(k * 37) % 256, (k * 91) % 256, (k * 53) % 256], back = t.oklabToRgb(t.rgbToOklab(c));
      rt = Math.max(rt, ...back.map((v, i) => Math.abs(v - c[i])));
      if (back.some((v, i) => Math.round(v) !== c[i])) changed++;
    }
    check("sRGB -> OKLab -> sRGB round trip never changes an 8-bit value", changed === 0 && rt < 1e-3, `max ${rt.toExponential(1)} of a level`);
    const red = t.hexToRgb("#f44e35"), blue = t.hexToRgb("#1670f5");
    check("a colour mix starts and ends on exactly the two colours", JSON.stringify(t.mixColour(red, blue, 0)) === JSON.stringify(red) && JSON.stringify(t.mixColour(red, blue, 1)) === JSON.stringify(blue));
    const LC = c => { const [L, a, b] = t.rgbToOklab(c); return { L, C: Math.hypot(a, b) }; };
    const pairs = [["#f44e35", "#1670f5"], ["#ff8000", "#0040ff"], ["#0000ff", "#ffff00"], ["#ff00ff", "#00c000"], ["#00e5ff", "#ff3d9a"]];
    // Mid-blend chroma: exactly as asked (halfway between the ends), or where the screen can't show
    // that much, at the edge of what it can -- 1% more colour would be undisplayable.
    let chromaOk = true, dip = 0, beatsOld = true;
    const notes = [];
    for (const [x, y] of pairs) {
      const a = t.hexToRgb(x), b = t.hexToRgb(y), mid = t.mixColour(a, b, 0.5), m = LC(mid), ea = LC(a), eb = LC(b);
      const asked = (ea.C + eb.C) / 2, lab = t.rgbToOklab(mid);
      const more = t.oklabToLinear(lab[0], lab[1] * 1.01, lab[2] * 1.01);
      const atLimit = more.some(v => v < -1e-9 || v > 1 + 1e-9);
      if (!(Math.abs(m.C - asked) < 1e-4 || (m.C < asked && atLimit))) chromaOk = false;
      if (m.C <= LC(a.map((v, i) => (v + b[i]) / 2)).C) beatsOld = false;
      dip = Math.max(dip, Math.min(ea.L, eb.L) - m.L);
      notes.push(`${(m.C / asked * 100).toFixed(0)}%`);
    }
    check("mid-blend colour is as colourful as asked, or as the screen can show", chromaOk, `share of the asked chroma: ${notes.join(", ")}`);
    check("every pair is more colourful mid-blend than the old sRGB mix", beatsOld);
    check("mid-blend colours never go darker than both ends", dip <= 1e-9, `worst dip ${dip.toFixed(4)}`);
    const black = [0, 0, 0], mid = t.mixColour(black, red, 0.5), redLab = t.rgbToOklab(red), midLab = t.rgbToOklab(mid);
    const hueDiff = Math.abs(Math.atan2(midLab[2], midLab[1]) - Math.atan2(redLab[2], redLab[1]));
    check("a blend from black keeps the other colour's hue", hueDiff < 1e-6, `${(hueDiff / D2R).toFixed(6)} deg off`);
    let inRange = true;
    for (let s = 1; s < 400; s++) if (!t.mixColour(t.hexToRgb("#00ff66"), t.hexToRgb("#ff00cc"), s / 400).every(v => v >= 0 && v <= 255)) inRange = false;
    check("mixed colours stay displayable, even through very vivid in-between hues", inRange);
    // Smooth, including where the screen's range limits colour. Measured perceptually (OKLab
    // distance per step): the worst step must shrink 4x when steps are 4x finer (a jump would stay),
    // and no moment may run more than 4x the blend's average speed (a visible flick). Pure blue and
    // pure green are corners of the range, where a hue-exact method jumped at the start.
    const dE = (p, q) => { const a = t.rgbToOklab(p), b = t.rgbToOklab(q); return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]); };
    const speed = (ca, cb, n) => { let peak = 0, sum = 0, prev = t.mixColour(ca, cb, 0); for (let s = 1; s <= n; s++) { const c = t.mixColour(ca, cb, s / n), d = dE(prev, c); peak = Math.max(peak, d); sum += d; prev = c; } return { peak, avg: sum / n }; };
    const colourPairs = [[red, blue], ["#0000ff", "#ffff00"], ["#00ff66", "#ff00cc"], ["#ff0000", "#0000ff"], ["#00ff00", "#ff00ff"], ["#c4ff3d", "#ff00d4"]]
      .map(p => p.map(c => typeof c === "string" ? t.hexToRgb(c) : c));
    const smooth = colourPairs.map(([ca, cb]) => { const c = speed(ca, cb, 800), f = speed(ca, cb, 3200); return { shrink: c.peak / f.peak, even: c.peak / c.avg }; });
    check("colour changes smoothly through a blend (no jumps, no flicks)", smooth.every(s => s.shrink > 3.5 && s.even < 4),
      `finer-step shrink ${smooth.map(s => s.shrink.toFixed(1)).join(", ")}; peak/average speed ${smooth.map(s => s.even.toFixed(1)).join(", ")}`);
  }

  // ---- ring fade ----
  {
    const N = 11, base = Object.assign(t.defaults(), { gen: "cover", rings: N });
    const ws = extra => t.computeFrame(Object.assign({}, base, extra), 0, size, 64).rings.map(r => r.w);
    const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-12);
    const u = Array.from({ length: N }, (_, k) => k / (N - 1));
    check("ring fade 0 leaves every ring at full brightness", ws({ fade: 0, fadeCurve: 3, fadeFrom: "middle" }).every(w => w === 1));
    check("fade 1, curve 1, last rings: a straight ramp 1 -> 0", near(ws({ fade: 1, fadeCurve: 1 }), u.map(x => 1 - x)));
    const mid = extra => ws(extra)[5];  // the middle ring, x = 0.5 for "last"
    check("fade curve bends the ramp like a gamma (2: late, 0.5: early)",
      Math.abs(mid({ fade: 1, fadeCurve: 2 }) - 0.75) < 1e-12 && Math.abs(mid({ fade: 1, fadeCurve: 0.5 }) - (1 - Math.SQRT1_2)) < 1e-12,
      `middle ring: curve 2 -> ${mid({ fade: 1, fadeCurve: 2 }).toFixed(3)}, curve 0.5 -> ${mid({ fade: 1, fadeCurve: 0.5 }).toFixed(3)}`);
    check("fade toward first rings is the mirror image", near(ws({ fade: 0.6, fadeFrom: "first" }), ws({ fade: 0.6 }).reverse()));
    const ends = ws({ fade: 0.8, fadeFrom: "ends" }), middle = ws({ fade: 0.8, fadeFrom: "middle" });
    check("both ends: middle ring full, end rings dimmed by the fade amount", ends[5] === 1 && Math.abs(ends[0] - 0.2) < 1e-12 && Math.abs(ends[10] - 0.2) < 1e-12);
    check("middle: end rings full, middle ring dimmed by the fade amount", middle[0] === 1 && middle[10] === 1 && Math.abs(middle[5] - 0.2) < 1e-12);
  }

  // ---- one full turn ----
  {
    // Gap between neighbouring rings: the largest point-for-point distance, ring k to ring k+1, and
    // last to first, measured in 3D before the view (Sphere spin turns rings about a tilted axis,
    // so equal 3D steps look unequal once flattened to the screen). Settings where rings don't
    // shrink, so only the sweep separates them. Units: ring radii, reported x100.
    const gaps = p => {
      const f = t.look3d(Object.assign(t.defaults(), { drift: 0, wobble: 0 }, p), 0, 360);
      const d = (a, b) => { let m = 0; for (let j = 0; j < a.pre.length; j += 3) m = Math.max(m, Math.hypot(a.pre[j] - b.pre[j], a.pre[j + 1] - b.pre[j + 1], a.pre[j + 2] - b.pre[j + 2])); return m * 100; };
      return f.rings.map((r, k) => d(r, f.rings[(k + 1) % f.rings.length]));
    };
    const cases = [
      ["Slinky at 1 turn", { gen: "slinky", loops: 1 }],
      ["Sphere spin at sweep 360", { gen: "sphere", sweep: 360 }],
      ["Transform again, no shrink, one turn over the rings", { gen: "again", squashA: 1, stretchA: 1 }],
      ["Harmonograph, no shrink, phase one cycle over the rings", { gen: "harmono", decay: 0 }],
    ];
    for (const [name, p] of cases) {
      const N = 12;
      // The problem, reproduced with the toggle off: exactly one cycle puts the last ring on the first.
      const off = gaps(Object.assign({ rings: N }, p, p.gen === "again" ? { turn: 360 / (N - 1) } : p.gen === "harmono" ? { phaseStep: 1 / (N - 1) } : {}));
      const results = [N, 7, 31].map(n => { const g = gaps(Object.assign({ rings: n }, p, { closed: true })); return { n, min: Math.min(...g), spread: Math.max(...g) - Math.min(...g) }; });
      const even = results.every(r => r.min > 1 && r.spread < 1e-3 * r.min);
      check(`${name}: off, last ring lands on the first; One full turn spaces them evenly`, off[N - 1] < 1e-6 && even,
        `off: last->first gap ${off[N - 1].toExponential(1)}; on: ${results.map(r => `${r.n} rings, gaps ${r.min.toFixed(1)} (spread ${r.spread.toExponential(1)})`).join("; ")}`);
    }
  }

  // ---- view motion ----
  {
    const base = Object.assign(t.defaults(), { gen: "sphere", rings: 10, drift: 0, spin: 0, yaw: 20, pitch: 10, roll: -15, persp: 0.4 });
    const frameDiff = (fa, fb) => { let m = 0; fa.rings.forEach((r, i) => { for (let j = 0; j < r.pts.length; j++) m = Math.max(m, Math.abs(r.pts[j] - fb.rings[i].pts[j])); }); return m; };
    const at = (extra, time) => t.computeFrame(Object.assign({}, base, extra), time, size, 90);
    // The same as the plain slider set to the moving angle (the page's own still renderer).
    const cases = [
      ["yaw swing +-30 over 4 s, at 1 s (peak)", { yawMode: "swing", yawSwing: 30, yawPeriod: 4 }, 1, { yaw: 50 }],
      ["pitch turn + over 6 s, at 2 s (+120)", { pitchMode: "turn", pitchPeriod: 6 }, 2, { pitch: 130 }],
      ["roll turn - over 5 s, at 1.25 s (-90)", { rollMode: "turnRev", rollPeriod: 5 }, 1.25, { roll: -105 }],
      ["all three at once", { yawMode: "swing", yawSwing: 40, yawPeriod: 8, pitchMode: "turn", pitchPeriod: 12, rollMode: "swing", rollSwing: 20, rollPeriod: 4 }, 2,
        { yaw: 20 + 40 * Math.sin(Math.PI / 2), pitch: 10 + 60, roll: -15 + 20 * Math.sin(Math.PI) }],
    ];
    for (const [name, motion, time, still] of cases) {
      const d = frameDiff(at(motion, time), at(still, time));
      check(`view motion: ${name} draws as the slider at that angle`, d < 1e-3, `${d.toExponential(1)} px`);
    }
    const loop = frameDiff(at({ yawMode: "turn", yawPeriod: 3, pitchMode: "swing", pitchSwing: 50, pitchPeriod: 1.5 }, 0.4),
      at({ yawMode: "turn", yawPeriod: 3, pitchMode: "swing", pitchSwing: 50, pitchPeriod: 1.5 }, 3.4));
    check("view motion repeats exactly after one cycle", loop < 1e-3, `${loop.toExponential(1)} px`);
    check("view motion off draws exactly as before", frameDiff(at({}, 2), at({ yawMode: "off", yawSwing: 99, yawPeriod: 3 }, 2)) === 0);
    // Blending out of a turning look, late in playback: smooth (worst step halves when steps
    // halve) and bounded -- the same path however long the page has played (the spin bug grew).
    const turning = Object.assign({}, base, { rollMode: "turn", rollPeriod: 2, yawMode: "turn", yawPeriod: 5, pitchMode: "turn", pitchPeriod: 7 });
    const still = Object.assign({}, base, { gen: "cover", rings: 12, yaw: -40, pitch: 30 });
    const path = (start, n) => { let w = 0, len = 0, prev = t.morphFrame(turning, still, start, size, 90, 0, {}, start); for (let s = 1; s <= n; s++) { const u = s / n, f = t.morphFrame(turning, still, start + 3 * u, size, 90, u, {}, start); const d = frameDiff(f, prev); w = Math.max(w, d); len += d; prev = f; } return { w, len }; };
    const runs = [0, 61.7, 600.3].map(start => ({ start, a: path(start, 150), b: path(start, 300) }));
    const smooth = runs.every(r => r.a.w / r.b.w > 1.6 && r.a.w / r.b.w < 2.4);
    const lens = runs.map(r => r.b.len), bounded = Math.max(...lens) < 2 * Math.min(...lens);
    check("blending out of turning views: smooth, and no extra turning late in playback", smooth && bounded,
      runs.map(r => `from ${r.start} s: step ratio ${(r.a.w / r.b.w).toFixed(2)}, path ${r.b.len.toFixed(0)} px`).join("; "));
  }

  // ---- orthographic at Perspective 0 ----
  {
    // A slinky seen side-on (the screenshot case): every ring the same height at Perspective 0,
    // however near or far; with perspective the near ones are taller.
    const heights = persp => t.computeFrame(Object.assign(t.defaults(), { gen: "slinky", closed: true, rings: 24, pitch: 90, drift: 0, persp }), 0, size, 180)
      .rings.map(r => { let lo = Infinity, hi = -Infinity; for (let j = 1; j < r.pts.length; j += 2) { lo = Math.min(lo, r.pts[j]); hi = Math.max(hi, r.pts[j]); } return hi - lo; });
    const spread = h => (Math.max(...h) - Math.min(...h)) / Math.max(...h);
    const h0 = heights(0), h5 = heights(0.5);
    check("Perspective 0 is orthographic: near and far rings the same height", spread(h0) < 1e-9 && spread(h5) > 0.01,
      `height spread ${(spread(h0) * 100).toFixed(6)}% at 0, ${(spread(h5) * 100).toFixed(1)}% at 0.5`);
  }

  // ---- loop colours ----
  {
    // Colour step between neighbouring rings, including last -> first (the seam).
    const steps = (p, time = 0) => {
      const f = t.computeFrame(Object.assign(t.defaults(), { gen: "slinky", closed: true, rings: 16, spread: 1 }, p), time, size, 32);
      const c = f.rings.map(r => r.rgb), n = c.length;
      const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const inner = c.slice(0, -1).map((x, i) => d(x, c[i + 1]));
      return { seam: d(c[n - 1], c[0]), largestInner: Math.max(...inner) };
    };
    const rows = [["viridis", {}], ["custom", {}], ["ember", {}], ["spectrum", {}], ["viridis, Cycle 90 at 1.3 s", { cycle: 90 }, 1.3]]
      .map(([name, extra, time]) => {
        const pal = name.split(",")[0];
        return { name, off: steps(Object.assign({ palette: pal }, extra), time), on: steps(Object.assign({ palette: pal, loopColors: true }, extra), time) };
      });
    check("loop colours: no seam where the last ring meets the first (off: a jump)",
      // The "off" half shows the seam exists: for gradient palettes with Cycle at 0. (While Cycle
      // runs, the off-mode seam moves through the ping-pong and is sometimes small.)
      rows.every(r => r.on.seam <= r.on.largestInner * 1.001 + 1e-9) && rows.filter(r => !r.name.startsWith("spectrum") && !r.name.includes("Cycle")).every(r => r.off.seam > 3 * r.off.largestInner),
      rows.map(r => `${r.name}: seam ${r.off.seam.toFixed(0)} -> ${r.on.seam.toFixed(1)} (largest neighbour step ${r.on.largestInner.toFixed(1)})`).join("; "));
  }

  // ---- favourites and history ----
  {
    storageMode = "ok";
    const L = s => t.shelfEntry("L" + s, t.randomize(s));
    // History: newest first, no repeat of the newest, capped at 30.
    let h = [];
    for (let s = 1; s <= 40; s++) h = t.historyPush(h, L(s));
    const again = t.historyPush(h, t.shelfEntry("same", h[0].params));
    check("history keeps the newest 30, newest first, without repeating the newest", h.length === 30 && h[0].name === "L40" && h[29].name === "L11" && again === h);
    // Favourites: no duplicates of the same look.
    const f1 = t.favouritesAdd([], L(7)), f2 = t.favouritesAdd(f1.list, t.shelfEntry("renamed", L(7).params));
    check("a look already in favourites isn't added twice", f1.added && !f2.added && f2.list.length === 1 && f2.dup.name === "L7");
    // Files: favourites round-trip; a look file and a sequence file open as favourites too; entries
    // without settings are counted, not dropped silently.
    const fileText = JSON.stringify({ ringLoom: 1, kind: "favourites", favourites: [{ name: "A", params: L(3).params }, { name: "B", params: L(4).params }, { name: "junk" }] });
    const opened = t.parseFavouritesFile(fileText, "x");
    check("favourites file opens with every look; unreadable ones counted", opened.entries.length === 2 && opened.skipped === 1 && opened.entries[0].name === "A" &&
      JSON.stringify(opened.entries[1].params) === JSON.stringify(t.cleanParams(L(4).params)));
    check("a look file and a sequence file open as favourites", t.parseFavouritesFile(t.lookFileData(), "x").entries.length === 1 && t.parseFavouritesFile(t.sequenceFileData(), "x").entries.length === t.cardsForSave().length);
    check("a file with no looks is refused with a reason", /no looks/.test((() => { try { t.parseFavouritesFile('{"a":1}', "x"); } catch (e) { return e.message; } })() || ""));
    // History records the look being replaced, through the page's own applyParams.
    const before = JSON.stringify(t.cleanParams(t.params));
    t.applyParams(t.randomize(12345));
    const newest = t.hist[0];
    check("replacing the look puts the old one in history", newest && JSON.stringify(newest.params) === before);
    const len = t.hist.length;
    t.applyParams(t.cleanParams(t.params));
    check("re-applying the same look adds nothing", t.hist.length === len);
  }

  // ---- typed values beside the sliders ----
  {
    const S = t.BY_ID, rd = (id, txt) => t.readTyped(S[id], txt);
    check("a precise typed value is kept exactly, not snapped to the slider step", rd("roll", "12.37") === 12.37 && rd("twist", "45.125") === 45.125);
    check("typographic minus, leading + and decimal comma are read", rd("roll", "−30") === -30 && rd("roll", "+7.5") === 7.5 && rd("zoom", "1,25") === 1.25);
    check("text that isn't a number is refused (field reverts)", ["", "-", "abc", "1.2.3", "Infinity", "12deg", "--3"].every(x => rd("roll", x) === null));
    check("out-of-range values are clamped to the slider's range", rd("roll", "400") === 180 && rd("roll", "-1e9") === -180);
    check("counts round to whole numbers", rd("rings", "19.6") === 20 && rd("mirror", "2.4") === 2 && rd("res", "333") === 333);
    check("a precise value is shown in full, not rounded to the step", t.fmt(S.roll, 12.37) === "12.37" && t.fmt(S.roll, 12.5) === "12.5" && t.fmt(S.rings, 20) === "20" && t.fmt(S.zoom, 1) === t.fmt(S.zoom, 1.0));
    // Squareness shows a scale where 0 is the circle; the stored value stays the exponent.
    const sq = S.superexp, near = (a, b) => Math.abs(a - b) < 1e-12;
    check("squareness scale: 0 is the circle (exponent 2), -1 and +1 are the old ends 0.4 and 5",
      near(sq.ui.from(0), 2) && near(sq.ui.to(2), 0) && near(sq.ui.from(1), 5) && near(sq.ui.from(-1), 0.4)
      && [0.4, 0.8, 1.3, 2, 2.7, 4.2, 5].every(n => near(sq.ui.from(sq.ui.to(n)), n)));
    check("squareness field: shows 0.00 for the circle; typing works on the scale and is clamped to it",
      t.fmt(sq, 2) === "0.00" && t.fmt(sq, 5) === "1.00" && near(rd("superexp", "0"), 2) && near(rd("superexp", "1"), 5) && near(rd("superexp", "3"), 5) && near(rd("superexp", "-1"), 0.4),
      `circle shows ${t.fmt(sq, 2)}, exponent 4.2 shows ${t.fmt(sq, 4.2)}, typed 0.5 -> exponent ${rd("superexp", "0.5").toFixed(4)}`);
    check("a precise value survives saving and loading", t.cleanParams({ roll: 12.37, twist: 45.125 }).roll === 12.37 && t.cleanParams({ twist: 45.125 }).twist === 45.125);
  }

  // Sequence clock: hold, then blend, and the last look blends back into the first.
  t.seq.cards = [
    { params: A, hold: 2, blend: 3, ease: "linear" },
    { params: B, hold: 1, blend: 4, ease: "smooth" },
  ];
  const a1 = t.seqAt(1), a2 = t.seqAt(3.5), a3 = t.seqAt(8), a4 = t.seqAt(10);
  check("seqAt holds card 1", a1.i === 0 && a1.u === 0);
  check("seqAt blends 1->2 halfway", a2.i === 0 && a2.j === 1 && Math.abs(a2.u - 0.5) < 1e-9);
  check("seqAt last card blends back to first", a3.i === 1 && a3.j === 0 && Math.abs(a3.u - 0.5) < 1e-9 && Math.abs(a3.e - 0.5) < 1e-9);
  check("seqAt wraps after one loop", a4.i === 0 && a4.u === 0);
  const ends = Object.entries(t.EASES).every(([, e]) => Math.abs(e.f(0)) < 1e-12 && Math.abs(e.f(1) - 1) < 1e-12);
  check("every easing runs 0 -> 1", ends);

  // ---- saving: files and the in-browser library ----
  t.seq.cards = [t.makeCard(A, "First"), t.makeCard(B, "Second")];
  t.seq.cards[0].hold = 1.5; t.seq.cards[1].blend = 7; t.seq.cards[1].ease = "out"; t.seq.cards[1].turns = -2;
  t.seq.cards[0].stagger = -0.35; t.seq.cards[1].swirl = 195;
  t.seq.name = "Round trip";
  const before = JSON.stringify(t.cardsForSave());
  const saved0 = t.cardsForSave()[0], saved1 = t.cardsForSave()[1];
  check("blend extras are saved when set and left out when 0",
    !("turns" in saved0) && !("swirl" in saved0) && saved0.stagger === -0.35 && saved1.turns === -2 && saved1.swirl === 195 && !("stagger" in saved1));
  const parsed = t.parseSequenceFile(t.sequenceFileData(), "fallback");
  const hold = t.seq.cards;
  t.seq.cards = parsed.cards;
  const after = JSON.stringify(t.cardsForSave());
  t.seq.cards = hold;
  check("file round trip keeps every look, time, easing, turns, stagger and swirl", before === after && parsed.name === "Round trip" && parsed.skipped === 0);

  const code = JSON.stringify({ ringLoom: 1, params: A, sequence: t.cardsForSave() });
  check("a pasted settings code opens as a sequence", t.parseSequenceFile(code, "x").cards.length === 2);
  const msg = f => { try { f(); return null; } catch (e) { return e.message; } };
  check("non-JSON file is refused with a reason", /isn't JSON/.test(msg(() => t.parseSequenceFile("not json", "x")) || ""));
  check("JSON without a sequence is refused", /no sequence/.test(msg(() => t.parseSequenceFile('{"a":1}', "x")) || ""));
  const partial = t.parseSequenceFile(JSON.stringify({ sequence: [t.cardsForSave()[0], { junk: true }, null] }), "Partial");
  check("unreadable looks are counted, not silently dropped", partial.cards.length === 1 && partial.skipped === 2, `kept ${partial.cards.length}, skipped ${partial.skipped}`);
  check("a file with no readable looks is refused", /None of the 2 looks/.test(msg(() => t.parseSequenceFile('{"sequence":[1,2]}', "x")) || ""));

  storageMode = "ok"; mem.clear();
  const entry = n => ({ name: n, savedAt: new Date().toISOString(), sequence: t.cardsForSave() });
  let list = t.readLibrary();
  check("empty library reads as []", Array.isArray(list) && list.length === 0);
  check("library write is confirmed", t.writeLibrary(t.libraryUpsert(list, entry("Night drive"))));
  list = t.libraryUpsert(t.readLibrary(), entry("NIGHT DRIVE"));
  t.writeLibrary(list);
  const lib = t.readLibrary();
  check("saving the same name replaces, not duplicates", lib.length === 1 && lib[0].name === "NIGHT DRIVE");
  check("library entry keeps the whole sequence", JSON.stringify(lib[0].sequence) === before);
  storageMode = "throw";
  check("blocked storage reads as unavailable, not empty", t.readLibrary() === null);
  check("blocked storage write reports failure", t.writeLibrary([]) === false);
  storageMode = "drop";
  check("a write the browser silently drops reports failure", t.writeLibrary([entry("Lost")]) === false);
  storageMode = "ok";

  // Look files: one look, reopened exactly, and still readable as a one-look sequence.
  const lookText = t.lookFileData();
  const opened = t.readLookFile(lookText);
  check("look file reopens as the exact look on screen", opened && JSON.stringify(opened.params) === JSON.stringify(t.cleanParams(t.params)));
  check("a sequence file is not mistaken for a look file", t.readLookFile(t.sequenceFileData()) === null);
  const asSeq = t.parseSequenceFile(lookText, "x");
  check("look file also reads as a one-look sequence (Houdini path)", asSeq.cards.length === 1 &&
    JSON.stringify(asSeq.cards[0].params) === JSON.stringify(opened.params));
  if (process.env.LOOK_OUT) fs.writeFileSync(process.env.LOOK_OUT, lookText);

  t.seq.savedKey = t.seqKey();
  const clean = !t.seqDirty();
  t.seq.cards[0].hold = 2.5;
  check("editing a card marks the sequence unsaved", clean && t.seqDirty());

  process.exit(failed ? 1 : 0);
}, 150);
