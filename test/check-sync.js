// The sync merge (api/_merge.js): per item the later change wins, deletions are tombstones that
// beat older changes and are pruned after 30 days, and malformed items are skipped, not guessed.
//   node test/check-sync.js
const { mergeItems, mergeLibraries, TOMB_DAYS } = require("../api/_merge.js");
let failed = false;
const check = (name, ok, detail) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? "  (" + detail + ")" : ""}`); if (!ok) failed = true; };
const now = 1_800_000_000_000, day = 86400000;

// Two devices edit apart, then both push: nothing either did is lost.
const server = [{ id: "a", u: now - 5 * day, name: "A" }, { id: "b", u: now - 5 * day, name: "B" }, { id: "c", u: now - 5 * day, name: "C" }];
const phone = [{ id: "a", u: now - 5 * day, name: "A" }, { id: "b", u: now - day, name: "B renamed on phone" }, { id: "c", u: now - 5 * day, name: "C" }, { id: "d", u: now - day, name: "D new on phone" }];
const desktop = [{ id: "a", u: now - 2 * day, gone: true }, { id: "b", u: now - 5 * day, name: "B" }, { id: "c", u: now - 5 * day, name: "C" }, { id: "e", u: now - 2 * day, name: "E new on desktop" }];
const afterPhone = mergeItems(server, phone, now), afterBoth = mergeItems(afterPhone, desktop, now);
const byId = list => Object.fromEntries(list.map(i => [i.id, i]));
const m = byId(afterBoth);
check("a rename on one device and a deletion on the other both survive", m.b.name === "B renamed on phone" && m.a.gone === true && m.d && m.e && m.c.name === "C",
  Object.values(m).map(i => i.id + ":" + (i.gone ? "gone" : i.name)).join(", "));
// The deleting device pushes a stale copy later (it never saw the phone's rename): the rename stays.
const stale = mergeItems(afterBoth, desktop, now);
check("a stale push can't undo newer changes", byId(stale).b.name === "B renamed on phone" && byId(stale).d, "");
// A device that missed the deletion pushes the old item: the tombstone wins.
const resurrect = mergeItems(afterBoth, [{ id: "a", u: now - 5 * day, name: "A" }], now);
check("an old copy of a deleted item doesn't bring it back", byId(resurrect).a.gone === true, "");
// But a genuinely newer save of the same id after the deletion does come back.
const redo = mergeItems(afterBoth, [{ id: "a", u: now - day, name: "A again" }], now);
check("a newer save after a deletion wins", byId(redo).a.name === "A again", "");
// Tombstones expire.
const old = mergeItems([{ id: "z", u: now - (TOMB_DAYS + 1) * day, gone: true }, { id: "y", u: now - (TOMB_DAYS - 1) * day, gone: true }], [], now);
check(`tombstones older than ${TOMB_DAYS} days are dropped, younger kept`, old.length === 1 && old[0].id === "y", old.map(i => i.id).join(","));
// Malformed input is skipped, never merged as something.
const junk = mergeItems([{ id: "ok", u: now, name: "fine" }], [null, 5, { name: "no id" }, { id: "", u: now }, { id: "nou", name: "x" }, { id: "ok", u: "soon" }], now);
check("items without an id or a time are skipped", junk.length === 1 && junk[0].name === "fine", "");
const lib = mergeLibraries({ favourites: [{ id: "f", u: 1 }], sequences: "junk" }, { sequences: [{ id: "s", u: 2 }] }, now);
check("a library merges both kinds and tolerates a missing or wrong kind", lib.favourites.length === 1 && lib.sequences.length === 1, "");
// The merge is the same whichever side goes first (so devices agree).
const sorted = list => JSON.stringify(list.slice().sort((x, y) => x.id.localeCompare(y.id)));
const tie = [{ id: "t", u: now, name: "one" }], tie2 = [{ id: "t", u: now, name: "two" }], tieGone = [{ id: "t", u: now, gone: true }];
check("merging is symmetric, ties included", sorted(mergeItems(phone, desktop, now)) === sorted(mergeItems(desktop, phone, now))
  && sorted(mergeItems(tie, tie2, now)) === sorted(mergeItems(tie2, tie, now)) && mergeItems(tie, tieGone, now)[0].gone === true && mergeItems(tieGone, tie, now)[0].gone === true, "");
process.exit(failed ? 1 : 0);
