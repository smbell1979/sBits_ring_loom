// Sets what a first-time visitor to Ring Loom sees.
//
//   node tools/set-default.js                               show the current default
//   node tools/set-default.js my.ringloom.json              dry run: what would change
//   node tools/set-default.js my.ringloom.json --apply      write it into src/ring-loom.html
//   node tools/set-default.js my.ringloom.json --still      a sequence that doesn't start playing
//   node tools/set-default.js --clear [--apply]             back to the built-in example
//
// Any file the page saves works: a sequence ("To file", or File in the saved list) or a single
// look ("Look"). A sequence of two or more looks plays on the first visit unless --still.
//
// Before anything is written, the new page is booted in a stub browser with empty storage, i.e.
// as a first-time visitor, and what it shows is compared against the raw file: every look, name,
// time, easing, turn count and parameter value. Any look the page can't read, any setting it
// doesn't know, or any value it would clamp stops the script instead of being quietly dropped.
// Only visitors with nothing saved in their browser see the default; to see it yourself, open the
// page in a private window.
const fs = require("fs");
const path = require("path");

const PAGE = path.join(__dirname, "..", "src", "ring-loom.html");
const BEGIN = "// BEGIN DEFAULT_START", END = "// END DEFAULT_START";

const args = process.argv.slice(2);
const apply = args.includes("--apply"), still = args.includes("--still"), clear = args.includes("--clear");
const files = args.filter(a => !a.startsWith("--"));
const unknown = args.filter(a => a.startsWith("--") && !["--apply", "--still", "--clear"].includes(a));
if (unknown.length || files.length > 1 || (clear && files.length)) {
  console.error("Usage: node tools/set-default.js [file.ringloom.json [--still] | --clear] [--apply]");
  process.exit(2);
}

// Runs the page as a first-time visitor and returns what it ends up showing.
function boot(html) {
  let js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const hook = "function draw() { renderFrame(currentFrame()); }";
  if (!js.includes(hook)) throw new Error("draw() hook line not found in the page; update tools/set-default.js");
  const exposed = ["seq", "params", "SCHEMA", "DEFAULT_START"];
  js = js.replace(hook, hook + "\nglobalThis.__d = {" + exposed.map(n => `get ${n}() { return ${n}; }`).join(", ") + "};");
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
  const errors = [];
  const quiet = { log() {}, warn() {}, info() {}, error: (...a) => errors.push(a.map(String).join(" ")) };
  const g = {
    document: stub(), matchMedia: () => ({ matches: false }), devicePixelRatio: 1,
    ResizeObserver: class { observe() {} }, Path2D: class { moveTo() {} lineTo() {} },
    requestAnimationFrame: () => {}, performance: { now: () => 0 },
    localStorage: { getItem: () => null, setItem() {} }, navigator: {}, addEventListener() {},
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, console: quiet,
  };
  g.window = g;
  new Function(...Object.keys(g), js)(...Object.values(g));
  const d = globalThis.__d;
  delete globalThis.__d;
  return { d, errors };
}

function describe(shown) {
  const { seq } = shown.d;
  const total = seq.cards.reduce((s, c) => s + c.hold + c.blend, 0);
  const lines = [`"${seq.name}": ${seq.cards.length} look${seq.cards.length === 1 ? "" : "s"}` +
    (seq.cards.length > 1 ? `, ${total.toFixed(1)} s loop, ${seq.playing ? "plays on first visit" : "not playing until Play is pressed"}` : ", shown as a single look")];
  seq.cards.forEach((c, i) => lines.push(`  ${String(i + 1).padStart(2)}. ${c.name.padEnd(24)} ${c.params.gen.padEnd(8)} hold ${c.hold}  blend ${c.blend}  ${c.ease}` + (c.turns ? `  turns ${c.turns > 0 ? "+" : ""}${c.turns}` : "")));
  return lines.join("\n");
}

// The raw file against what the booted page shows. Returns a list of problems.
function compare(raw, shown, play) {
  const { seq, params, SCHEMA } = shown.d;
  const problems = [];
  const byId = Object.fromEntries(SCHEMA.map(s => [s.id, s]));
  const cards = Array.isArray(raw.sequence) ? raw.sequence : [];
  if (seq.cards.length !== cards.length) problems.push(`the file has ${cards.length} looks but the page shows ${seq.cards.length}`);
  cards.forEach((rc, i) => {
    const c = seq.cards[i], at = `look ${i + 1}`;
    if (!c) return;
    const name = typeof rc.name === "string" && rc.name.trim() ? rc.name.slice(0, 40) : "Look";
    if (c.name !== name) problems.push(`${at}: name "${rc.name}" shows as "${c.name}"`);
    for (const [k, def] of [["hold", 3], ["blend", 3], ["turns", 0]]) {
      const want = rc[k] === undefined ? def : +rc[k];
      if (c[k] !== want) problems.push(`${at}: ${k} ${rc[k]} shows as ${c[k]}`);
    }
    if ((rc.ease === undefined ? "smooth" : rc.ease) !== c.ease) problems.push(`${at}: easing "${rc.ease}" shows as "${c.ease}"`);
    for (const [k, v] of Object.entries(rc.params || {})) {
      const s = byId[k];
      if (!s) { problems.push(`${at}: setting "${k}" isn't one this page knows`); continue; }
      const want = s.type === "range" ? +v : s.type === "toggle" ? !!v : v;
      if (c.params[k] !== want) problems.push(`${at}: ${k} ${JSON.stringify(v)} shows as ${JSON.stringify(c.params[k])}`);
    }
  });
  if (seq.cards[0] && JSON.stringify(params) !== JSON.stringify(seq.cards[0].params)) problems.push("the controls don't show the first look");
  const wantPlay = play && cards.length >= 2;
  if (seq.playing !== wantPlay) problems.push(`the sequence ${seq.playing ? "plays" : "doesn't play"} on first visit, expected the opposite`);
  if (typeof raw.name === "string" && raw.name.trim() && seq.name !== raw.name.trim().slice(0, 60)) problems.push(`sequence name "${raw.name}" shows as "${seq.name}"`);
  return problems;
}

const html = fs.readFileSync(PAGE, "utf8");
const b = html.indexOf(BEGIN), e = html.indexOf(END);
if (b < 0 || e < b || html.indexOf(BEGIN, b + 1) >= 0 || html.indexOf(END, e + 1) >= 0) {
  console.error(`Couldn't find exactly one "${BEGIN}" ... "${END}" block in ${PAGE}.`);
  process.exit(1);
}
const current = boot(html);
const cur = current.d.DEFAULT_START;
console.log("Current default: " + (cur ? `${cur.source || "a saved file"} -> ` : "built-in example -> ") + describe(current));
if (current.errors.length) console.log("  (the page reports: " + current.errors.join("; ") + ")");
if (!files.length && !clear) process.exit(0);

let value = "null", raw = null;
if (!clear) {
  const file = files[0];
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch (err) { console.error(`Can't read ${file}: ${err.message}`); process.exit(1); }
  try { raw = JSON.parse(text); } catch { console.error(`${file} isn't JSON.`); process.exit(1); }
  if (!raw || !Array.isArray(raw.sequence) || !raw.sequence.length) {
    console.error(`${file} has no looks in it. Save a sequence with "To file" or a single look with "Look".`);
    process.exit(1);
  }
  // "<" escaped so a name containing "</script>" can't end the page's script early.
  value = JSON.stringify({ play: !still, source: path.basename(file), file: raw }).replace(/</g, "\\u003c");
}
const block = `${BEGIN}\nconst DEFAULT_START = ${value};\n`;
const next = html.slice(0, b) + block + html.slice(e);
const shown = boot(next);
console.log("\nNew default:     " + (clear ? "built-in example -> " : `${path.basename(files[0])} -> `) + describe(shown));

const problems = shown.errors.map(m => "the page reports: " + m);
if (raw) problems.push(...compare(raw, shown, !still));
if (problems.length) {
  console.error(`\nNOT written: what a first-time visitor would see doesn't match the file.`);
  for (const p of problems.slice(0, 30)) console.error("  " + p);
  if (problems.length > 30) console.error(`  ... and ${problems.length - 30} more`);
  process.exit(1);
}
if (raw) console.log(`\nChecked against the file: ${raw.sequence.length === 1 ? "the look and" : `all ${raw.sequence.length} looks, their times, easing, turns and`} every setting match.`);

if (!apply) {
  console.log(`Dry run: nothing written. Add --apply to write it into ${path.relative(process.cwd(), PAGE)}.`);
  process.exit(0);
}
fs.writeFileSync(PAGE, next);
console.log(`Written to ${path.relative(process.cwd(), PAGE)}. Commit and push to publish it; republish the Claude artifact too.`);
