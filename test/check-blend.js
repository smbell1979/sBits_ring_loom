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
  "historyPush", "favouritesAdd", "shelfEntry", "parseFavouritesFile", "applyParams", "hist", "randomize",
  "ringPre", "superR", "superShape", "mutate", "loopOf", "loopParts", "mulberry32", "tuneToLoop",
  "favs", "sync", "syncNow", "readTombs", "readLibrary", "writeLibrary", "writeList", "FAV_STORE", "shelfEntry", "favouritesAdd", "applyMerged"];
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
// Sync's server, in memory: the real merge from api/_merge.js behind a fetch stub.
const { mergeLibraries } = require("../api/_merge.js");
const fakeServer = { library: { favourites: [], sequences: [] }, calls: 0, fail: false };
g.fetch = async (url, opts) => {
  fakeServer.calls++;
  if (fakeServer.fail) return { ok: false, status: 503, json: async () => ({ error: "server down" }) };
  const body = JSON.parse(opts.body);
  fakeServer.library = mergeLibraries(fakeServer.library, body);
  return { ok: true, status: 200, json: async () => JSON.parse(JSON.stringify(fakeServer.library)) };
};
g.crypto = { getRandomValues: a => { for (let i = 0; i < a.length; i++) a[i] = Math.floor(Math.random() * 2 ** 32); return a; } };
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

setTimeout(async () => {
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

  // Superformula: the drawn outline must be the formula going exactly round its own period, so
  // there is no kink where the ring closes. Tested against the formula continued past the loop
  // (r(A + d) = r(d)), not against how the page decides; the one-turn version of an odd, lopsided
  // setting must fail that test, or it proves nothing.
  const sf = (m, n1, n2, n3) => Object.assign(t.defaults(), { base: "super", sfM: m, sfN1: n1, sfN2: n2, sfN3: n3 });
  const periodic = (p, A) => [0.05, 0.4, 1.1, 2.3].every(d => Math.abs(t.superR(A + d, p) - t.superR(d, p)) <= 1e-9 * Math.max(1, t.superR(d, p)));
  const sfCases = [sf(6, 1, 7, 8), sf(4, 0.5, 0.5, 4), sf(5, 2, 7, 7), sf(5, 1.2, 4, 11), sf(7, 0.3, 20, 0.2), sf(0, 2, 3, 9), sf(1, 1, 2, 5)];
  const sfBad = sfCases.filter(p => !periodic(p, (t.superShape(p).twice ? 2 : 1) * 2 * Math.PI));
  check("superformula outlines close without a kink (odd and even symmetry)", sfBad.length === 0, sfBad.map(p => `m ${p.sfM} n ${p.sfN1},${p.sfN2},${p.sfN3}`).join("; "));
  check("...and the check catches the kink when an odd lopsided one is drawn in one turn", !periodic(sf(5, 1.2, 4, 11), 2 * Math.PI));
  // Farthest point on the unit circle: measured on the drawn ring (sphere generator, ring 0 at
  // time 0 is the outline unrotated), not from the normalising maximum itself.
  const sfReach = sfCases.map(p => { const o = t.ringPre(0, 5, 720, 0, { p: Object.assign(p, { gen: "sphere", wobble: 0 }) }); let m = 0; for (let j = 0; j < o.length; j += 3) m = Math.max(m, Math.hypot(o[j], o[j + 1], o[j + 2])); return m; });
  check("superformula outlines reach the unit circle", sfReach.every(m => m > 0.99 && m < 1.01), sfReach.map(m => m.toFixed(3)).join(" "));

  // Hopf fibration: every ring must be a true circle (all points on one plane, one distance from
  // the centre of the circle through three of them), and every pair of rings linked exactly once
  // (each ring crosses the disc spanned by the other once). Pure geometry on the output points.
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const crs = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const circleOf = pts => {  // circumcircle of the first point and those a third and two thirds round
    const n = pts.length - 1, A = pts[0], B = pts[Math.floor(n / 3)], C = pts[Math.floor(2 * n / 3)];
    const ab = sub(B, A), ac = sub(C, A), nn = crs(ab, ac), d = 2 * dot(nn, nn);
    const w = crs(nn, ab).map(v => v * dot(ac, ac)), v2 = crs(ac, nn).map(v => v * dot(ab, ab));
    const cen = [0, 1, 2].map(i => A[i] + (w[i] + v2[i]) / d), nl = Math.sqrt(dot(nn, nn));
    return { cen, r: Math.sqrt(dot(sub(A, cen), sub(A, cen))), nrm: nn.map(v => v / nl) };
  };
  // Times the closed polyline pts crosses the disc spanned by circle c.
  const discHits = (c, pts) => {
    let hits = 0;
    for (let j = 0; j + 1 < pts.length; j++) {
      const h0 = dot(sub(pts[j], c.cen), c.nrm), h1 = dot(sub(pts[j + 1], c.cen), c.nrm);
      if ((h0 > 0) === (h1 > 0)) continue;
      const s = h0 / (h0 - h1), x = [0, 1, 2].map(i => pts[j][i] + s * (pts[j + 1][i] - pts[j][i]));
      if (Math.sqrt(dot(sub(x, c.cen), sub(x, c.cen))) < c.r) hits++;
    }
    return hits;
  };
  const ringAt = (cx, plane) => [...Array(241).keys()].map(j => { const a = j * 2 * Math.PI / 240; return plane === "xy" ? [cx + Math.cos(a), Math.sin(a), 0] : [cx + Math.cos(a), 0, Math.sin(a)]; });
  const unit = circleOf(ringAt(0, "xy"));
  check("the link test tells linked rings from apart and side-by-side ones",
    discHits(unit, ringAt(1, "xz")) === 1 && discHits(unit, ringAt(3, "xz")) === 0 && discHits(unit, ringAt(2.5, "xy")) === 0);
  const hopfLooks = [["default", {}], ["one torus", { hopfSpread: 0 }], ["wide, 2 turns, t 3.1", { hopfLat: 110, hopfSpread: 80, hopfTurns: 2, time: 3.1 }], ["latitude at the cap", { hopfLat: 150, hopfSpread: 150 }]];
  for (const [name, o] of hopfLooks) {
    const p = Object.assign(t.defaults(), { gen: "hopf", rings: 14, wobble: 0.2 }, o), N = p.rings;
    const rings = [...Array(N).keys()].map(k => { const f = t.ringPre(k, N, 240, o.time || 0, { p }); return [...Array(241).keys()].map(j => [f[3 * j], f[3 * j + 1], f[3 * j + 2]]); });
    const circ = rings.map(circleOf);
    let worst = 0;
    rings.forEach((pts, k) => { const c = circ[k]; for (const q of pts) { const d = sub(q, c.cen); worst = Math.max(worst, Math.abs(Math.sqrt(dot(d, d)) - c.r) / c.r, Math.abs(dot(d, c.nrm)) / c.r); } });
    let unlinked = 0, pairs = 0;
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) {
      if (a === b) continue;
      pairs++;
      if (discHits(circ[a], rings[b]) !== 1) unlinked++;
    }
    check(`Hopf fibres are true circles, each pair linked once (${name})`, worst < 1e-9 && unlinked === 0, `worst off-circle ${worst.toExponential(1)}, ${unlinked} of ${pairs} not linked once`);
  }

  // Spirograph: judged by what rolling a wheel must give, measured on the drawn ring, not by
  // re-deriving the formula: Points outermost tips (radius maxima) round the curve; sharp cusps
  // (the pen stopping dead) exactly when the pen sits on the wheel's rim (Pen 1) and nowhere
  // otherwise; a plain circle at Pen 0; and the largest ring touching the unit circle.
  {
    const spiroRing = (o, k = 0, N = 5) => { const p = Object.assign(t.defaults(), { gen: "spiro", spPenSpread: 0, spTwist: 0, spShrink: 0, drift: 0, wobble: 0 }, o);
      const f = t.ringPre(k, N, 720, 0, { p }); return [...Array(720).keys()].map(j => [f[3 * j], f[3 * j + 1]]); };
    const tips = pts => { const r = pts.map(q => Math.hypot(q[0], q[1])), L = r.length; let c = 0;
      for (let j = 0; j < L; j++) if (r[j] > r[(j + L - 1) % L] + 1e-12 && r[j] >= r[(j + 1) % L]) c++; return c; };
    // A cusp is where the pen reverses: the path turns back by more than 120 degrees at one sample.
    // (With 720 samples every cusp of 3, 5 or 8 points lands on a sample.) An earlier version
    // looked for a near-zero step instead, which missed the sharper cusps of 8 points.
    const cusps = pts => { const L = pts.length; let c = 0;
      for (let j = 0; j < L; j++) {
        const a = pts[(j + L - 1) % L], b = pts[j], d = pts[(j + 1) % L];
        const ux = b[0] - a[0], uy = b[1] - a[1], vx = d[0] - b[0], vy = d[1] - b[1];
        if ((ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy)) < -0.5) c++;
      }
      return c; };
    const bad = [];
    for (const spMode of ["hypo", "epi"]) for (const n of [3, 5, 8]) for (const pen of [0.5, 1, 1.8]) {
      const pts = spiroRing({ spMode, spLobes: n, spPen: pen });
      const tp = tips(pts), cp = cusps(pts), wantCusps = pen === 1 ? n : 0;
      if (tp !== n || cp !== wantCusps) bad.push(`${spMode} ${n} pen ${pen}: ${tp} tips, ${cp} cusps`);
    }
    check("spirograph curves have Points tips, and cusps only with the pen on the rim", bad.length === 0, bad.join("; ") || "both wheels, 3/5/8 points, pen 0.5/1/1.8");
    const circ = spiroRing({ spPen: 0 }).map(q => Math.hypot(q[0], q[1]));
    check("spirograph at Pen 0 is a plain circle", Math.max(...circ) - Math.min(...circ) < 1e-12);
    const reach = o => { let m = 0; for (let k = 0; k < 12; k++) for (const q of spiroRing(Object.assign({ spTwist: 7 }, o), k, 12)) m = Math.max(m, Math.hypot(q[0], q[1])); return m; };
    const reaches = [{}, { spMode: "epi", spPen: 1.4, spPenSpread: -1.5 }, { spLobes: 3, spPen: 0.2, spPenSpread: 2 }].map(reach);
    check("spirograph's largest ring touches the unit circle", reaches.every(m => m > 0.995 && m <= 1 + 1e-9), reaches.map(m => m.toFixed(4)).join(" "));
  }

  // Pendulum wave: each ring's tilt read back from the drawn points (the top of a circle ring
  // tips toward the viewer as it swings about the x axis). Ring k must swing exactly Swings + k
  // times per Period (counted as sign changes of its tilt), reach Swing degrees, and every ring
  // must be back level and in line after a whole period -- and not in between.
  {
    const P = 23, s = 5, amp = 50, N = 9;
    const pw = Object.assign(t.defaults(), { gen: "pendulum", rings: N, pwPeriod: P, pwSwings: s, pwSwing: amp, pwAxis: 0, pwShrink: 0.5, wobble: 0 });
    const tilt = (k, time) => { const f = t.ringPre(k, N, 360, time, { p: pw }), j = 90; return Math.atan2(f[3 * j + 2], f[3 * j + 1]) / D2R; };
    const bad = [];
    for (let k = 0; k < N; k++) {
      let flips = 0, peak = 0, prev = tilt(k, 1e-6);
      for (let i = 1; i < 6000; i++) { const a = tilt(k, P * i / 6000); if ((a > 0) !== (prev > 0)) flips++; prev = a; peak = Math.max(peak, Math.abs(a)); }
      if (flips !== 2 * (s + k) - 1 || Math.abs(peak - amp) > 0.1) bad.push(`ring ${k}: ${flips} flips (want ${2 * (s + k) - 1}), peak ${peak.toFixed(2)}`);
    }
    check("pendulum rings swing Swings + k times per period, Swing degrees each way", bad.length === 0, bad.join("; ") || `${N} rings over one period`);
    const frameAt = time => [...Array(N).keys()].map(k => t.ringPre(k, N, 180, time, { p: pw }));
    const gap = (a, b) => Math.max(...a.map((r, k) => Math.max(...r.map((v, i) => Math.abs(v - b[k][i])))));
    const f0 = frameAt(0);
    check("pendulum rings are back in line after one and two periods, and not in between",
      gap(f0, frameAt(P)) < 1e-9 && gap(f0, frameAt(2 * P)) < 1e-9 && gap(f0, frameAt(P / 3)) > 0.1,
      `after 1: ${gap(f0, frameAt(P)).toExponential(1)}, after 2: ${gap(f0, frameAt(2 * P)).toExponential(1)}, at a third: ${gap(f0, frameAt(P / 3)).toFixed(2)}`);
  }

  // Loxodromic spiral, checked with plain complex arithmetic on the drawn points. The Moebius map
  // taking three points of one ring to the same three points of the next is fitted from those
  // points alone; it must then carry every other point of that ring onto the next ring, be the
  // same map for every consecutive pair, and fix the two poles (+-0.7). Circle rings must come
  // out circles (Moebius maps keep circles circles). And with Drift, the rings must come back to
  // exactly their own places after one full cycle of the spread.
  {
    const cm = (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]];
    const cd = (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; };
    const cs = (a, b) => [a[0] - b[0], a[1] - b[1]];
    // Cross-ratio map sending z1, z2, z3 to 0, 1, infinity, and its inverse.
    const toStd = (z1, z2, z3) => z => cd(cm(cs(z, z1), cs(z2, z3)), cm(cs(z, z3), cs(z2, z1)));
    const fromStd = (w1, w2, w3) => s => { const q = cm(s, cd(cs(w2, w1), cs(w2, w3))); return cd(cs(w1, cm(q, w3)), cs([1, 0], q)); };
    const mobRings = (o, time = 0) => { const p = Object.assign(t.defaults(), { gen: "loxo", rings: 16, wobble: 0, drift: 0 }, o), N = p.rings;
      return [...Array(N).keys()].map(k => { const f = t.ringPre(k, N, 240, time, { p }); return [...Array(240).keys()].map(j => [f[3 * j], f[3 * j + 1]]); }); };
    const fit = (a, b) => { const A = toStd(a[0], a[80], a[160]), B = fromStd(b[0], b[80], b[160]); return z => B(A(z)); };
    let worstMap = 0, worstSame = 0, worstPole = 0;
    for (const o of [{ base: "star", sides: 5 }, { base: "heart", mbTwist: -2, mbSize: 0.5 }, { mbTwist: 0, mbSpread: 4 }]) {
      const R = mobRings(o), T = fit(R[3], R[4]), Tscale = Math.max(...R.flat().map(q => Math.hypot(q[0], q[1])));
      for (let k = 0; k + 1 < R.length; k++) {
        const Tk = fit(R[k], R[k + 1]);
        for (let j = 0; j < 240; j += 7) {
          const g = Tk(R[k][j]); worstMap = Math.max(worstMap, Math.hypot(g[0] - R[k + 1][j][0], g[1] - R[k + 1][j][1]) / Tscale);
          const h = T(R[k][j]); worstSame = Math.max(worstSame, Math.hypot(h[0] - R[k + 1][j][0], h[1] - R[k + 1][j][1]) / Tscale);
        }
      }
      for (const pole of [[0.7, 0], [-0.7, 0]]) { const f = T(pole); worstPole = Math.max(worstPole, Math.hypot(f[0] - pole[0], f[1] - pole[1])); }
    }
    check("Loxodromic rings are one fixed Möbius map apart, and it fixes the two poles", worstMap < 1e-8 && worstSame < 1e-8 && worstPole < 1e-8,
      `pair fit off ${worstMap.toExponential(1)}, one map for all off ${worstSame.toExponential(1)}, poles moved ${worstPole.toExponential(1)}`);
    let worstCirc = 0;
    for (const r of mobRings({ mbTwist: 1.7, mbSize: 0.45 })) {
      const c = circleOf(r.map(q => [q[0], q[1], 0]));
      for (const q of r) worstCirc = Math.max(worstCirc, Math.abs(Math.hypot(q[0] - c.cen[0], q[1] - c.cen[1]) - c.r) / c.r);
    }
    check("Loxodromic spiral keeps circle rings exact circles", worstCirc < 1e-9, `worst ${worstCirc.toExponential(1)}`);
    const L = 7, d = 0.5, loop = L / (0.25 * d), gap = (a, b) => Math.max(...a.map((r, k) => Math.max(...r.map((q, j) => Math.hypot(q[0] - b[k][j][0], q[1] - b[k][j][1])))));
    const at = time => mobRings({ base: "star", mbSpread: L, drift: d }, time), m0 = at(0);
    check("Loxodromic rings stream along the spiral and are back in place after one cycle",
      gap(m0, at(loop)) < 1e-9 && gap(m0, at(loop / 3)) > 0.01, `after a cycle ${gap(m0, at(loop)).toExponential(1)}, a third of the way ${gap(m0, at(loop / 3)).toFixed(3)}`);
  }

  // Loxodromic spiral fade and wrap, from look3d's drawn rings and weights. (1) Streaming, a ring leaving at
  // one pole reappears at the other: every such jump (seen as the ring's points moving far in one
  // small time step) must happen while the ring is invisible -- the pop Scott saw -- and jumps must
  // actually occur, or the check proves nothing. (2) The fade is where a ring is, not which ring:
  // one ring slot later, the picture, weights included, is the same set of rings as before (with
  // the fade by ring number it moved one ring along each slot).
  {
    const base = { gen: "loxo", rings: 12, mbSpread: 4, drift: 0.8, mbSize: 0.45 };
    let jumps = 0, worstVisible = 0;
    for (const extra of [{ fade: 0 }, { fade: 0.9, fadeFrom: "ends", fadeCurve: 1.5 }, { fade: 0.7, fadeFrom: "first" }]) {
      const p = Object.assign(t.defaults(), base, extra);
      const dt = 0.01, slot = p.mbSpread / p.rings / (0.25 * p.drift);
      let prev = t.look3d(p, 0, 90);
      for (let time = dt; time < 2 * slot * p.rings / 3; time += dt) {
        const cur = t.look3d(p, time, 90);
        cur.rings.forEach((r, k) => {
          const a = prev.rings[k].pre, b = r.pre;
          let move = 0; for (let i = 0; i < a.length; i++) move = Math.max(move, Math.abs(a[i] - b[i]));
          if (move > 0.3) { jumps++; worstVisible = Math.max(worstVisible, prev.rings[k].w, r.w); }
        });
        prev = cur;
      }
    }
    check("Loxodromic rings wrap from pole to pole only while invisible (no pop)", jumps > 0 && worstVisible < 0.05,
      `${jumps} wraps seen, brightest at the moment of wrapping ${worstVisible.toFixed(3)}`);
    const p = Object.assign(t.defaults(), base, { fade: 0.85, fadeFrom: "ends", fadeCurve: 1.3 });
    const slot = p.mbSpread / p.rings / (0.25 * p.drift);
    const key = f => f.rings.map(r => ({ w: r.w, x: r.pre[0], y: r.pre[1] })).sort((a, b) => a.x - b.x || a.y - b.y);
    let worst = 0;
    for (const time of [0.37, 1.9, 4.4]) {
      const A = key(t.look3d(p, time, 60)), B = key(t.look3d(p, time + slot, 60));
      A.forEach((r, i) => { worst = Math.max(worst, Math.abs(r.w - B[i].w), Math.abs(r.x - B[i].x), Math.abs(r.y - B[i].y)); });
    }
    check("Möbius ring fade follows the place along the spiral, not the ring", worst < 1e-9, `one slot later, rings and weights off by ${worst.toExponential(1)}`);
  }

  // Moebius strip, measured on the drawn rings. Each ring's long axis is found from its points (the
  // two farthest apart), and its angle measured in the ring's own plane against the outward
  // direction (from the ring's centre); unwrapped round the loop and closed back onto the first
  // ring, the axis must turn exactly Half twists x 180 degrees -- for 1, it comes back reversed:
  // one side. Every ring must lie square across the loop (no point off the plane through its
  // centre and the loop's axis). And with Drift, one ring slot later the rings are the same set.
  {
    const stripRings = (o, time = 0) => { const p = Object.assign(t.defaults(), { gen: "strip", rings: 36, drift: 0, wobble: 0 }, o), N = p.rings;
      return [...Array(N).keys()].map(k => { const f = t.ringPre(k, N, 120, time, { p }); return [...Array(120).keys()].map(j => [f[3 * j], f[3 * j + 1], f[3 * j + 2]]); }); };
    const measure = R => {
      let total = 0, prev = null, off = 0;
      const angles = R.map(pts => {
        const c = [0, 1, 2].map(i => pts.reduce((a, q) => a + q[i], 0) / pts.length), r = Math.hypot(c[0], c[1]);
        const out = [c[0] / r, c[1] / r], tan = [-out[1], out[0]];
        let best = 0, A = pts[0], B = pts[0];
        for (const a of pts) for (const b of pts) { const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2; if (d > best) { best = d; A = a; B = b; } }
        for (const q of pts) off = Math.max(off, Math.abs((q[0] - c[0]) * tan[0] + (q[1] - c[1]) * tan[1]));
        const v = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
        return Math.atan2(v[2], v[0] * out[0] + v[1] * out[1]);
      });
      for (const a of [...angles, angles[0]]) {  // an axis has no direction: steps are mod 180
        if (prev !== null) { let d = a - prev; d -= Math.PI * Math.round(d / Math.PI); total += d; }
        prev = a;
      }
      return { turn: total / Math.PI, off };
    };
    const bad = [];
    for (const [tw, flat] of [[1, 0.3], [1, 0], [2, 0.3], [3, 0.2], [5, 0.4], [0, 0.3]]) {
      const m = measure(stripRings({ msTwists: tw, msFlat: flat }));
      if (Math.abs(Math.abs(m.turn) - tw) > 1e-6 || m.off > 1e-12) bad.push(`${tw} half twists: axis turned ${m.turn.toFixed(4)} x 180, off plane ${m.off.toExponential(1)}`);
    }
    check("Möbius strip: rings lie across the loop and their long axes turn Half twists x 180 round it", bad.length === 0, bad.join("; ") || "0/1/2/3/5 half twists, flat and thick");
    const gap3 = (a, b) => { let w = 0; for (const q of a) { let m = Infinity; for (const r of b) m = Math.min(m, Math.hypot(q[0] - r[0], q[1] - r[1], q[2] - r[2])); w = Math.max(w, m); } return w; };
    const o = { msTwists: 1, drift: 0.7, rings: 12 }, slot = (2 * Math.PI / 12) / (0.3 * 0.7);
    const A = stripRings(o, 0.9), B = stripRings(o, 0.9 + slot);
    let worst = 0;
    A.forEach(r => { worst = Math.max(worst, Math.min(...B.map(s => Math.max(gap3(r, s), gap3(s, r))))); });
    check("Möbius strip: the rings flow round and one slot later are the same set", worst < 1e-9, `off by ${worst.toExponential(1)}`);
    const old = t.cleanParams({ gen: "mobius", mbTwist: 2.25, mbSize: 0.41 });
    check("a look saved as the old Möbius spiral opens as the Loxodromic spiral, settings kept", old.gen === "loxo" && old.mbTwist === 2.25 && old.mbSize === 0.41, `gen ${old.gen}`);
  }

  // Two-ellipse blend Spacing: no orphaned ring. Gaps between neighbouring rings are measured on
  // the drawn rings (curveGap); the largest must sit beside one nearly as large (within 1.3x),
  // rather than stand alone as the first did below Spacing 1 (10.8x the average, next 2.5x).
  {
    const bad = [];
    for (const ease of [0.3, 0.5, 0.8, 1, 1.5, 3]) {
      const p = Object.assign(t.defaults(), { gen: "blend", rings: 31, ease, drift: 0, wobble: 0, mirror: 1 });
      const R = t.computeFrame(p, 0, 600, 180).rings.map(r => r.pts);
      const g = R.slice(1).map((r, i) => curveGap(R[i], r));
      const i = g.indexOf(Math.max(...g)), nb = Math.max(i > 0 ? g[i - 1] : 0, i + 1 < g.length ? g[i + 1] : 0);
      if (g[i] > 1.3 * nb) bad.push(`spacing ${ease}: gap ${i} is ${g[i].toFixed(1)} px beside ${nb.toFixed(1)}`);
    }
    check("two-ellipse blend: no ring left on its own at any Spacing", bad.length === 0, bad.join("; ") || "0.3 / 0.5 / 0.8 / 1 / 1.5 / 3");
  }

  // Dots are spaced evenly along each ring (Resample-style): the distances between neighbouring
  // dots on a ring, in 3D before the view, must all be within 8% of each other -- on the Hopf
  // fibration and a spirograph with loops, whose parameter steps bunch badly (57x and 6x before),
  // and a star, whose corners fall between the finer samples the dots are spaced on, cutting each
  // by up to 3% of a step (1.06 measured; 4.3 before).
  // The last point still repeats the first, and lines keep their parameter steps.
  {
    const bad = [];
    for (const [name, o] of [["hopf", { gen: "hopf", hopfLat: 120, hopfSpread: 60 }], ["spirograph loops", { gen: "spiro", spPen: 1.8 }], ["star", { gen: "again", base: "star", sides: 5 }]]) {
      // Distance along the ring, not straight-line (shorter across a star's corner): each point is
      // projected onto the nearest segment of a 64x finer copy of the ring and read off its running
      // length. (Snapping to the nearest vertex instead was off by half a segment, 0.007 on the big
      // near-pole Hopf ring, and misreported the spacing as 17% uneven.)
      const fine = t.look3d(Object.assign(t.defaults(), { rings: 8, res: 96, draw: "lines", wobble: 0 }, o), 1.7, 64 * 96).rings.map(r => {
        const cum = [0]; for (let j = 0; j + 3 < r.pre.length; j += 3) cum.push(cum[cum.length - 1] + Math.hypot(r.pre[j + 3] - r.pre[j], r.pre[j + 4] - r.pre[j + 1], r.pre[j + 5] - r.pre[j + 2]));
        return { pre: r.pre, cum };
      });
      const along = (q, fr) => { let best = Infinity, at = 0;
        for (let j = 0, i = 0; j + 3 < fr.pre.length; j += 3, i++) {
          const ax = fr.pre[j], ay = fr.pre[j + 1], az = fr.pre[j + 2], vx = fr.pre[j + 3] - ax, vy = fr.pre[j + 4] - ay, vz = fr.pre[j + 5] - az;
          const l2 = vx * vx + vy * vy + vz * vz, u = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - ax) * vx + (q[1] - ay) * vy + (q[2] - az) * vz) / l2)) : 0;
          const d = (ax + u * vx - q[0]) ** 2 + (ay + u * vy - q[1]) ** 2 + (az + u * vz - q[2]) ** 2;
          if (d < best) { best = d; at = fr.cum[i] + u * (fr.cum[i + 1] - fr.cum[i]); }
        }
        return at; };
      for (const draw of ["dots", "lines"]) {
        const p = Object.assign(t.defaults(), { rings: 8, res: 96, draw, wobble: 0 }, o), f = t.look3d(p, 1.7);
        let ratio = 0, closed = 0;
        f.rings.forEach((r, k) => {
          const total = fine[k].cum[fine[k].cum.length - 1], s = [];
          for (let j = 0; j + 3 < r.pre.length; j += 3) s.push(along([r.pre[j], r.pre[j + 1], r.pre[j + 2]], fine[k]));
          const d = s.slice(1).map((v, i) => v - s[i]); d.push(total - s[s.length - 1]);
          ratio = Math.max(ratio, Math.max(...d) / Math.min(...d));
          closed = Math.max(closed, Math.hypot(r.pre[r.pre.length - 3] - r.pre[0], r.pre[r.pre.length - 2] - r.pre[1], r.pre[r.pre.length - 1] - r.pre[2]));
        });
        if (draw === "dots" ? (ratio > 1.08 || closed > 0 || f.rings[0].pre.length !== 3 * 97) : ratio < 1.5) bad.push(`${name} ${draw}: longest/shortest step along the ring ${ratio.toFixed(2)}`);
      }
    }
    check("dots sit evenly along each ring; lines keep their parameter steps", bad.length === 0, bad.join("; ") || "hopf, spirograph loops, star");
  }

  // One perfect loop of a look (loopOf): on seeded random looks with View motion thrown in, and
  // every preset, the frame one loop later must be the frame now -- points and colours -- and
  // the frame a third of the way through must not be (so the loop isn't vacuous). Looks that
  // loopOf says don't loop are counted, and one is shown to really not repeat at any multiple
  // of its longest part under the cap.
  {
    const rnd = t.mulberry32(2024), modes = ["off", "off", "swing", "turn", "turnRev"];
    const looks = Object.entries(t.PRESETS).map(([n, p]) => [n, Object.assign(t.defaults(), p)]);
    // Strips whose rings really are upside down after a lap (a heart; an odd wobble), and not.
    looks.push(["strip heart", Object.assign(t.defaults(), { gen: "strip", base: "heart", drift: 0.6 })]);
    looks.push(["strip odd wobble", Object.assign(t.defaults(), { gen: "strip", wobble: 0.2, lobes: 5, drift: 0.6 })]);
    looks.push(["strip even star", Object.assign(t.defaults(), { gen: "strip", base: "star", sides: 6, drift: 0.6 })]);
    looks.push(["strip 2 twists heart", Object.assign(t.defaults(), { gen: "strip", base: "heart", msTwists: 2, drift: 0.6 })]);
    for (let s = 1; s <= 240; s++) {
      const p = t.randomize(s * 977);
      for (const a of ["yaw", "pitch", "roll"]) { p[a + "Mode"] = modes[Math.floor(rnd() * modes.length)]; p[a + "Period"] = +(1 + rnd() * 12).toFixed(1); }
      if (rnd() < 0.2) p.draw = "dots";
      if (rnd() < 0.3) p.loopColors = true;
      if (rnd() < 0.15) p.speed = +(0.3 + rnd() * 2).toFixed(2);
      looks.push([`seed ${s * 977}`, p]);
    }
    // Random looks rarely loop as they are (Drift 0.73 against Cycle 25...): Tune to loop nudges
    // their parts to line up. Every tuned look must then loop, and no setting may move by more
    // than a quarter (the biggest nudge: a part set to the nearest whole fraction of the loop).
    let tuned = 0, untunable = 0, biggestNudge = 0; const tuneBad = [];
    for (const [name, p] of looks.slice()) {
      if (t.loopOf(p).secs !== null) continue;
      const r = t.tuneToLoop(p);
      if (!r) { untunable++; continue; }
      tuned++;
      // The nudge as each part's period change (a setting near 0, like Cycle 1, would read huge).
      const before = t.loopParts(p), after = t.loopParts(r.params);
      before.forEach((q, i) => { biggestNudge = Math.max(biggestNudge, Math.abs(after[i].period - q.period) / q.period); });
      if (t.loopOf(r.params).secs === null) tuneBad.push(name);
      looks.push([name + " tuned", r.params]);
    }
    check("Tune to loop makes a look loop with small nudges", tuneBad.length === 0 && tuned >= 100 && biggestNudge <= 0.26,
      tuneBad.slice(0, 3).join("; ") || `${tuned} tuned (biggest nudge ${(100 * biggestNudge).toFixed(0)}%), ${untunable} can't be (fixed-rate Drift)`);
    // Rings compared as the drawn picture: with their kaleidoscope copies laid on (Spin repeats the
    // picture every 360 / copies degrees) and as sets of points (curveGap), since a ring can come
    // back with its points numbered from a different start -- a Moebius strip ring is turned half
    // a turn each lap -- and still be the same picture. Colours and brightness by ring.
    const laid = (pts, copies) => { const out = [];
      for (const cp of copies) { const c = Math.cos(cp.angle), s = Math.sin(cp.angle);
        for (let j = 0; j < pts.length; j += 2) { const x = pts[j] * (cp.sx ?? 1), y = pts[j + 1]; out.push(c * x - s * y, s * x + c * y); } }
      return out; };
    // Same drawn picture, within about 0.3 px (chords' sag on the biggest rings at 360 points is
    // 0.24), however each ring's points are placed along it: B's polylines are densified to
    // 0.25 px and hashed into 0.3 px cells; every point of A must land in a cell with one of B's
    // (and vice versa). Linear time, where point-to-segment distances took minutes.
    const CELL = 0.3;
    const cells = pts => { const m = new Set();
      for (let j = 0; j + 3 < pts.length; j += 2) {
        const sub = Math.max(1, Math.ceil(Math.hypot(pts[j + 2] - pts[j], pts[j + 3] - pts[j + 1]) / (CELL / 2)));  // by distance: the biggest rings' segments are tens of px
        for (let i = 0; i < sub; i++) { const u = i / sub, x = pts[j] + u * (pts[j + 2] - pts[j]), y = pts[j + 1] + u * (pts[j + 3] - pts[j + 1]); if (Math.abs(x) < FRAME && Math.abs(y) < FRAME) m.add(Math.round(x / CELL) + "," + Math.round(y / CELL)); }
      }
      return m; };
    // Only what the 600 px frame shows: the biggest Hopf rings run thousands of px off-screen,
    // where a chord's sag is large and nothing is drawn.
    const FRAME = 320;
    const allNear = (pts, m) => { for (let j = 0; j < pts.length; j += 2) { if (Math.abs(pts[j]) >= FRAME || Math.abs(pts[j + 1]) >= FRAME) continue; const cx = Math.round(pts[j] / CELL), cy = Math.round(pts[j + 1] / CELL); let hit = false;
        for (let dx = -1; dx <= 1 && !hit; dx++) for (let dy = -1; dy <= 1; dy++) if (m.has((cx + dx) + "," + (cy + dy))) { hit = true; break; }
        if (!hit) return false; } return true; };
    // Returns 0 when the pictures match (points by number, else by curve), else how far apart:
    // by number when that is what differs, or 1 px meaning "off the other's curve".
    const same = (A, B) => { let worst = 0;
      A.rings.forEach((r, k) => { const q = B.rings[k];
        let byIndex = 0; for (let j = 0; j < r.pts.length; j++) byIndex = Math.max(byIndex, Math.abs(r.pts[j] - q.pts[j]));
        if (byIndex > 1e-6) {
          const la = laid(r.pts, A.look.copies), lb = laid(q.pts, B.look.copies);
          byIndex = allNear(la, cells(lb)) && allNear(lb, cells(la)) ? 0 : Math.max(1, byIndex);
        }
        worst = Math.max(worst, byIndex);
        for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(r.rgb[c] - q.rgb[c])); worst = Math.max(worst, Math.abs(r.w - q.w)); });
      return worst; };
    let loops = 0, none = 0, worstSeam = 0, tooSimilar = 0; const bad = [], similarNames = [];
    for (const [name, p] of looks) {
      const L = t.loopOf(p);
      if (L.secs === null) { none++; continue; }
      loops++;
      // At the page's own 360 points a ring: a loop can bring a ring back with its points elsewhere
      // along the same curve (Hopf's turn, the harmonograph's phase symmetry), and the polylines
      // then differ by their chords' sag -- 0.24 px on the biggest near-pole Hopf rings at 360
      // (1.0 at 180, 0.07 at 720), and exactly 0 for looks whose points come back in place.
      const t0 = 2.3 + (loops % 7), A = t.computeFrame(p, t0, 600, 360);
      const seam = same(A, t.computeFrame(p, t0 + L.period, 600, 360)), third = same(A, t.computeFrame(p, t0 + L.period / 3, 600, 360));
      worstSeam = Math.max(worstSeam, seam);
      if (seam > 0.5) bad.push(`${name}: ${seam.toExponential(1)} px off after one loop (${L.secs.toFixed(1)} s)`);
      if (third < 1e-3) { tooSimilar++; similarNames.push(`${name} (${p.gen}, ${L.parts.map(q => q.label).join("+")})`); }
    }
    check("one loop of a look brings every point and colour back exactly", bad.length === 0 && loops >= 150,
      bad.slice(0, 3).join("; ") || `${loops} looping looks (worst seam ${worstSeam.toExponential(1)} px), ${none} with no loop under the cap`);
    // A loop can still be longer than needed in rare symmetric cases the calculator doesn't fold
    // (dots on a spirograph whose Drift and Spin turns add to a whole 360 / Points): allowed for
    // at most 1% of looks, named so a regression in the common cases stays loud.
    check("...and a third of a loop is a different picture (the loop is not vacuous)", tooSimilar <= loops / 100, `${tooSimilar} of ${loops} unchanged at a third${tooSimilar ? ": " + similarNames.join("; ") : ""}`);
    // Slinky's Drift is a turn of the picture: Drift 0.7 (16.04 deg/s) against Spin -16.04 stands
    // still, and Hopf's Drift likewise (the other way) when drawn as lines; as dots Hopf's takes
    // its full cycle (the dots would crawl), so Drift and Spin are separate parts there.
    const still = t.loopOf(Object.assign(t.defaults(), { gen: "slinky", drift: 0.7, spin: -0.4 * 0.7 * 180 / Math.PI, pitch: 30 }));
    const hopfL = t.loopOf(Object.assign(t.defaults(), { gen: "hopf", drift: 0.7, spin: 0.4 * 0.7 * 180 / Math.PI }));
    const hopfD = t.loopOf(Object.assign(t.defaults(), { gen: "hopf", drift: 0.7, spin: 0.4 * 0.7 * 180 / Math.PI, draw: "dots" }));
    check("Slinky and Hopf Drift count as Spin (lines): they can cancel it; Hopf as dots keeps its own cycle",
      still.secs === null && /Nothing/.test(still.why) && hopfL.secs === null && hopfD.parts.length === 2 && hopfD.secs !== null,
      `slinky: ${still.why}; hopf lines: ${hopfL.why}; hopf dots: ${hopfD.parts.map(q => q.label).join("+")} loop ${hopfD.secs && hopfD.secs.toFixed(2)} s`);
    // Straight on, Spin and a turning Roll add: Spin 9 with Roll turning once per 6.153846 s
    // (58.5 deg/s) is one turn of 67.5 deg/s, a loop of 5.333 s, not Spin's 40 s; and Spin -58.5
    // against that Roll cancels to nothing moving.
    const sr = Object.assign(t.defaults(), { gen: "cover", drift: 0, spin: 9, rollMode: "turn", rollPeriod: 6.153846153846154 });
    const SR = t.loopOf(sr), srSame = same(t.computeFrame(sr, 1, 600, 48), t.computeFrame(sr, 1 + SR.period, 600, 48));
    const cancel = t.loopOf(Object.assign({}, sr, { spin: -360 / 6.153846153846154 }));
    check("straight on, Spin and a turning Roll count as one turn (and can cancel)",
      SR.parts.length === 1 && Math.abs(SR.period - 360 / 67.5) < 1e-9 && srSame < 0.05 && cancel.secs === null && /Nothing/.test(cancel.why),
      `loop ${SR.period.toFixed(3)} s from ${SR.parts.map(q => q.label).join("+")}, seam ${srSame.toExponential(1)}; cancelled: ${cancel.why}`);
    // A look whose parts can't line up: Drift 0.3 on Sphere spin (66.67 s) against Spin 7 (51.43 s)
    // share no multiple under 600 s (their ratio is 14/9 x 10/12 ..., LCM 4200 s); loopOf must say so,
    // and the frame must indeed differ at every multiple of the longer part under the cap.
    const nl = Object.assign(t.defaults(), { gen: "sphere", drift: 0.3, spin: 7, cycle: 0, wobble: 0 });
    const NL = t.loopOf(nl), A0 = t.computeFrame(nl, 1, 600, 48);
    let repeats = 0;
    for (let k = 1; k * 66.6667 <= 600; k++) if (same(A0, t.computeFrame(nl, 1 + k * 360 / 5.4, 600, 48)) < 1e-3) repeats++;
    check("a look whose parts never line up is reported, and truly never repeats under the cap", NL.secs === null && /don't line up/.test(NL.why) && repeats === 0, `${NL.why || "loop " + NL.secs} / ${repeats} repeats`);
  }

  // Pendulum Period's log slider track: ends at 4 and 720 s, 30 s round-trips exactly and sits well
  // into the track (a plain 4-720 track put it at 3.6%), and Mutate nudges it by at most 180^0.08
  // (x1.52) either way rather than +-57 s.
  {
    const s = t.BY_ID.pwPeriod, tr = s.track;
    const ends = [tr.from(tr.min), tr.from(tr.max)], at30 = tr.to(30), back = tr.from(at30);
    let worst = 1;
    const base = Object.assign(t.defaults(), { gen: "pendulum" });
    for (let sd = 1; sd <= 400; sd++) { const q = t.mutate(base, sd); worst = Math.max(worst, q.pwPeriod / 30, 30 / q.pwPeriod); }
    check("Period slider runs 4 to 720 s on a log track; Mutate nudges it in proportion",
      ends[0] === 4 && ends[1] === 720 && back === 30 && at30 > 0.35 && worst <= Math.pow(180, 0.08) * 1.01 && worst > 1.3,
      `ends ${ends.join("/")}, 30 s at ${(100 * at30).toFixed(0)}% of the track, biggest Mutate step x${worst.toFixed(2)}`);
  }

  // Seeds: adding generators and base shapes must leave every seed that still picks an original
  // generator and base exactly as before. The digest is of randomize() output from the release
  // before any were added (1a31786) for those seeds (only the settings it had; seeds 131..39300),
  // recorded from that version. Adding another generator or base changes which seeds stay, so
  // re-record it then, from that same release, and add the new settings to NEW.
  {
    const NEW = new Set(["sfM", "sfN1", "sfN2", "sfN3", "hopfLat", "hopfSpread", "hopfTurns",
      "spMode", "spLobes", "spPen", "spPenSpread", "spTwist", "spShrink", "pwPeriod", "pwSwings", "pwSwing", "pwAxis", "pwShrink", "mbSpread", "mbTwist", "mbSize", "msRadius", "msWidth", "msFlat", "msTwists", "draw", "dotSize"]);
    const ORIGINAL = new Set(["cover", "sphere", "again", "blend", "harmono", "slinky"]);
    let h = 2166136261, n = 0, added = 0, sup = 0;
    for (let k = 1; k <= 300; k++) {
      const x = t.randomize(k * 131);
      if (!ORIGINAL.has(x.gen)) added++; else if (x.base === "super") sup++;
      if (!ORIGINAL.has(x.gen) || x.base === "super") continue;
      n++;
      const s = JSON.stringify(Object.keys(x).filter(q => !NEW.has(q)).map(q => [q, x[q]]));
      for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
    }
    check("seeds on an original generator and base come out as before", h === 141746709 && n === 151, `${n} seeds, digest ${h}; ${added} now on a new generator, ${sup} now Superformula`);
  }

  // Sync: a favourite added here is stamped with a time and pushed; one deleted leaves a
  // tombstone; a favourite and a sequence the "other device" put on the server arrive here after
  // a sync, and one it deleted goes; a failed sync changes nothing here and reports.
  {
    storageMode = "ok"; mem.clear();
    t.sync.code = "amber-fox-tide-4821";
    t.favs.length = 0;
    const mine = t.shelfEntry("Mine", t.randomize(5));
    t.favs.push(mine); t.writeList(t.FAV_STORE, t.favs);
    check("a favourite is stamped with its change time on save", Number.isFinite(mine.u) && typeof mine.uid === "string", `u ${mine.u}, uid ${mine.uid}`);
    const gone = t.shelfEntry("Gone", t.randomize(6));
    t.favs.push(gone); t.writeList(t.FAV_STORE, t.favs);
    t.favs.splice(t.favs.indexOf(gone), 1); t.writeList(t.FAV_STORE, t.favs);
    check("deleting a favourite leaves a tombstone for the other devices", Number.isFinite(t.readTombs().favourites[gone.uid]), "");
    // The other device's library is already on the server: a favourite, a sequence, and a
    // deletion of a favourite this device also has.
    const theirs = t.shelfEntry("Theirs", t.randomize(7)), shared = t.shelfEntry("Shared", t.randomize(8));
    t.favs.push(shared); t.writeList(t.FAV_STORE, t.favs);
    fakeServer.library = mergeLibraries(fakeServer.library, {
      favourites: [{ id: theirs.uid, u: Date.now(), name: theirs.name, params: theirs.params, at: theirs.at }, { id: shared.uid, u: Date.now() + 1000, gone: true }],
      sequences: [{ id: "night drive", u: Date.now(), name: "Night drive", savedAt: new Date().toISOString(), sequence: t.cardsForSave() }] });
    const msg = await t.syncNow();
    const names = t.favs.map(f => f.name).sort().join(",");
    check("after a sync, the other device's favourite is here, its deletion took effect, mine stayed", msg === "Synced." && names === "Mine,Theirs", `${msg}; favourites: ${names}`);
    check("...and its saved sequence is in this browser's list", (t.readLibrary() || []).some(e => e.name === "Night drive"), "");
    check("...and the server holds this device's items and tombstone", fakeServer.library.favourites.some(f => f.id === mine.uid) && fakeServer.library.favourites.some(f => f.id === gone.uid && f.gone), "");
    const before = JSON.stringify(t.favs.map(f => f.name));
    fakeServer.fail = true;
    const failMsg = await t.syncNow();
    fakeServer.fail = false;
    check("a failed sync changes nothing here and says so", /Sync failed: server down/.test(failMsg) && JSON.stringify(t.favs.map(f => f.name)) === before, failMsg);
    t.sync.code = null;
  }

  t.seq.savedKey = t.seqKey();
  const clean = !t.seqDirty();
  t.seq.cards[0].hold = 2.5;
  check("editing a card marks the sequence unsaved", clean && t.seqDirty());

  process.exit(failed ? 1 : 0);
}, 150);
