// Sync for favourites and saved sequences between a person's devices, keyed by a sync code the
// page makes (three words and a number). The code is hashed and the hash names one private blob
// holding the library as JSON; the code itself is never stored. There are no accounts: anyone
// with the code has the library, which is the deal the code offers.
//
// PUT { code, favourites, sequences }: merges what the device sends into what is stored (see
// _merge.js), writes the result, and returns it, so one call both pushes and pulls. The write
// is conditional on the blob's ETag and retried if another device wrote meanwhile, so no update
// is lost. GET ?code=...: just the stored library (or an empty one).
const { createHash } = require("node:crypto");
const { get, head, put, BlobNotFoundError, BlobPreconditionFailedError } = require("@vercel/blob");
const { mergeLibraries } = require("./_merge.js");

const CODE = /^[a-z]+-[a-z]+-[a-z]+-\d{4}$/;
const MAX_BYTES = 4 * 1024 * 1024;  // a library of thousands of looks is well under this

const pathFor = code => "libraries/" + createHash("sha256").update("ring-loom:" + code).digest("hex") + ".json";

async function readLibrary(path) {
  // The ETag for the conditional write comes from head(), the blob's metadata. head() runs
  // before get() so a write landing between the two fails the put (a retry) rather than being
  // overwritten by content read before it.
  // The store hands the ETag back weak (W/"..."), and If-Match compares strongly, so a weak tag
  // never matches: every write failed its precondition with nothing else writing. Send the tag
  // without the W/ marker.
  let etag = null;
  try { etag = ((await head(path)).etag || "").replace(/^W\//, "") || null; } catch (e) { if (!(e instanceof BlobNotFoundError)) throw e; }
  const r = await get(path, { access: "private", useCache: false });  // from origin, never a stale CDN copy
  if (!r || r.statusCode !== 200) return { data: { favourites: [], sequences: [] }, etag: null };
  const text = await new Response(r.stream).text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { data: data && typeof data === "object" ? data : { favourites: [], sequences: [] }, etag: r.blob.etag };
}

async function readBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.length > MAX_BYTES) throw new Error("too large");
  return JSON.parse(text);
}

module.exports = async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!process.env.BLOB_READ_WRITE_TOKEN) return res.status(503).json({ error: "Sync isn't set up on this deployment (no blob store)." });
  try {
    if (req.method === "GET") {
      const code = String(req.query.code || "").toLowerCase();
      if (!CODE.test(code)) return res.status(400).json({ error: "That isn't a sync code." });
      const { data } = await readLibrary(pathFor(code));
      return res.status(200).json(mergeLibraries(data, {}));
    }
    if (req.method !== "PUT") { res.setHeader("Allow", "GET, PUT"); return res.status(405).json({ error: "GET or PUT" }); }
    const body = await readBody(req);
    const code = String(body.code || "").toLowerCase();
    if (!CODE.test(code)) return res.status(400).json({ error: "That isn't a sync code." });
    const path = pathFor(code);
    const tried = [];  // the ETags each attempt wrote against, reported if every attempt fails
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, etag } = await readLibrary(path);
      tried.push(etag);
      const merged = mergeLibraries(data, body);
      const text = JSON.stringify(merged);
      if (text.length > MAX_BYTES) return res.status(413).json({ error: "The library is too large to sync." });
      try {
        await put(path, text, { access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true, ...(etag ? { ifMatch: etag } : {}) });
        return res.status(200).json(merged);
      } catch (e) {
        if (!(e instanceof BlobPreconditionFailedError)) throw e;  // another device wrote first: read again and merge again
      }
    }
    return res.status(409).json({ error: "The library kept changing under us; try again.", tried });
  } catch (e) {
    return res.status(e && e.message === "too large" ? 413 : 500).json({ error: e && e.message ? e.message : "Sync failed." });
  }
};
