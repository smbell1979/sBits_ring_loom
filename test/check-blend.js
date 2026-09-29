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
const exposed = ["computeFrame", "blendFrames", "pairUp", "morphFrame", "rollFrame", "rollBetween", "ringProgress", "cleanCard", "seqAt", "seq", "EASES", "defaults", "PRESETS", "START_PARAMS", "cleanParams",
  "readLibrary", "writeLibrary", "libraryUpsert", "parseSequenceFile", "sequenceFileData", "cardsForSave", "makeCard", "seqDirty", "seqKey",
  "lookFileData", "readLookFile", "params"];
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
  const f0 = t.blendFrames(fa, fb, 0), R = t.pairUp(fa.rings.length, fb.rings.length);
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

  // t = 1 must be look B exactly.
  const f1 = t.blendFrames(fa, fb, 1);
  let err1 = 0;
  f1.rings.forEach((r, i) => { const b = fb.rings[R.ib[i]]; for (let j = 0; j < r.pts.length; j++) err1 = Math.max(err1, Math.abs(r.pts[j] - b.pts[j])); });
  check("t=1 points equal look B", err1 < 1e-3, `max ${err1.toExponential(2)} px`);
  check("t=1 every ring at full brightness", f1.rings.every(r => Math.abs(r.w - 1) < 1e-9));
  const ang1 = f1.look.copies.map(c => c.angle), want1 = fb.look.copies.map(c => c.angle);
  check("t=1 kaleidoscope angles equal B's", ang1.every((a, i) => Math.abs(a - want1[i]) < 1e-9));

  // No pops: over 200 steps of t, the largest move of any point between neighbouring steps should
  // be about the total travel / 200. A pop would show as one step far above that.
  let worst = 0, total = 0, prev = f0;
  for (let s = 1; s <= 200; s++) {
    const f = t.blendFrames(fa, fb, s / 200);
    let step = 0;
    f.rings.forEach((r, i) => { const q = prev.rings[i]; for (let j = 0; j < r.pts.length; j++) step = Math.max(step, Math.abs(r.pts[j] - q.pts[j])); });
    worst = Math.max(worst, step); prev = f;
  }
  f1.rings.forEach((r, i) => { const q = f0.rings[i]; for (let j = 0; j < r.pts.length; j++) total = Math.max(total, Math.abs(r.pts[j] - q.pts[j])); });
  check("no jumps inside a blend", worst <= total / 200 * 1.0001 + 1e-6, `worst step ${worst.toFixed(3)} px, even share ${(total / 200).toFixed(3)} px`);

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
    const e1 = Math.max(...m1.rings.map((r, i) => maxDiff({ rings: [r] }, { rings: [plainB.rings[R.ib[i]]] })));
    check(`${name}: blend starts on A and ends exactly on B`, e0 < 1e-3 && e1 < 1e-3, `start ${e0.toExponential(1)}, end ${e1.toExponential(1)} px`);
  }
  // Continuity for every blend style: halving the step size must halve the worst step between
  // neighbouring moments. A pop or tear is a fixed-size jump, so it would not shrink.
  for (const [name, how] of hows.slice(3)) {
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
  // No pops with turns either: the step between neighbouring moments stays even.
  {
    const steps = 400; let worstR = 0, prevR = t.morphFrame(RA, RB, time, size, M, 0, { turns: 2 });
    for (let s = 1; s <= steps; s++) { const f = t.morphFrame(RA, RB, time, size, M, s / steps, { turns: 2 }); worstR = Math.max(worstR, maxDiff(f, prevR)); prevR = f; }
    const radius = Math.max(...plainA.rings.concat(plainB.rings).flatMap(r => Array.from({ length: r.pts.length / 2 }, (_, j) => Math.hypot(r.pts[2 * j], r.pts[2 * j + 1]))));
    const bound = (radius * (740 * D2R) + total) / steps;  // arc length of the turn + straight morph, split evenly
    check("no jumps inside a blend with 2 extra turns", worstR <= bound * 1.01, `worst step ${worstR.toFixed(3)} px, bound ${bound.toFixed(3)} px`);
  }
  // Turns in files: whole numbers only, clamped, and left out of files when 0.
  check("turns read from a file are whole and clamped", t.cleanCard({ params: A, turns: 2.6 }).turns === 3 && t.cleanCard({ params: A, turns: -99 }).turns === -10 && t.cleanCard({ params: A }).turns === 0);

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
