# wot.maps

High-resolution top-down **battle minimaps** for World of Tanks / Мир танков,
keyed by arena id (`maps/<arena_id>.webp`), one branch per client build.
Extracted straight from the update CDN by
[`unicum-gg/wot.build`](https://github.com/unicum-gg/wot.build), with no game
client installed. Used by [unicum.gg](https://unicum.gg).

## Branches

| Branch | Client | Update service | guid |
| --- | --- | --- | --- |
| [`WG`](../../tree/WG) | Wargaming release | `wgus-woteu.wargaming.net` | `WOT.EU.PRODUCTION` |
| [`WG_CT`](../../tree/WG_CT) | Wargaming Common Test | `wgus-wotct.wargaming.net` | `WOT.CT.PRODUCTION` |
| [`Lesta`](../../tree/Lesta) | Lesta release (Мир танков) | `lstus-ru.lesta.ru` | `MT.RU.PRODUCTION` |
| [`Lesta_PT`](../../tree/Lesta_PT) | Lesta public test | `lstus-ru.lesta.ru` | `MT.PT.PRODUCTION` |

A new map appears on the test branch first, which is what that one is for.

## What is published

- `maps/<arena_id>.webp` — the minimap, 2048² by default
- `maps/<arena_id>_comp7.webp` — the Onslaught night variant, for the handful of
  arenas that have one
- `markers/` — the game's own minimap entries (base flags, numbered spawn
  diamonds, control point), cropped from the client's battle atlas. Region
  agnostic, so a single set is published on `WG`.

Each minimap is a DXT surface at `spaces/<id>/mmap.dds` inside that map's own
package, so one map costs one range-downloaded block rather than the whole
multi-gigabyte part.

## Notice

Assets provided in the repository are the property of their sole owners.
