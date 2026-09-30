// Wraps the Claude artifact source (page content only) into a standalone index.html for Vercel.
// Usage: node build.js <path-to-ring-loom.html>
// The artifact host supplies <!doctype>, <head> and <body>; a plain web host needs them written out.
const fs = require("fs");
const path = require("path");

const src = process.argv[2];
if (!src) { console.error("usage: node build.js <ring-loom.html>"); process.exit(1); }
const body = fs.readFileSync(src, "utf8");
if (!body.includes("<title>Ring Loom</title>")) {
  console.error("That file does not look like the Ring Loom source (no <title>Ring Loom</title>).");
  process.exit(1);
}

// Build stamp shown in the corner of the canvas: the commit's time (UTC) and short id, so each
// deploy can be told apart. Vercel gives the commit id in VERCEL_GIT_COMMIT_SHA; the time comes
// from git where the checkout has it, else the build's own time (marked "built"). A local build
// with uncommitted changes to the page gets a "+", since it isn't that commit.
const { execSync } = require("child_process");
const git = args => { try { return execSync("git " + args, { cwd: __dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim(); } catch { return ""; } };
const sha = (process.env.VERCEL_GIT_COMMIT_SHA || git("rev-parse HEAD")).slice(0, 7);
const commitSecs = +git("log -1 --format=%ct");
const when = new Date(commitSecs ? commitSecs * 1000 : Date.now());
const two = n => String(n).padStart(2, "0");
const stampTime = `${when.getUTCFullYear()}.${two(when.getUTCMonth() + 1)}.${two(when.getUTCDate())}-${two(when.getUTCHours())}${two(when.getUTCMinutes())}`;
const dirty = !process.env.VERCEL && git("status --porcelain -- " + JSON.stringify(path.relative(__dirname, src).replace(/\\/g, "/"))) !== "";
const stamp = `build ${commitSecs ? "" : "built "}${stampTime}${sha ? " · " + sha : ""}${dirty ? "+" : ""}`;
const PLACEHOLDER = 'const BUILD = "dev";';
if (body.split(PLACEHOLDER).length !== 2) { console.error(`Expected exactly one ${PLACEHOLDER} in the page.`); process.exit(1); }

const icon = "data:image/svg+xml," + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">\u{1F300}</text></svg>');

const html = [
  "<!doctype html>",
  '<html lang="en">',
  "<head>",
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">',
  '<meta name="description" content="Animated editor for twisting ring patterns.">',
  `<link rel="icon" href="${icon}">`,
  "</head>",
  "<body>",
  body.replace(PLACEHOLDER, `const BUILD = ${JSON.stringify(stamp)};`),
  "</body>",
  "</html>",
  "",
].join("\n");

const out = path.join(__dirname, "public", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes, ${stamp})`);
