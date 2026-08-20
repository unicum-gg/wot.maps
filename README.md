# wot.maps

High-resolution top-down battle **minimaps** for World of Tanks / Мир танков,
keyed by arena id (`maps/<arena_id>.webp`), used by [unicum.gg](https://unicum.gg).

The `WG` branch also carries `markers/` — the game's own minimap entry icons
(base flags, numbered spawn diamonds, control point) cropped from the client
battle atlas. These are region-agnostic GUI, so a single set is published there.

Each game/publisher has its own branch, mirroring
[`unicum-gg/wot.assets`](https://github.com/unicum-gg/wot.assets):

| Branch | Client | WGUS host | guid |
| --- | --- | --- | --- |
| `WG` | Wargaming release | `wgus-woteu.wargaming.net` | `WOT.EU.PRODUCTION` |
| `WG_CT` | Wargaming Common Test | `wgus-wotct.wargaming.net` | `WOT.CT.PRODUCTION` |
| `Lesta` | Lesta / Мир танков release | `lstus-ru.lesta.ru` | `MT.RU.PRODUCTION` |
| `Lesta_PT` | Lesta Public Test | `lstus-ru.lesta.ru` | `MT.PT.PRODUCTION` |

The host column is the entry point, not necessarily where the build is served:
WGUS answers a moved branch with a `redirect_url` that `generate.ts` follows.
The Common Test is currently redirected from `wgus-wotct.wargaming.net` to
`wgus-eu.wargaming.net`, and is only published while a test is running, so
between two tests its sync is a no-op rather than a failure.

### How it's built

Fully self-contained, no game client needed. `generate.ts` pulls the game's own
`spaces/<id>/mmap.dds` (DXT1) straight from Wargaming's update CDN via **WGUS**
(query the update service for the versioned `.wgpkg` volumes, range-download only
each map's 7-Zip block from the content CDN, unpack, decode DXT), and re-encodes
it as WebP upscaled to 2048² under `maps/`.

`.github/workflows/sync.yml` runs it on a daily schedule per branch and pushes
only what changed. It's a no-op unless the game patched: the generator compares
the live client version to `.metadata_version` and skips the download entirely
when unchanged.

Run locally (needs `7z` / p7zip on PATH):

```sh
npm install
npm run generate -- --all --out out          # WG (default host/guid)
npm run generate -- --all --out out --host lstus-ru.lesta.ru --guid MT.RU.PRODUCTION
npm run generate -- --markers --out out       # minimap base/spawn/CP markers
```

`--host`/`--guid` select the branch, `--size` the output edge (default 2048),
`--force` re-extracts even when the version is unchanged. `--markers` crops the
minimap icons from the `unicum-gg/wot.assets` battle atlas into `markers/`.

### Notice

Assets provided in the repository are the property of their sole owners.
