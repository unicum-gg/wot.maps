# wot.maps

High-resolution top-down battle **minimaps** for World of Tanks / Мир танков,
keyed by arena id (`<arena_id>.webp`), used by [unicum.gg](https://unicum.gg).

Each game/publisher has its own branch, mirroring
[`unicum-gg/wot.assets`](https://github.com/unicum-gg/wot.assets):

| Branch | Client | WGUS host | guid |
| --- | --- | --- | --- |
| `WG` | Wargaming release | `wgus-woteu.wargaming.net` | `WOT.EU.PRODUCTION` |
| `WG_CT` | Wargaming Common Test | `wgus-wotct.wargaming.net` | `WOT.CT.PRODUCTION` |
| `Lesta` | Lesta / Мир танков release | `lstus-ru.lesta.ru` | `MT.RU.PRODUCTION` |
| `Lesta_PT` | Lesta Public Test | — | — |

### How it's built

Fully self-contained, no game client needed. `generate.mjs` pulls the game's own
`spaces/<id>/mmap.dds` (DXT1) straight from Wargaming's update CDN via **WGUS**
(query the update service for the versioned `.wgpkg` volumes, range-download only
each map's 7-Zip block from the content CDN, unpack, decode DXT), and re-encodes
it as WebP upscaled to 2048².

`.github/workflows/sync.yml` runs it on a daily schedule per branch and pushes
only what changed. It's a no-op unless the game patched: the generator compares
the live client version to `.metadata_version` and skips the download entirely
when unchanged.

Run locally: `npm install && node generate.mjs --all --out out` (needs `7z` /
p7zip on PATH). `--host`/`--guid` select the branch, `--size` the output edge.

### Notice

Assets provided in the repository are the property of their sole owners.
