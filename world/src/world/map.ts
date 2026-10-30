import { useSyncExternalStore } from 'react';

/*
 * The real map of Kasaragod district (from OpenStreetMap, made by tools/build-map.mjs):
 * meta.json says where everything is, and each 1 km tile holds its roads, buildings,
 * direction signs and water. Tiles are fetched as you get near them.
 *
 * Tile numbers are in decimetres from the tile's corner.
 */

const BASE = `${import.meta.env.BASE_URL}map/`;

export interface Place {
  n: string;
  k: string;
  x: number;
  z: number;
}

export interface Meta {
  site: { lat: number; lon: number };
  front: string;
  /** which way north is, as an x/z direction */
  north: [number, number];
  tile: number;
  cell: number;
  /** land cover: `cn` cells a side per tile */
  cn?: number;
  /** ground heights every `hstep` metres, `hn` a side per tile (0: flat ground) */
  hstep?: number;
  hn?: number;
  bounds: { x0: number; x1: number; z0: number; z1: number };
  overview: { x0: number; z0: number; mpp: number; w: number; h: number };
  tiles: string[];
  /** the whole district's ground, coarse (metres; over the overview image's area) */
  far?: { x0: number; z0: number; step: number; nx: number; nz: number; g: string } | null;
  places: Place[];
  /** where real roads join the modelled street: shops and footpaths leave these open */
  gaps?: Gap[];
}

export interface Gap {
  x: number;
  /** road width */
  w: number;
  /** 'n': the building's side of the street, 's': across it */
  side: 'n' | 's';
}

export interface TileData {
  /** roads: [class, width, bridge, x, z, x, z, …] (class 8 is the railway) */
  b: number[][];
  /** buildings: [height, seed, x, z, x, z, …] (outline counter-clockwise from above) */
  h: number[][];
  /** building colliders: [cx, cz, half x, half z, angle, height] */
  o: number[][];
  /** direction signs to the building: [x, z, angle to go, metres to go] */
  s: number[][];
  /** water: 1 = all of it, else a base64 bitmask of 5 m cells (row by row) */
  w?: 1 | string;
  /** ground heights: base64 int16 decimetres, row by row from the tile's corner */
  g?: string;
  /** land cover (ESA WorldCover classes), base64 runs of [class, count] row by row */
  c?: string;
}

export interface Tile {
  key: string;
  i: number;
  j: number;
  data: TileData;
  /** one bit per water cell (null: no water) */
  water: Uint8Array | null;
  /** ground heights, metres (null: flat) */
  ground: Float32Array | null;
  /** land cover per cell (null: unknown) */
  cover: Uint8Array | null;
}

export const RAIL = 8;

let meta: Meta | null = null;
let tileSet = new Set<string>();
const loaded = new Map<string, Tile>();
const pending = new Map<string, Promise<Tile | null>>();
const listeners = new Set<() => void>();

export const getMeta = () => meta;
/** The map's meta (null until it loads); re-renders when it arrives. */
export const useMeta = () => useSyncExternalStore(onMapChange, getMeta);
/** Is x (on the street) inside a gap on this side, with `pad` metres to spare? */
export const inGap = (gaps: Gap[] | undefined, side: Gap['side'], x0: number, x1: number, pad = 1.5) =>
  !!gaps?.some((g) => g.side === side && x1 > g.x - g.w / 2 - pad && x0 < g.x + g.w / 2 + pad);
export const loadedTile = (key: string) => loaded.get(key);
export const onMapChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
const changed = () => listeners.forEach((fn) => fn());

let metaPromise: Promise<Meta | null> | null = null;
/** Fetch meta.json (once; after a failure, a later call tries again). */
export function loadMeta() {
  metaPromise ??= fetch(`${BASE}meta.json`)
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((m: Meta) => {
      meta = m;
      tileSet = new Set(m.tiles);
      changed();
      return m;
    })
    .catch(() => {
      // offline for a moment, or a bad response: try again in a few seconds
      setTimeout(() => {
        metaPromise = null;
        loadMeta();
      }, 4000);
      return null;
    });
  return metaPromise;
}

export const tileKey = (x: number, z: number, size = meta?.tile ?? 1000) => `${Math.floor(x / size)}_${Math.floor(z / size)}`;
export const hasTile = (key: string) => tileSet.has(key);

export function loadTile(key: string) {
  if (loaded.has(key)) return Promise.resolve(loaded.get(key)!);
  if (!tileSet.has(key)) return Promise.resolve(null);
  if (!pending.has(key)) {
    pending.set(
      key,
      fetch(`${BASE}t/${key}.json`)
        .then((r) => r.json())
        .then((data: TileData) => {
          const [i, j] = key.split('_').map(Number);
          let water: Uint8Array | null = null;
          if (data.w === 1) water = new Uint8Array(cellsPerTile() ** 2 / 8).fill(255);
          else if (data.w) water = Uint8Array.from(atob(data.w), (c) => c.charCodeAt(0));
          let ground: Float32Array | null = null;
          if (data.g) {
            const b = Uint8Array.from(atob(data.g), (c) => c.charCodeAt(0));
            const dm = new Int16Array(b.buffer);
            ground = Float32Array.from(dm, (v) => v / 10);
          }
          let cover: Uint8Array | null = null;
          const cn = meta?.cn;
          if (data.c && cn) {
            const runs = Uint8Array.from(atob(data.c), (c) => c.charCodeAt(0));
            cover = new Uint8Array(cn * cn);
            let k = 0;
            for (let r = 0; r + 1 < runs.length; r += 2) cover.fill(runs[r], k, (k += runs[r + 1]));
          }
          const tile = { key, i, j, data, water, ground, cover };
          loaded.set(key, tile);
          pending.delete(key);
          changed();
          return tile;
        })
        .catch(() => {
          pending.delete(key);
          return null;
        })
    );
  }
  return pending.get(key)!;
}

/** Forget tiles far from (x, z) so memory doesn't grow as you travel. */
export function forgetTilesFarFrom(x: number, z: number, range: number) {
  const size = meta?.tile ?? 1000;
  for (const [k, t] of loaded) if (boxDistance(t.i * size, t.j * size, size, x, z) > range) loaded.delete(k);
}

export const cellsPerTile = () => (meta ? meta.tile / meta.cell : 200);

/** How far (x, z) is from the square at (x0, z0) of side `size` (0 inside it). */
export function boxDistance(x0: number, z0: number, size: number, x: number, z: number) {
  const dx = Math.max(x0 - x, 0, x - (x0 + size));
  const dz = Math.max(z0 - z, 0, z - (z0 + size));
  return Math.hypot(dx, dz);
}

export const waterAt = (t: Tile, cx: number, cz: number) => {
  if (!t.water) return false;
  const k = cz * cellsPerTile() + cx;
  return !!(t.water[k >> 3] & (1 << (k & 7)));
};

/**
 * Water as rectangles of cells [cx0, cz0, cx1, cz1) (runs along each row, then runs
 * that repeat on the rows below joined into one).
 */
export function waterRects(t: Tile, skip?: (cx: number, cz: number) => boolean) {
  const N = cellsPerTile();
  const out: [number, number, number, number][] = [];
  if (!t.water) return out;
  let open = new Map<string, [number, number, number, number]>();
  for (let cz = 0; cz <= N; cz++) {
    const next = new Map<string, [number, number, number, number]>();
    if (cz < N) {
      let cx = 0;
      while (cx < N) {
        if (!waterAt(t, cx, cz) || skip?.(cx, cz)) {
          cx++;
          continue;
        }
        const a = cx;
        while (cx < N && waterAt(t, cx, cz) && !skip?.(cx, cz)) cx++;
        const id = `${a}_${cx}`;
        const r = open.get(id);
        if (r) {
          r[3] = cz + 1;
          open.delete(id);
          next.set(id, r);
        } else next.set(id, [a, cz, cx, cz + 1]);
      }
    }
    for (const r of open.values()) out.push(r);
    open = next;
  }
  return out;
}

/** Is (x, z) water? (false where the tile hasn't loaded) */
export function isWater(x: number, z: number) {
  if (!meta) return false;
  const t = loaded.get(tileKey(x, z));
  if (!t?.water) return false;
  const size = meta.tile;
  return waterAt(t, Math.floor((x - t.i * size) / meta.cell), Math.floor((z - t.j * size) / meta.cell));
}

/** Height of a tile's ground at (x, z), from its grid. */
export function tileGround(t: Tile, x: number, z: number) {
  const meta = getMeta();
  if (!t.ground || !meta?.hstep || !meta.hn) return 0;
  const n = meta.hn;
  const fx = Math.max(0, Math.min(n - 1.0001, (x - t.i * meta.tile) / meta.hstep));
  const fz = Math.max(0, Math.min(n - 1.0001, (z - t.j * meta.tile) / meta.hstep));
  const q = Math.floor(fx);
  const r = Math.floor(fz);
  const a = fx - q;
  const b = fz - r;
  const g = t.ground;
  // the same two triangles per cell as the physics ground (split corner to corner, +x−z to −x+z)
  const h01 = g[r * n + q + 1];
  const h10 = g[(r + 1) * n + q];
  if (a + b <= 1) {
    const h00 = g[r * n + q];
    return h00 + a * (h01 - h00) + b * (h10 - h00);
  }
  const h11 = g[(r + 1) * n + q + 1];
  return h11 + (1 - a) * (h10 - h11) + (1 - b) * (h01 - h11);
}

/** Ground height at (x, z), metres above the building's street (0 where the tile hasn't loaded). */
export function groundAt(x: number, z: number) {
  const meta = getMeta();
  if (!meta?.hstep) return 0;
  const t = loaded.get(tileKey(x, z));
  return t ? tileGround(t, x, z) : 0;
}

/** What covers the ground at (x, z) on a tile: ESA WorldCover's class (0 if unknown). */
export function tileCover(t: Tile, x: number, z: number) {
  const meta = getMeta();
  if (!t.cover || !meta?.cn) return 0;
  const n = meta.cn;
  const q = Math.min(n - 1, Math.max(0, Math.floor(((x - t.i * meta.tile) / meta.tile) * n)));
  const r = Math.min(n - 1, Math.max(0, Math.floor(((z - t.j * meta.tile) / meta.tile) * n)));
  return t.cover[r * n + q];
}

/** Land-cover classes (ESA WorldCover) */
export const COVER = { trees: 10, shrubs: 20, grass: 30, crops: 40, built: 50, bare: 60, water: 80, wetland: 90, mangroves: 95 } as const;
