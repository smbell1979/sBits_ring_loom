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
  body,
  "</body>",
  "</html>",
  "",
].join("\n");

const out = path.join(__dirname, "public", "index.html");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${out} (${html.length} bytes)`);
