// Generator for the `unicum-gg/wot.maps` mirror: extracts each battle map's
// top-down minimap (`spaces/<id>/mmap.dds`) straight from Wargaming's update
// CDN, with no game client installed, and writes web-ready WebP files.
//
// Pipeline (all headless, proven end to end):
//   1. WGUS (wgus-woteu.wargaming.net) -> metadata + patches_chain: the exact
//      versioned CDN URLs of the install `.wgpkg` volumes.
//   2. Each `.wgpkg` is a split 7-Zip whose entries are `res/packages/<id>.pkg`
//      (one per map), each its own LZMA2 block (Solid=-). We reconstruct the 7z
//      as SPARSE local volumes, fill only the 7z header (~2 MB) so `7z l` can
//      list every block + size, then range-download just the target map's block.
//   3. That `.pkg` is a zip; we pull `spaces/<id>/mmap.dds` (DXT1 512x512),
//      decode it, and encode a WebP (optionally upscaled) with sharp.
//
// Usage (needs the `7z` binary on PATH):
//   npm run generate -- [--all | id1 id2 ...] [--host H] [--guid G] [--out DIR] [--size N]
//   npm run generate -- --markers [--out DIR]   # minimap base/spawn/CP markers
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

const PV = "100500.6969696"; // spoofed protocol version WGUS accepts

type Volume = { url: string; size: number };
type Block = { name: string; off: number; comp: number };
type Decoded = { width: number; height: number; rgba: Buffer };
type Rgb = [number, number, number];

// WGUS coordinates per branch (mirrors unicum-gg/wot.assets):
//   WG        wgus-woteu.wargaming.net  WOT.EU.PRODUCTION
//   WG_CT     wgus-wotct.wargaming.net  WOT.CT.PRODUCTION
//   Lesta     lstus-ru.lesta.ru         MT.RU.PRODUCTION
//   Lesta_PT  lstus-ru.lesta.ru         MT.PT.PRODUCTION
const args = process.argv.slice(2);

function takeFlag(name: string): string | undefined {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

const HOST = takeFlag("--host") ?? "wgus-woteu.wargaming.net";
const GUID = takeFlag("--guid") ?? "WOT.EU.PRODUCTION";
const PART_OVERRIDE = takeFlag("--part"); // debug: scan only this content part
const outDir = takeFlag("--out") ?? path.resolve("maps-out");
const outSize = Number(takeFlag("--size") ?? "2048"); // 0 = keep native 512
const wantAll = args.includes("--all");
const explicitIds = args.filter((a) => !a.startsWith("--"));

const x = (s: string, re: RegExp): string | undefined => (s.match(re) ?? [])[1];
const xAll = (s: string, re: RegExp): RegExpMatchArray[] => [...s.matchAll(re)];

async function getText(url: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.text();
}
async function getBuffer(url: string, range?: string): Promise<Buffer> {
  const r = await fetch(url, range ? { headers: { Range: `bytes=${range}` } } : {});
  if (!r.ok && r.status !== 206) throw new Error(`${r.status} ${url}`);
  return Buffer.from(await r.arrayBuffer());
}

// ---- WGUS: resolve the install chain, grouping .wgpkg volumes by part --------
async function resolveClient(): Promise<{
  version: string;
  getVolumes: (part: string) => Volume[];
}> {
  const meta = await getText(
    `https://${HOST}/api/v1/metadata/?guid=${GUID}&chain_id=unknown&protocol_version=${PV}`,
  );
  const version = x(meta, /<version>([^<]+)<\/version>/);
  if (!version) throw new Error(`no metadata version for ${GUID}`);
  // Some publishers redirect the app id (Lesta: WOT.RU.PRODUCTION -> MT.RU...).
  const appId = x(meta, /<redirect_application_id>([^<]+)<\/redirect_application_id>/) ?? GUID;
  // Language must be one the build supports (Lesta is RU-only, not EN).
  const lang = x(meta, /<default_language>([^<]+)<\/default_language>/) ?? "EN";
  // client_type "hd" carries every part id we must declare a version for.
  const hdBlock = x(meta, /<client_type\b[^>]*\bid="hd"[^>]*>([\s\S]*?)<\/client_type>/) ?? "";
  const parts = xAll(hdBlock, /<client_part\b[^>]*\bid="([^"]+)"/g).map((m) => m[1]);

  const q = new URLSearchParams({
    game_id: appId,
    protocol_version: PV,
    metadata_protocol_version: PV,
    installation_id: "python-wgus",
    client_type: "hd",
    lang,
    metadata_version: version,
  });
  for (const p of parts) q.set(`${p}_current_version`, "0");
  const chain = await getText(`https://${HOST}/api/v1/patches_chain/?${q}`);

  const seedBase = x(chain, /<web_seeds>[\s\S]*?<url[^>]*>([^<]+)<\/url>/);
  // A branch with no live build (e.g. Common Test between tests) returns a
  // stale/empty chain with no seeds.
  if (!seedBase) throw new Error(`no install chain for ${appId} (no active build?)`);

  // Map each part to its full-install .wgpkg volumes. Map minimaps live across
  // two parts: `client` (the classic maps) and `sdcontent` (everything else). A
  // part can list several patches (a full install plus small incremental diffs);
  // we keep the largest, which is always the full install (WG tags diffs with
  // `version_from`, Lesta omits it, so total size is the reliable discriminator).
  const total = (v: Volume[]) => v.reduce((s, vol) => s + vol.size, 0);
  const byPart = new Map<string, Volume[]>();
  for (const [, patch] of xAll(chain, /<patch>([\s\S]*?)<\/patch>/g)) {
    const part = x(patch, /<part>([^<]+)<\/part>/);
    if (!part) continue;
    const vols = xAll(patch, /<file>([\s\S]*?)<\/file>/g).map((m): Volume => ({
      url: seedBase + (x(m[1], /<name>([^<]+)<\/name>/) ?? "").trim(),
      size: Number(x(m[1], /<size>([^<]+)<\/size>/)),
    }));
    const cur = byPart.get(part);
    if (!cur || total(vols) > total(cur)) byPart.set(part, vols);
  }
  return { version, getVolumes: (part) => byPart.get(part) ?? [] };
}

// ---- Sparse 7z: build volumes with only the header filled, then list ---------
function globalToPart(offset: number, sizes: number[]): { part: number; local: number } {
  let base = 0;
  for (let i = 0; i < sizes.length; i++) {
    if (offset < base + sizes[i]) return { part: i, local: offset - base };
    base += sizes[i];
  }
  throw new Error("offset past archive");
}

function volPath(dir: string, part: number): string {
  return path.join(dir, `a.7z.${String(part + 1).padStart(3, "0")}`);
}

async function fillRange(
  dir: string,
  volumes: Volume[],
  sizes: number[],
  globalStart: number,
  len: number,
): Promise<void> {
  let g = globalStart;
  let remaining = len;
  while (remaining > 0) {
    const { part, local } = globalToPart(g, sizes);
    const take = Math.min(remaining, sizes[part] - local);
    const buf = await getBuffer(volumes[part].url, `${local}-${local + take - 1}`);
    const fd = fs.openSync(volPath(dir, part), "r+");
    fs.writeSync(fd, buf, 0, buf.length, local);
    fs.closeSync(fd);
    g += take;
    remaining -= take;
  }
}

async function buildSparse(dir: string, volumes: Volume[]): Promise<number[]> {
  const sizes = volumes.map((v) => v.size);
  const total = sizes.reduce((a, b) => a + b, 0);
  for (let i = 0; i < volumes.length; i++) {
    const fd = fs.openSync(volPath(dir, i), "w");
    fs.ftruncateSync(fd, sizes[i]);
    fs.closeSync(fd);
  }
  // Fill the 7z header: first 64 KB of vol1 + last 2 MB of the final vol
  // (covers the packed-header stream + the end signature/encoded header).
  await fillRange(dir, volumes, sizes, 0, Math.min(65536, sizes[0]));
  const tail = Math.min(2 * 1024 * 1024, sizes[sizes.length - 1]);
  await fillRange(dir, volumes, sizes, total - tail, tail);
  return sizes;
}

// Parse `7z l` into an ordered map of block -> byte offset. Blocks are non-solid
// and laid out in listing order starting at 32 (verified against real CRCs), so
// offset = 32 + sum(compressed size of every block before it).
// Packages that never hold a `spaces/<id>/mmap.dds` — skip them so `--all`
// doesn't download tens of MB per tank/shared/hangar block for nothing.
const NON_MAP = /(?:^|[/_-])(?:vehicles_level|shared_content|hangar)|_bin$|_editor/;

// Map every `res/packages/<id>.pkg` to its byte offset in the (non-solid)
// archive. Each entry is its own packed stream laid out contiguously from
// offset 32, in listing order, so an entry's offset is 32 + the sum of every
// preceding entry's packed size. The `client` archive interleaves the map
// packages with the exe/dlls/other res, so we must accumulate over ALL entries,
// not just the packages — hence `-slt` (one `Packed Size` per file).
function indexArchive(vol1: string): Map<string, Block> {
  const listing = execFileSync("7z", ["l", "-slt", vol1], {
    encoding: "utf8",
    maxBuffer: 128 << 20,
  });
  let off = 32;
  const byId = new Map<string, Block>();
  for (const entry of listing.split(/\r?\n\r?\n/)) {
    const p = x(entry, /^Path = (.+)$/m);
    if (!p || !/^Packed Size =/m.test(entry)) continue; // skip archive header / dirs
    const packed = Number(x(entry, /^Packed Size = (\d+)$/m) ?? "0");
    const m = p.match(/^res\/packages\/([^/]+)\.pkg$/);
    if (m && !NON_MAP.test(m[1])) byId.set(m[1], { name: p, off, comp: packed });
    off += packed;
  }
  return byId;
}

// ---- DXT decode (DXT1/DXT5) -> RGBA ------------------------------------------
function unpack565(v: number): Rgb {
  const r = (v >> 11) & 0x1f, g = (v >> 5) & 0x3f, b = v & 0x1f;
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)];
}

// Decode a DXT1 or DXT5 DDS to RGBA. Minimaps are DXT1; DXT5 is handled too so
// the odd map with an alpha'd minimap still works.
function decodeDDS(buf: Buffer): Decoded {
  if (buf.toString("ascii", 0, 4) !== "DDS ") throw new Error("not dds");
  const height = buf.readUInt32LE(12);
  const width = buf.readUInt32LE(16);
  const fourcc = buf.toString("ascii", 84, 88);
  const dxt5 = fourcc === "DXT5";
  if (fourcc !== "DXT1" && !dxt5) throw new Error(`unsupported ${fourcc}`);
  const rgba = Buffer.alloc(width * height * 4);
  let o = 128;
  for (let by = 0; by < height; by += 4) {
    for (let bx = 0; bx < width; bx += 4) {
      let alphaAt: ((i: number) => number) | null = null;
      if (dxt5) {
        const a0 = buf[o], a1 = buf[o + 1];
        const at = [a0, a1, 0, 0, 0, 0, 0, 0];
        if (a0 > a1) for (let i = 1; i < 7; i++) at[i + 1] = ((7 - i) * a0 + i * a1) / 7;
        else {
          for (let i = 1; i < 5; i++) at[i + 1] = ((5 - i) * a0 + i * a1) / 5;
          at[6] = 0;
          at[7] = 255;
        }
        const lo = buf.readUIntLE(o + 2, 3);
        const hi = buf.readUIntLE(o + 5, 3);
        alphaAt = (i) => at[(i < 8 ? lo >> (3 * i) : hi >> (3 * (i - 8))) & 7];
        o += 8;
      }
      const c0 = buf.readUInt16LE(o), c1 = buf.readUInt16LE(o + 2);
      const bits = buf.readUInt32LE(o + 4);
      o += 8;
      const p0 = unpack565(c0), p1 = unpack565(c1);
      const pal: Rgb[] = [p0, p1, [0, 0, 0], [0, 0, 0]];
      if (dxt5 || c0 > c1) {
        pal[2] = [(2 * p0[0] + p1[0]) / 3, (2 * p0[1] + p1[1]) / 3, (2 * p0[2] + p1[2]) / 3];
        pal[3] = [(p0[0] + 2 * p1[0]) / 3, (p0[1] + 2 * p1[1]) / 3, (p0[2] + 2 * p1[2]) / 3];
      } else {
        pal[2] = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2, (p0[2] + p1[2]) / 2];
      }
      for (let py = 0; py < 4; py++) {
        for (let px = 0; px < 4; px++) {
          const x2 = bx + px, y2 = by + py;
          if (x2 >= width || y2 >= height) continue;
          const idx = (bits >> (2 * (py * 4 + px))) & 3;
          const c = pal[idx];
          const d = (y2 * width + x2) * 4;
          rgba[d] = c[0]; rgba[d + 1] = c[1]; rgba[d + 2] = c[2];
          rgba[d + 3] = alphaAt ? alphaAt(py * 4 + px) : 255;
        }
      }
    }
  }
  return { width, height, rgba };
}

// ---- Per-map extraction ------------------------------------------------------
// Decode one inner `.dds` from an already-unpacked map `.pkg` and write it as a
// WebP. `required` maps get the standard top-down minimap; the Onslaught variant
// (`mmap_comp7.dds`, a reduced play area shipped only by some maps) is optional.
async function ddsInnerToWebp(
  dir: string,
  pkgPath: string,
  inner: string,
  outFile: string,
  required: boolean,
): Promise<void> {
  const ddsDir = path.join(dir, "dds");
  fs.rmSync(ddsDir, { recursive: true, force: true });
  execFileSync("7z", ["x", pkgPath, `-i!${inner}`, `-o${ddsDir}`, "-y"], { stdio: "ignore" });
  const ddsPath = path.join(ddsDir, inner);
  if (!fs.existsSync(ddsPath)) {
    if (required) throw new Error(`no ${inner} in pkg`);
    return;
  }
  const { width, height, rgba } = decodeDDS(fs.readFileSync(ddsPath));
  let img = sharp(rgba, { raw: { width, height, channels: 4 } });
  if (outSize && outSize !== width) {
    img = img.resize(outSize, outSize, { kernel: "lanczos3" });
  }
  await img.webp({ quality: 88 }).toFile(outFile);
}

async function extractMap(
  dir: string,
  volumes: Volume[],
  sizes: number[],
  block: Block,
  id: string,
): Promise<void> {
  await fillRange(dir, volumes, sizes, block.off, block.comp);
  const workPkg = path.join(dir, "pkg");
  fs.rmSync(workPkg, { recursive: true, force: true });
  execFileSync("7z", ["x", volPath(dir, 0), `-i!${block.name}`, `-o${workPkg}`, "-y"], {
    stdio: "ignore",
  });
  const pkgPath = path.join(workPkg, block.name);
  const mapsDir = path.join(outDir, "maps");
  fs.mkdirSync(mapsDir, { recursive: true });
  await ddsInnerToWebp(
    dir,
    pkgPath,
    `spaces/${id}/mmap.dds`,
    path.join(mapsDir, `${id}.webp`),
    true,
  );
  await ddsInnerToWebp(
    dir,
    pkgPath,
    `spaces/${id}/mmap_comp7.dds`,
    path.join(mapsDir, `${id}_comp7.webp`),
    false,
  );
}

// ---- Minimap markers (base / spawn / control point) --------------------------
// The game's own minimap entry icons live baked in the client battle atlas
// (`gui/flash/atlases/battleAtlas.dds`, a 4096-wide DXT5 sheet with an XML of
// named sub-textures). They are region-agnostic GUI, so we source the atlas from
// the sibling `unicum-gg/wot.assets` mirror (which already extracts the client's
// `gui/**` binaries) rather than re-deriving it here, decode the DXT5, and crop
// the named sprites into standalone PNGs under `<out>/markers/`.
const WOT_ASSETS_RAW =
  "https://raw.githubusercontent.com/unicum-gg/wot.assets/WG/gui/flash/atlases/battleAtlas";
const MARKER_SCALE = 2; // 64px atlas sprites -> crisp 128px PNGs

// Output file name -> atlas sub-texture name. Ally reads green, enemy red, as
// in-game. Spawn points are numbered 1..4.
function markerSprites(): Record<string, string> {
  const out: Record<string, string> = {
    base_ally: "AllyTeamBaseEntry_green_0",
    base_enemy: "EnemyTeamBaseEntry_red_0",
    control_point: "ControlPointEntry_0",
  };
  for (let i = 1; i <= 4; i++) {
    out[`spawn_ally_${i}`] = `AllyTeamSpawnEntry_green_${i}`;
    out[`spawn_enemy_${i}`] = `EnemyTeamSpawnEntry_red_${i}`;
  }
  return out;
}

type Rect = { x: number; y: number; w: number; h: number };

function parseAtlasXml(xml: string): Map<string, Rect> {
  const rects = new Map<string, Rect>();
  const re =
    /<SubTexture>\s*<name>\s*([^<\s]+)\s*<\/name>\s*<x>\s*(\d+)\s*<\/x>\s*<y>\s*(\d+)\s*<\/y>\s*<width>\s*(\d+)\s*<\/width>\s*<height>\s*(\d+)\s*<\/height>/g;
  for (const m of xml.matchAll(re)) {
    rects.set(m[1], { x: +m[2], y: +m[3], w: +m[4], h: +m[5] });
  }
  return rects;
}

async function generateMarkers(): Promise<void> {
  console.log("[wot.maps] extracting minimap markers from battleAtlas...");
  const [xml, dds] = await Promise.all([
    getText(`${WOT_ASSETS_RAW}.xml`),
    getBuffer(`${WOT_ASSETS_RAW}.dds`),
  ]);
  const rects = parseAtlasXml(xml);
  const { width, height, rgba } = decodeDDS(dds);
  const markersDir = path.join(outDir, "markers");
  fs.mkdirSync(markersDir, { recursive: true });
  let ok = 0;
  const missing: string[] = [];
  for (const [name, sprite] of Object.entries(markerSprites())) {
    const r = rects.get(sprite);
    if (!r) {
      missing.push(sprite);
      continue;
    }
    await sharp(rgba, { raw: { width, height, channels: 4 } })
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
      .resize(r.w * MARKER_SCALE, r.h * MARKER_SCALE, { kernel: "lanczos3" })
      .png({ compressionLevel: 9 })
      .toFile(path.join(markersDir, `${name}.png`));
    ok++;
  }

  // Composite markers: a shared disc background + a per-type glyph. The Onslaught
  // points of interest are `poiMarkerBack` + `poiMarkerIcon_{type}` (1 = strike,
  // 2 = recon).
  const crop = (r: Rect) =>
    sharp(rgba, { raw: { width, height, channels: 4 } })
      .extract({ left: r.x, top: r.y, width: r.w, height: r.h })
      .resize(r.w * MARKER_SCALE, r.h * MARKER_SCALE, { kernel: "lanczos3" })
      .png()
      .toBuffer();
  const composites: Record<string, [string, string]> = {
    poi_strike: ["poiMarkerBack", "poiMarkerIcon_1"],
    poi_recon: ["poiMarkerBack", "poiMarkerIcon_2"],
  };
  for (const [name, [backName, iconName]] of Object.entries(composites)) {
    const back = rects.get(backName);
    const icon = rects.get(iconName);
    if (!back || !icon) {
      missing.push(name);
      continue;
    }
    await sharp(await crop(back))
      .composite([{ input: await crop(icon), gravity: "center" }])
      .png({ compressionLevel: 9 })
      .toFile(path.join(markersDir, `${name}.png`));
    ok++;
  }

  console.log(
    `[wot.maps] markers: ${ok} written to ${markersDir}${missing.length ? `, missing: ${missing.join(", ")}` : ""}`,
  );
}

// The content parts that hold `res/packages/<id>.pkg` map packages: the classic
// maps ship in `client`, everything else in `sdcontent`.
const CONTENT_PARTS = PART_OVERRIDE ? [PART_OVERRIDE] : ["client", "sdcontent"];

type PartArchive = { volumes: Volume[]; sizes: number[]; dir: string };

async function main(): Promise<void> {
  console.log("[wot.maps] resolving install chain via WGUS...");
  const { version, getVolumes } = await resolveClient();
  console.log(`[wot.maps] client ${version}`);

  // Cheap up-to-date guard for the sync cron: if the mirror already holds this
  // exact client version, skip the multi-GB re-extraction entirely. `--force`
  // overrides. The version is stamped into `<out>/.metadata_version`.
  const versionFile = path.join(outDir, ".metadata_version");
  const current = fs.existsSync(versionFile)
    ? fs.readFileSync(versionFile, "utf8").trim()
    : null;
  if (current === version && !args.includes("--force")) {
    console.log(`[wot.maps] already at ${version} — nothing to do`);
    return;
  }

  // Index every map across the content parts (a map lives in exactly one part;
  // `client` wins over `sdcontent` for the rare id present in both).
  const dirs: string[] = [];
  const byId = new Map<string, { archive: PartArchive; block: Block }>();
  for (const part of CONTENT_PARTS) {
    const volumes = getVolumes(part);
    if (volumes.length === 0) {
      console.warn(`[wot.maps] no ${part} volumes`);
      continue;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wotmaps-"));
    dirs.push(dir);
    const sizes = await buildSparse(dir, volumes);
    const idx = indexArchive(volPath(dir, 0));
    const archive: PartArchive = { volumes, sizes, dir };
    for (const [id, block] of idx) if (!byId.has(id)) byId.set(id, { archive, block });
    console.log(`[wot.maps] ${part}: ${idx.size} map packages`);
  }

  const ids = wantAll ? [...byId.keys()] : explicitIds.length ? explicitIds : ["01_karelia"];
  let ok = 0;
  const missing: string[] = [];
  for (const id of ids) {
    const entry = byId.get(id);
    if (!entry) {
      missing.push(id);
      console.warn(`  ? ${id}: not found`);
      continue;
    }
    try {
      const { archive, block } = entry;
      await extractMap(archive.dir, archive.volumes, archive.sizes, block, id);
      ok++;
      console.log(`  ✓ ${id} (${(block.comp / 1e6).toFixed(1)} MB block)`);
    } catch (e) {
      missing.push(id);
      console.warn(`  ✗ ${id}: ${(e as Error).message}`);
    }
  }
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
  if (ok > 0) fs.writeFileSync(versionFile, `${version}\n`);
  console.log(
    `[wot.maps] done: ${ok} written to ${outDir}${missing.length ? `, missing: ${missing.join(", ")}` : ""}`,
  );
}

const entry = args.includes("--markers") ? generateMarkers : main;
entry().catch((e) => {
  console.error(e);
  process.exit(1);
});
