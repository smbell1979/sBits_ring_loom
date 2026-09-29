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
  copies: f.look.copies.map(c => [+c.angle.toFixed(9), +c.w.toFixed(9)]),
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
// Typed values between the sliders' steps (the page keeps them exactly).
looks.push(["typed off-step values", Object.assign(t.defaults(), { gen: "again", roll: 12.37, yaw: -7.33, pitch: 3.14159, twist: 45.125, squash: 0.9137, zoom: 1.0625 })]);
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
  ["stagger + views", flat({ gen: "slinky", rings: 20, yaw: 30, pitch: 50, zoom: 1.2, persp: 0.8 }),
    flat({ gen: "harmono", rings: 12, yaw: -120, pitch: -10, zoom: 0.8 }), { stagger: 0.6, ease: "smooth", turns: -1 }],
  ["swirl", flat({ gen: "again", rings: 24, base: "star", sides: 5 }), flat({ gen: "cover", rings: 19 }), { swirl: 270, ease: "smooth" }],
  ["swirl zoomed", flat({ gen: "blend", rings: 25, zoom: 1.6 }), flat({ gen: "blend", rings: 25, zoom: 1.6, phase: -90 }), { swirl: -405 }],
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
