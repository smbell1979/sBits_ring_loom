// Merging two copies of a library (favourites and saved sequences), item by item. Each item has
// an id and u (when it last changed, ms); a deletion is a tombstone { id, u, gone: true }. For
// every id the copy with the later u wins, deletion or not, so a device that was offline can't
// bring a deleted item back with an older change, nor lose a newer one to a stale overwrite.
// Tombstones are kept for TOMB_DAYS so a device that missed the deletion still learns of it,
// then dropped. Items without an id or u are skipped, not guessed at.
const TOMB_DAYS = 30;

function mergeItems(a, b, now = Date.now()) {
  const byId = new Map();
  for (const item of [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])]) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id || !Number.isFinite(item.u)) continue;
    const have = byId.get(item.id);
    // Ties (the same time on both sides) break the same way whichever side is merged first: a
    // deletion wins, else the lexically smaller item.
    if (!have || item.u > have.u || (item.u === have.u && (!!item.gone > !!have.gone || (!!item.gone === !!have.gone && JSON.stringify(item) < JSON.stringify(have))))) byId.set(item.id, item);
  }
  const keepTombsAfter = now - TOMB_DAYS * 86400000;
  return [...byId.values()].filter(item => !item.gone || item.u >= keepTombsAfter);
}

function mergeLibraries(a, b, now = Date.now()) {
  a = a && typeof a === "object" ? a : {};
  b = b && typeof b === "object" ? b : {};
  return { favourites: mergeItems(a.favourites, b.favourites, now), sequences: mergeItems(a.sequences, b.sequences, now) };
}

module.exports = { mergeItems, mergeLibraries, TOMB_DAYS };
