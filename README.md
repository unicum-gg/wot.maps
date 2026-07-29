# wot.maps

High-resolution top-down battle **minimaps** for World of Tanks / Мир танков,
keyed by arena id (`<arena_id>.webp`), used by [unicum.gg](https://unicum.gg).

Each game/publisher has its own branch, mirroring
[`unicum-gg/wot.assets`](https://github.com/unicum-gg/wot.assets):

| Branch | Client |
| --- | --- |
| `WG` | Wargaming release |
| `WG_CT` | Wargaming Common Test |
| `Lesta` | Lesta release |
| `Lesta_PT` | Lesta Public Test |

### How it's built

The minimaps are extracted from the game's own `spaces/<id>/mmap.dds` (DXT1),
pulled straight from Wargaming's update CDN via WGUS (no client install), decoded
and re-encoded as WebP (upscaled to 1024²). The generator lives in the main app
repo (`apps/web/scripts/extract-minimaps.mjs`) and is re-run on each game patch.

### Notice

Assets provided in the repository are the property of their sole owners.
