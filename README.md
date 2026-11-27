# Retired maps

Every battle map World of Tanks no longer ships, as it was in the last update
that had it: `maps/<arena>.webp` (the minimap, 2048px), `arena_defs/<arena>.xml`
(the last definition) and `index.json` (its name and the versions it was in).

`history/` is what each update did to every map's look: `history/index.json`
(the terrain, objects and minimap each rework touched), and
`history/legacy-minimaps.json`, the minimap of every map in the clients of 0.6.2
to 0.9.7, one image per version that redrew it. The images themselves are on the
`ARCHIVE_HISTORY_0` to `_7` branches, by arena id, at the same paths.

Rebuilt by `unicum-gg/wot.build`'s `generate-archive` from the full EU clients
preserved on the Internet Archive, a decompiled mirror of the versions after
them, and the `wot.src` history since 1.13.
