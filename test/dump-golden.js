// Dumps reference geometry computed by the page itself, for checking the Houdini port against it:
//   node test/dump-golden.js src/ring-loom.html > golden.json
//   python houdini/test_parity.py golden.json
// The page is the source of truth; houdini/ringloom_engine.py must reproduce these numbers.
const fs = require("fs");
const html = fs.readFileSync(process.argv[2], "utf8");
let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const hook = "function draw() { renderFrame(currentFrame()); }";
if (!js.includes(hook)) { console.error("draw() hook line not found; update this script"); process.exit(1); }
const exposed = ["computeFrame", "blendFrames", "morphFrame", "seqAt", "seq", "defaults", "PRESETS", "START_PARAMS", "cleanParams", "randomize", "makeCard", "cardsForSave", "SCHEMA"];
js = js.replace(hook, hook + "\nglobalThis.__t = {" + exposed.map(n => `get ${n}() { return ${n}; }`).join(", ") + "};");

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
const g = {
  document: stub(), matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
  ResizeObserver: class { observe() {} }, Path2D: class { moveTo() {} lineTo() {} },
  requestAnimationFrame: () => {}, performance: { now: () => 0 },
  localStorage: { getItem: () => null, setItem() {} }, navigator: {}, addEventListener() {},
  setTimeout, clearTimeout, setInterval, clearInterval, console,
};
g.window = g;
new Function(...Object.keys(g), js)(...Object.values(g));
const t = globalThis.__t;

const SIZE = 600, M = 64;
const round = a => Array.from(a, v => +v.toFixed(5));
const frameOut = f => ({
  rings: f.rings.map(r => ({ pts: round(r.pts), rgb: r.rgb.map(v => +v.toFixed(6)), w: +r.w.toFixed(9) })),
  copies: f.look.copies.map(c => [+c.angle.toFixed(9), +c.w.toFixed(9), +c.sx.toFixed(9)]),
});

// Looks: every preset, the opening look, and seeded random looks (all generators and base shapes).
const looks = [["opening", t.cleanParams(t.START_PARAMS)]];
for (const [name, p] of Object.entries(t.PRESETS)) looks.push([name, Object.assign(t.defaults(), p)]);
for (let s = 1; s <= 40; s++) looks.push([`seed ${s * 7919}`, t.randomize(s * 7919)]);
// Force coverage of every base shape under a non-harmonograph generator.
for (const base of ["polygon", "star", "flower", "heart", "infinity"]) {
  looks.push([`base ${base}`, Object.assign(t.defaults(), { gen: "again", base, sides: 6, depth: 0.5, wobble: 0.1, rings: 12, pitch: 25, yaw: -30, persp: 0.6 })]);
}

// Roll, alone and combined with yaw, pitch, perspective and kaleidoscope copies.
looks.push(["roll only", Object.assign(t.defaults(), { gen: "cover", roll: 35 })]);
looks.push(["roll+yaw+pitch", Object.assign(t.defaults(), { gen: "sphere", roll: -120, yaw: 40, pitch: -25, persp: 0.7 })]);
// Every palette, including the ones Randomize never picks (it only uses the original few).
for (const pal of ["infrared", "aurora", "vapor", "cyber", "fireice", "gold", "deepsea", "candy", "magma", "viridis", "rose", "sunset"]) {
  looks.push([`palette ${pal}`, Object.assign(t.defaults(), { gen: "again", rings: 16, palette: pal, spread: 1.7, cycle: 40 })]);
}
// Ring fade, every direction and a few curves (brightness per ring is compared exactly).
for (const [from, curve] of [["last", 1], ["first", 2.5], ["ends", 0.4], ["middle", 1.7]]) {
  looks.push([`fade ${from} ${curve}`, Object.assign(t.defaults(), { gen: "sphere", rings: 23, fade: 0.85, fadeCurve: curve, fadeFrom: from })]);
}
// One full turn, on every generator that has it.
for (const [gen, extra] of [["slinky", { rings: 17 }], ["sphere", { rings: 13, alpha: 40 }], ["again", { rings: 21, squashA: 0.97 }], ["harmono", { rings: 9, decay: 0.2 }]]) {
  looks.push([`one full turn ${gen}`, Object.assign(t.defaults(), { gen, closed: true, drift: 0.4 }, extra)]);
}
// Loop colours, a gradient palette, Custom and Spectrum, with and without Cycle.
for (const [pal, cycle] of [["viridis", 0], ["custom", 45], ["spectrum", 0], ["spectrum", 70], ["infrared", -30]]) {
  looks.push([`loop colours ${pal} ${cycle}`, Object.assign(t.defaults(), { gen: "slinky", closed: true, rings: 15, loopColors: true, palette: pal, cycle })]);
}
// Kaleidoscope: copies over a half circle, mirrored twins, and both.
for (const [mirror, copySpan, reflect] of [[2, "half", false], [5, "full", true], [3, "half", true], [1, "full", true]]) {
  looks.push([`kaleidoscope ${mirror} ${copySpan}${reflect ? " mirrored" : ""}`, Object.assign(t.defaults(), { gen: "cover", rings: 12, mirror, copySpan, reflect })]);
}
// View motion: each mode on each axis, and all together (checked at the three clock times).
for (const [name, m] of [["yaw swing", { yawMode: "swing", yawSwing: 45, yawPeriod: 3.3 }], ["pitch turn", { pitchMode: "turn", pitchPeriod: 4.1 }],
  ["roll turn reverse", { rollMode: "turnRev", rollPeriod: 2.2 }], ["all axes", { yawMode: "turn", yawPeriod: 6, pitchMode: "swing", pitchSwing: 70, pitchPeriod: 2.5, rollMode: "swing", rollSwing: 25, rollPeriod: 1.7 }]]) {
  looks.push([`view motion ${name}`, Object.assign(t.defaults(), { gen: "slinky", rings: 16, persp: 0.5 }, m)]);
}
// Straight down and straight up, the ends of View pitch.
looks.push(["pitch 90", Object.assign(t.defaults(), { gen: "sphere", rings: 12, pitch: 90, yaw: 25, persp: 0.6 })]);
looks.push(["pitch -90", Object.assign(t.defaults(), { gen: "slinky", rings: 14, pitch: -90, roll: 30 })]);
// Typed values between the sliders' steps (the page keeps them exactly).
looks.push(["typed off-step values", Object.assign(t.defaults(), { gen: "again", roll: 12.37, yaw: -7.33, pitch: 3.14159, twist: 45.125, squash: 0.9137, zoom: 1.0625 })]);
// Hopf fibration: one torus, spread across tori with Turns and a view, and the latitude cap.
looks.push(["hopf default", Object.assign(t.defaults(), { gen: "hopf", rings: 14 })]);
looks.push(["hopf wide 2 turns", Object.assign(t.defaults(), { gen: "hopf", rings: 18, hopfLat: 110, hopfSpread: 80, hopfTurns: 2, drift: 0.7, pitch: 35, yaw: -20, persp: 0.5, base: "star", wobble: 0.2 })]);
looks.push(["hopf one torus capped", Object.assign(t.defaults(), { gen: "hopf", rings: 11, hopfLat: 150, hopfSpread: 0, zoom: 0.5 })]);
// Latitude 76 +- 75 runs 1..151, past both caps (3 and 150), so the clamps themselves are compared.
looks.push(["hopf past both caps", Object.assign(t.defaults(), { gen: "hopf", rings: 21, hopfLat: 76, hopfSpread: 150, zoom: 0.4 })]);
// Superformula: even symmetry, odd with Shape A = B (one turn), odd lopsided (two turns), and 0.
for (const [m, n1, n2, n3, gen] of [[6, 1, 7, 8, "again"], [5, 2, 7, 7, "sphere"], [7, 1.2, 4, 11, "again"], [3, 0.4, 20, 0.2, "slinky"], [0, 2, 3, 9, "cover"]]) {
  looks.push([`superformula ${m} ${n1} ${n2} ${n3} ${gen}`, Object.assign(t.defaults(), { gen, base: "super", sfM: m, sfN1: n1, sfN2: n2, sfN3: n3, rings: 12, wobble: 0.08, pitch: 20 })]);
}
// Spirograph: both wheels, pen below / on / past the rim, pen change either way, twist, shrink.
for (const [spMode, spLobes, spPen, spPenSpread, spTwist, spShrink] of [["hypo", 5, 0.8, 0.8, 1.5, 0.3], ["epi", 7, 1, -1.2, -4, 0], ["hypo", 3, 1.8, 2, 12, 0.7], ["epi", 12, 0.3, 0, 0, 0.5]]) {
  looks.push([`spirograph ${spMode} ${spLobes} ${spPen}`, Object.assign(t.defaults(), { gen: "spiro", spMode, spLobes, spPen, spPenSpread, spTwist, spShrink, rings: 13, drift: 0.6, wobble: 0.05 })]);
}
// Pendulum wave: gimbal swing on a star, in-picture swing on a superformula, and a short period.
looks.push(["pendulum star", Object.assign(t.defaults(), { gen: "pendulum", base: "star", sides: 5, rings: 15, pwSwing: 70, pitch: 25, persp: 0.5 })]);
looks.push(["pendulum axis 90 superformula", Object.assign(t.defaults(), { gen: "pendulum", base: "super", sfM: 4, rings: 12, pwAxis: 90, pwSwings: 3, pwShrink: 0.2 })]);
looks.push(["pendulum short period", Object.assign(t.defaults(), { gen: "pendulum", rings: 20, pwPeriod: 5, pwSwings: 11, pwSwing: 140, pwAxis: 35, yaw: 30 })]);
// Loxodromic spiral: circles, a star with twist the other way, a heart with wobble streaming, and a
// tight twist with big rings (the huge arcs near the map's pole), compared like any other look.
looks.push(["loxo circles", Object.assign(t.defaults(), { gen: "loxo", rings: 18 })]);
looks.push(["loxo star", Object.assign(t.defaults(), { gen: "loxo", base: "star", sides: 5, rings: 22, mbTwist: -2.1, mbSpread: 9.5, drift: 0.9 })]);
looks.push(["loxo heart wobble", Object.assign(t.defaults(), { gen: "loxo", base: "heart", rings: 15, mbSize: 0.5, wobble: 0.2, drift: 1.7, mbSpread: 4 })]);
// Ring fade on the Loxodromic spiral runs on the place along the spiral, with the wrap crossfade.
looks.push(["loxo fade ends", Object.assign(t.defaults(), { gen: "loxo", rings: 14, mbSpread: 4.5, drift: 1.1, fade: 0.8, fadeFrom: "ends", fadeCurve: 1.6 })]);
looks.push(["loxo big arcs", Object.assign(t.defaults(), { gen: "loxo", rings: 30, mbTwist: 2.9, mbSize: 0.6, zoom: 0.4 })]);
// Moebius strip: classic, flat (the strip itself), more half twists on a star with wobble, streaming.
looks.push(["strip classic", Object.assign(t.defaults(), { gen: "strip", rings: 24, pitch: 50, persp: 0.4 })]);
looks.push(["strip flat", Object.assign(t.defaults(), { gen: "strip", rings: 30, msFlat: 0, msWidth: 0.4, yaw: -35, pitch: 40 })]);
looks.push(["strip 3 twists star", Object.assign(t.defaults(), { gen: "strip", base: "star", sides: 5, rings: 20, msTwists: 3, msFlat: 0.5, wobble: 0.15, drift: 0.9, pitch: 65 })]);
looks.push(["roll+mirror", Object.assign(t.defaults(), { gen: "slinky", roll: 75, pitch: 30, mirror: 5, rings: 20 })]);

const cases = [];
for (const [name, p] of looks) {
  for (const tau of [0, 2.37, 7.9]) cases.push({ name, params: p, tau, frame: frameOut(t.computeFrame(p, tau, SIZE, M)) });
}

// Blends. Both sides blend in 3D (ring shapes, then view angles), so they must agree exactly for
// any pair: same view or not, flat or 3D generators, with turns, stagger and swirl.
const flat = (extra) => Object.assign(t.defaults(), { yaw: 0, pitch: 0, persp: 0, rotate: 30, spin: 5 }, extra);
const blendPairs = [
  ["cover19->again54", flat({ gen: "cover", rings: 19 }), flat({ gen: "again", rings: 54, base: "star", sides: 5 })],
  ["blend6copies", flat({ gen: "blend", rings: 30, mirror: 1 }), flat({ gen: "harmono", rings: 12, mirror: 6, palette: "dusk" })],
  ["mirror3to2", flat({ gen: "again", rings: 7, mirror: 3, palette: "acid" }), flat({ gen: "cover", rings: 31, mirror: 2, palette: "spectrum" })],
  ["rolled", flat({ gen: "cover", rings: 19, roll: 40 }), flat({ gen: "blend", rings: 25, roll: 40 })],
  ["roll across 180", flat({ gen: "cover", rings: 19, roll: 170 }), flat({ gen: "again", rings: 12, roll: -170 })],
  ["roll +2 turns", flat({ gen: "blend", rings: 25, roll: -30, mirror: 3 }), flat({ gen: "cover", rings: 19, roll: 60 }), { turns: 2 }],
  ["roll -1 turn", flat({ gen: "harmono", rings: 12, roll: 90 }), flat({ gen: "blend", rings: 30, roll: 90 }), { turns: -1 }],
  // Stagger with a roll change: each ring must turn on its own clock, on both sides.
  ["stagger + roll", flat({ gen: "cover", rings: 19, roll: -60 }), flat({ gen: "again", rings: 30, roll: 45 }), { stagger: 0.7, ease: "smooth" }],
  ["stagger reversed", flat({ gen: "blend", rings: 25, mirror: 2 }), flat({ gen: "cover", rings: 19, zoom: 1.3 }), { stagger: -0.4, ease: "in" }],
  // Views that differ, on 3D generators.
  ["yaw, pitch, perspective change", flat({ gen: "sphere", rings: 14, yaw: -60, pitch: 20, persp: 0.6 }),
    flat({ gen: "slinky", rings: 20, yaw: 70, pitch: -40, persp: 0.2, zoom: 1.2 }), { ease: "smooth" }],
  // Rotate 180 apart, and spins whose gap (70 deg/s x 3.1 s = 217 deg) is past 180: taking the short
  // way between the current angles would go the other way round from the true blend.
  ["rotate 180 + spin gap past 180", flat({ gen: "cover", rings: 19, rotate: -90, spin: 30 }),
    flat({ gen: "sphere", rings: 12, rotate: 90, spin: -40, pitch: 35 }), {}],
  // A blend that began earlier (tau0 1.2, gap -84 deg: the short way is clockwise); by now (3.1)
  // the gap is -217, whose short way would be the other direction. It must keep the first way.
  ["spin gap, blend began earlier", flat({ gen: "cover", rings: 19, spin: 30 }), flat({ gen: "again", rings: 24, spin: -40 }), { tau0: 1.2 }],
  // Points matched (the default) on a pair that folds without it, and the same pair with it off.
  ["matched points", flat({ gen: "blend", rings: 30, mirror: 1 }), flat({ gen: "again", rings: 20, base: "star", sides: 5, rotate: 30 }), {}],
  ["matching off", flat({ gen: "blend", rings: 30, mirror: 1 }), flat({ gen: "again", rings: 20, base: "star", sides: 5, rotate: 30 }), { match: false }],
  // Between a faded look and an unfaded one with a different ring count: shares and fade mix.
  ["fade blend", flat({ gen: "cover", rings: 19, fade: 0.9, fadeCurve: 2, fadeFrom: "ends" }), flat({ gen: "again", rings: 30 }), { ease: "smooth" }],
  // Mirror turning on during a blend: the twins turn over (sx 1 -> -1).
  ["mirror on", flat({ gen: "cover", rings: 19, mirror: 3 }), flat({ gen: "blend", rings: 25, mirror: 3, reflect: true, copySpan: "half" }), {}],
  // Out of a look whose view turns and swings, a blend that began earlier (views at tau0 differ
  // from now): the way round each angle is kept from the start.
  ["view motion blend", Object.assign(flat({ gen: "cover", rings: 19 }), { yawMode: "turn", yawPeriod: 2, pitchMode: "turn", pitchPeriod: 3, rollMode: "swing", rollSwing: 60, rollPeriod: 1.3 }),
    flat({ gen: "again", rings: 24, yaw: 40, roll: -30 }), { tau0: 0.9, stagger: 0.3 }],
  ["stagger + views", flat({ gen: "slinky", rings: 20, yaw: 30, pitch: 50, zoom: 1.2, persp: 0.8 }),
    flat({ gen: "harmono", rings: 12, yaw: -120, pitch: -10, zoom: 0.8 }), { stagger: 0.6, ease: "smooth", turns: -1 }],
  ["swirl", flat({ gen: "again", rings: 24, base: "star", sides: 5 }), flat({ gen: "cover", rings: 19 }), { swirl: 270, ease: "smooth" }],
  ["swirl zoomed", flat({ gen: "blend", rings: 25, zoom: 1.6 }), flat({ gen: "blend", rings: 25, zoom: 1.6, phase: -90 }), { swirl: -405 }],
  ["hopf -> superformula", flat({ gen: "hopf", rings: 16, pitch: 30, persp: 0.4 }), flat({ gen: "again", rings: 24, base: "super", sfM: 7, sfN1: 1.2, sfN2: 4, sfN3: 11 }), { stagger: 0.3, ease: "smooth" }],
  ["spirograph -> pendulum", flat({ gen: "spiro", rings: 20, spMode: "epi", spLobes: 6 }), flat({ gen: "pendulum", rings: 14, base: "polygon", sides: 4, pitch: 30 }), { stagger: -0.3, swirl: 90 }],
  ["strip -> loxo", flat({ gen: "strip", rings: 30, pitch: 45 }), flat({ gen: "loxo", rings: 20 }), { swirl: 120, ease: "smooth" }],
  ["loxo -> pendulum", flat({ gen: "loxo", rings: 20, base: "star", drift: 0.6 }), flat({ gen: "pendulum", rings: 12, pitch: 40 }), { stagger: 0.4, ease: "smooth" }],
  ["all together", flat({ gen: "harmono", rings: 12, roll: 20, mirror: 4 }), flat({ gen: "cover", rings: 19, roll: -100 }), { turns: 1, stagger: -0.55, swirl: 180, ease: "out" }],
];
const blends = [];
for (const [name, a, b, how = {}] of blendPairs) {
  for (const u of [0, 0.25, 0.5, 0.8, 1]) {
    const f = t.morphFrame(a, b, 3.1, SIZE, M, u, how, how.tau0 ?? 3.1);
    blends.push({ name, a, b, how, tau: 3.1, u, frame: frameOut(f) });
  }
}

// Sequence clock on the example chain.
t.seq.cards = [
  Object.assign(t.makeCard(t.START_PARAMS, "Opening look"), { hold: 2, blend: 3, ease: "smooth" }),
  Object.assign(t.makeCard(Object.assign(t.defaults(), t.PRESETS["Rolling sphere"]), "Rolling sphere"), { hold: 1.5, blend: 2.5, ease: "in" }),
  Object.assign(t.makeCard(Object.assign(t.defaults(), t.PRESETS["Star weave"]), "Star weave"), { hold: 0, blend: 4, ease: "out" }),
];
const seqTimes = [];
for (let c = -3; c <= 40; c += 0.37) seqTimes.push(+c.toFixed(2));
const seqAt = seqTimes.map(c => ({ clock: c, at: t.seqAt(c) }));

const schema = t.SCHEMA.map(s => ({ id: s.id, type: s.type, def: s.def, min: s.min, max: s.max, options: s.options ? Object.keys(s.options) : undefined }));

process.stdout.write(JSON.stringify({
  size: SIZE, M, cases, blends, schema,
  sequence: t.cardsForSave(), seqAt,
}));
