/*
 * The town plan (metres). x runs east, z runs south; the Electrosparkzz building
 * sits on the main street at x −12…12, z −20…0. The sea is to the west, as it is
 * in Kasaragod.
 *
 *            coast      west avenue      east avenue      ring
 *   z −95  ──┼──────────────┼────────────────┼──────────────┼──  north road
 *   z  10  ──┼──────────────┼──── [ES] ──────┼──────────────┼──  main street
 *   z 115  ──┼──────────────┼────────────────┼──────────────┼──  south road
 *   beach & sea west of x −210
 */

export interface Road {
  id: string;
  /** 'x' runs east–west at z = c; 'z' runs north–south at x = c */
  axis: 'x' | 'z';
  c: number;
  from: number;
  to: number;
  /** carriageway width */
  w: number;
  name: string;
}

export const ROADS: Road[] = [
  { id: 'main', axis: 'x', c: 10, from: -205, to: 205, w: 10, name: 'Main Street' },
  { id: 'north', axis: 'x', c: -95, from: -205, to: 205, w: 8, name: 'Temple Road' },
  { id: 'south', axis: 'x', c: 115, from: -205, to: 205, w: 8, name: 'School Road' },
  { id: 'coast', axis: 'z', c: -205, from: -205, to: 225, w: 9, name: 'Beach Road' },
  { id: 'west', axis: 'z', c: -100, from: -95, to: 115, w: 8, name: 'Market Avenue' },
  { id: 'east', axis: 'z', c: 100, from: -95, to: 115, w: 8, name: 'Station Avenue' },
  { id: 'ring', axis: 'z', c: 205, from: -95, to: 115, w: 8, name: 'Hill Road' },
];

export const roadById = (id: string) => ROADS.find((r) => r.id === id)!;

/** Where you can go: the sea stops you at x −290, hills everywhere else. */
export const BOUNDS = { minX: -290, maxX: 222, minZ: -212, maxZ: 232 };

/** The beach: promenade, then sand sloping into the sea. */
export const BEACH = { promenade: -209.5, sandTop: -213, waterline: -262, sandBottom: -290, drop: 1.9 };
/** Height of the sand at x (0 at the promenade, under water past the waterline). */
export const sandHeight = (x: number) => (x >= BEACH.sandTop ? 0 : (-(BEACH.sandTop - x) / (BEACH.sandTop - BEACH.sandBottom)) * BEACH.drop);
export const SEA_LEVEL = sandHeight(BEACH.waterline);

/** Big open places in the town (kept free of houses). */
export const PLACES = {
  ground: { x0: -78, x1: -26, z0: -72, z1: -30, name: 'Football ground' },
  market: { x0: 26, x1: 78, z0: -72, z1: -34, name: 'Market' },
};

/** Is (x, z) on a road's carriageway (with an optional margin)? */
export function onRoad(x: number, z: number, margin = 0) {
  return ROADS.some((r) => {
    const along = r.axis === 'x' ? x : z;
    const across = r.axis === 'x' ? z : x;
    return along > r.from - margin && along < r.to + margin && Math.abs(across - r.c) < r.w / 2 + margin;
  });
}

/** Points along `axis` where other roads cross or meet this one. */
export function junctions(road: Road) {
  return ROADS.filter((o) => o.axis !== road.axis && road.c >= o.from - 1 && road.c <= o.to + 1 && o.c >= road.from - 1 && o.c <= road.to + 1).map((o) => ({ at: o.c, half: o.w / 2 }));
}

/** Stretches of a road between junctions (each shortened by `pad` at a junction). */
export function segmentsOf(road: Road, pad = 0.5): [number, number][] {
  const cuts = junctions(road)
    .map((j) => [j.at - j.half - pad, j.at + j.half + pad])
    .sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let a = road.from;
  for (const [c0, c1] of cuts) {
    if (c0 > a) out.push([a, c0]);
    a = Math.max(a, c1);
  }
  if (a < road.to) out.push([a, road.to]);
  return out.filter(([x, y]) => y - x > 1);
}

/** Deterministic randomness so the town looks the same for everyone */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
