import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { applyWetness, canvasTexture, usePBR } from './materials';
import { noRaycast } from './merge';
import { world } from './state';
import { getMeta, hasTile, loadTile, tileGround, useMeta, type Meta, type Tile } from './map';
import { bastion, hash, inRing, Kit, keralaBuilding, offsetRing, simplify, wallLine, type MatKey, type SignSpec, type Solid, type V2 } from './Kit';

/*
 * Kasaragod's landmarks, modelled: Bekal Fort on its headland, Chandragiri and Hosdurg
 * forts, the lake temple at Ananthapura, Madhur's three-tiered temple, the Malik Deenar
 * mosque and Nileshwar palace. Each is placed by latitude and longitude and drawn in its
 * own metres (x east, z south) from there; the plans follow OpenStreetMap where it has them
 * (Bekal's walls run along the walk inside its ramparts; its towers are where OSM has them).
 *
 * The town's ordinary buildings and trees keep out of each landmark's grounds (`inLandmark`).
 */

interface Def {
  id: string;
  lat: number;
  lon: number;
  /** how far it reaches from its anchor (metres) */
  r: number;
  /** its grounds: plain buildings and trees stay out (own metres) */
  clear: V2[][];
  build: (k: Kit) => void;
}

/* ── Bekal Fort ───────────────────────────────────────────────── */

// the walk just inside the ramparts (OSM way 670423488), from the main gate round
const BEKAL_WALK: V2[] = [[9, 10], [24, 13], [62, 20], [92, 30], [120, 39], [148, 48], [177, 131], [175, 162], [182, 176], [171, 199], [166, 222], [168, 245], [184, 277], [162, 288], [157, 299], [148, 318], [131, 338], [98, 346], [64, 361], [34, 372], [-18, 342], [-40, 329], [-103, 298], [-131, 265], [-146, 244], [-155, 221], [-178, 163], [-190, 128], [-209, 75], [-178, 68], [-158, 64], [-102, 39], [-89, 33], [-47, 19], [-16, 14]];
const BEKAL_WALL = offsetRing(simplify(BEKAL_WALK, 6), 5);
// the zig-zag way in, through the outer gate (OSM 670423487)
const BEKAL_ZIGZAG: V2[] = [[11, -66], [10, -57], [4, -29], [-5, -27], [-7, -10], [11, -6], [9, 5]];
const BEKAL_GATE: V2 = [9.5, 6];
const TEMPLE_BOX = { x0: -17.5, x1: -2.5, z0: -7.5, z1: 12.5 };
const COUNTER_BOX = { x0: -5, x1: 7.5, z0: -5, z1: 7.5 };
const inBox = (b: { x0: number; x1: number; z0: number; z1: number }, x: number, z: number, pad = 0) => x > b.x0 - pad && x < b.x1 + pad && z > b.z0 - pad && z < b.z1 + pad;

function bekal(k: Kit) {
  const H = 8.5;
  const T = 3.2;
  const pieces = wallLine(k, BEKAL_WALL, { closed: true, h: H, thick: T, parapet: true, holes: true, skip: (x, z) => Math.hypot(x - BEKAL_GATE[0], z - BEKAL_GATE[1]) < 4.5 });
  // round bastions where the wall turns
  let last: V2 = [1e9, 1e9];
  const n = BEKAL_WALL.length;
  BEKAL_WALL.forEach((p, i) => {
    const a = BEKAL_WALL[(i - 1 + n) % n];
    const b = BEKAL_WALL[(i + 1) % n];
    const d0 = Math.atan2(p[1] - a[1], p[0] - a[0]);
    const d1 = Math.atan2(b[1] - p[1], b[0] - p[0]);
    let turn = Math.abs(d1 - d0);
    if (turn > Math.PI) turn = 2 * Math.PI - turn;
    if (turn < 0.38 || Math.hypot(p[0] - last[0], p[1] - last[1]) < 28 || Math.hypot(p[0] - BEKAL_GATE[0], p[1] - BEKAL_GATE[1]) < 12) return;
    bastion(k, p[0], p[1], 6.2, H + 1.2, { holes: true });
    last = p;
  });
  // the main gate: two massive piers and a lintel, the wall's height
  const g = k.gy(BEKAL_GATE[0], BEKAL_GATE[1]);
  k.at(BEKAL_GATE[0], BEKAL_GATE[1], Math.atan2(-(24 - 9), 13 - 10) + Math.PI / 2, () => {
    for (const s of [-1, 1]) {
      k.box('laterite', s * 4.6, g - 2, 0, 4.2, H + 4.4, T + 2, 0, true);
      bastion(k, s * 6.6, -2.6, 3.6, H + 2.5, { holes: true });
    }
    k.box('laterite', 0, g + 4.6, 0, 5.2, H - 2.6, T + 1.2, 0, true);
    k.box('dark', 0, g + 3.2, -T / 2 - 0.62, 4.8, 1.6, 0.1);
    k.box('wood', 0, g + 4.4, 0, 5.4, 0.3, T + 1.3);
  });
  // the zig-zag passage: walls either side, an outer gate where it turns in
  for (const s of [-1, 1]) {
    const side: V2[] = BEKAL_ZIGZAG.map((p, i) => {
      const a = BEKAL_ZIGZAG[Math.max(0, i - 1)];
      const b = BEKAL_ZIGZAG[Math.min(BEKAL_ZIGZAG.length - 1, i + 1)];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return [p[0] - (s * 3.6 * (b[1] - a[1])) / L, p[1] + (s * 3.6 * (b[0] - a[0])) / L];
    });
    wallLine(k, side.slice(0, -1), { h: 4.6, thick: 1.4, holes: true, skip: (x, z) => inBox(TEMPLE_BOX, x, z, 1.5) || inBox(COUNTER_BOX, x, z, 1.5) || Math.hypot(x - BEKAL_GATE[0], z - BEKAL_GATE[1]) < 6 });
  }
  const og = k.gy(10, -57);
  k.at(10, -57, 0, () => {
    for (const s of [-1, 1]) k.box('laterite', s * 3.2, og - 1, 0, 1.6, 7.4, 2.6, 0, true);
    k.box('laterite', 0, og + 4.6, 0, 8, 1.8, 2.6, 0, true);
  });
  // the observation tower Tipu Sultan built, in the middle, and the ramp up to it
  const towerTop = bastion(k, 76, 111, 8, 9.5, { holes: true });
  const ramp0: V2 = [55, 131];
  const dir: V2 = [(76 - 55) / 29, (111 - 131) / 29];
  const rampEnd: V2 = [ramp0[0] + dir[0] * 21.6, ramp0[1] + dir[1] * 21.6];
  k.ramp('laterite', ramp0, rampEnd, k.gy(ramp0[0], ramp0[1]) + 0.05, towerTop, 4);
  // the inner towers (OSM)
  bastion(k, 75, 213, 4.6, 7, { holes: true });
  bastion(k, -135, 179, 8, 8, { holes: true });
  bastion(k, 146, 280, 4.8, 7, { holes: true });
  // the magazine: low, thick, half sunk
  const mg = k.gy(54, 202);
  k.at(54, 202, Math.atan2(-(197 - 199), 62 - 45), () => {
    k.box('laterite', 0, mg - 1.5, 0, 18, 4.6, 8, 0, true);
    k.box('laterite', 0, mg + 3.1, 0, 17, 0.6, 7);
    k.box('dark', 0, mg, 4.03, 1.6, 2.1, 0.06);
  });
  // ramps up onto the ramparts, along the wall on the inside
  for (const f of [0.18, 0.5, 0.78]) {
    const p = pieces[Math.floor(pieces.length * f)];
    if (!p) continue;
    const ux = p.b[0] - p.a[0];
    const uz = p.b[1] - p.a[1];
    const L = Math.hypot(ux, uz);
    const inX = -p.out[0] * (T / 2 + 1.8);
    const inZ = -p.out[1] * (T / 2 + 1.8);
    const end: V2 = [(p.a[0] + p.b[0]) / 2 + inX, (p.a[1] + p.b[1]) / 2 + inZ];
    const start: V2 = [end[0] - (ux / L) * 22, end[1] - (uz / L) * 22];
    k.ramp('laterite', start, end, k.gy(start[0], start[1]) + 0.05, p.top, 3.6);
  }
  // Sri Mukhyaprana (Hanuman) temple at the gate, and the ticket counter
  k.at(-10, 2.5, Math.PI / 2, () => keralaBuilding(k, 16, 11, { tiers: 2, wall: 'plaster', roofH: 4.2, gables: true, finials: 1 }));
  k.at(1, 1, 0, () => keralaBuilding(k, 8, 7, { wallH: 3, roofH: 2.6, plinth: 0.5 }));
  k.sign(16, -40, -Math.PI / 2 + 0.2, 'BEKAL FORT', 'ബേക്കൽ കോട്ട · 17th century');
}

/* ── Chandragiri Fort ─────────────────────────────────────────── */

const CHANDRAGIRI_WALK: V2[] = [[-83, -52], [-51, -54], [-31, -55], [-4, -63], [23, -68], [50, -72], [51, -80], [53, -95], [55, -108], [58, -120], [59, -139], [58, -166], [57, -183], [54, -207], [52, -223], [27, -220], [11, -223], [2, -209], [-6, -194], [-15, -176], [-32, -150], [-40, -134], [-55, -110], [-70, -86], [-79, -71], [-89, -53]];
const CHANDRAGIRI_WALL = offsetRing(CHANDRAGIRI_WALK, 5);

function chandragiri(k: Kit) {
  // in ruins: some lengths stand, some have come down; ways in east and west
  const gates: V2[] = [[63, -150], [-40, -142]];
  wallLine(k, CHANDRAGIRI_WALL, { closed: true, h: 6.5, thick: 2.6, parapet: true, holes: true, ruin: 0.22, seed: 7, skip: (x, z) => gates.some((g) => Math.hypot(x - g[0], z - g[1]) < 4.5) });
  // eight bastions; the biggest on the north
  for (const [x, z, r] of [[33, -230, 9.5], [57, -228, 6.5], [7, -228, 6.5], [61, -64, 7], [-95, -50, 7], [64, -105, 5.5], [-64, -99, 5.5], [-21, -170, 5.5]] as [number, number, number][]) bastion(k, x, z, r, 7.5, { holes: true });
  // roofless barracks
  k.tinted('#ffffff', () => {
    for (const [x, z, w, d] of [[5, -150, 22, 8], [22, -112, 14, 7], [-18, -95, 12, 6]]) {
      const g = k.gy(x, z);
      const ring: V2[] = [[x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x + w / 2, z + d / 2], [x - w / 2, z + d / 2], [x - w / 2 + 2, z - d / 2]];
      wallLine(k, ring.slice(0, 4), { closed: true, h: 1.6 + hash(x, z) * 1.4, thick: 0.6, ruin: 0.35, seed: x });
      k.box('dark', x, g - 0.2, z, 0.1, 0.1, 0.1);
    }
  }, 0.85);
  k.sign(70, -158, Math.PI / 2, 'CHANDRAGIRI FORT', 'ചന്ദ്രഗിരി കോട്ട');
}

/* ── Hosdurg Fort ─────────────────────────────────────────────── */

const HOSDURG: V2[] = [[34, 6], [25, 8], [15, 11], [6, 13], [-6, 16], [-14, 19], [-25, 19], [-27, 13], [-30, 5], [-34, -5], [-34, -11], [-28, -14], [-23, -16], [-19, -13], [-14, -14], [-6, -17], [1, -18], [5, -16], [12, -12], [21, -5], [28, -2], [34, -3], [35, 0], [37, 6]];
const HOSDURG_WALL = offsetRing(HOSDURG, 2);

function hosdurg(k: Kit) {
  const gate: V2 = [-10, 21];
  wallLine(k, HOSDURG_WALL, { closed: true, h: 7, thick: 2.6, parapet: true, holes: true, skip: (x, z) => Math.hypot(x - gate[0], z - gate[1]) < 3.5 });
  for (const [x, z] of [[-27, 20], [-36, -12], [-23, -18], [3, -20], [37, -4], [37, 8], [8, 15]] as V2[]) bastion(k, x, z, 4.8, 8, { holes: true });
  k.sign(-10, 30, 0, 'HOSDURG FORT', 'ഹൊസ്ദുർഗ് കോട്ട');
}

/* ── Ananthapura Lake Temple ──────────────────────────────────── */

// the temple's island and the causeway to the east bank (OSM 748582458)
const ANANTHA_ISLAND: V2[] = [[-3, -2], [-4, -6], [-15, -6], [-15, 7], [-4, 7], [-3, 3], [9, 4], [15, 4], [15, -4], [12, -3]];
const ANANTHA_SHORE: V2[] = [[14, 5], [14, 10], [14, 20], [10, 32], [-26, 29], [-31, 25], [-31, 9], [-36, 9], [-37, -20], [-33, -21], [-32, -25], [-11, -27], [2, -24], [4, -15], [14, -16], [13, -4]];

function ananthapura(k: Kit) {
  let lo = Infinity;
  for (const [x, z] of ANANTHA_ISLAND) lo = Math.min(lo, k.gy(x, z));
  const deck = lo + 1.1;
  k.prism('laterite', ANANTHA_ISLAND, lo - 1.5, deck, 'paving');
  k.solids.push(
    { kind: 'box', c: new THREE.Vector3(-9, (lo - 1.5 + deck) / 2, 0.5), q: new THREE.Quaternion(), h: new THREE.Vector3(6, (deck - lo + 1.5) / 2, 6.5) },
    { kind: 'box', c: new THREE.Vector3(6, (lo - 1.5 + deck) / 2, 0), q: new THREE.Quaternion(), h: new THREE.Vector3(9, (deck - lo + 1.5) / 2, 3.5) }
  );
  // the sreekovil: square, laterite, two tiers of tiles and a gold finial
  k.at(-9, 0.5, -Math.PI / 2, () => keralaBuilding(k, 7, 7, { plinth: deck - k.gy(0, 0) + 0.5, wall: 'laterite', wallH: 3.2, tiers: 2, roofH: 3.4, finials: 1 }));
  // a covered way along the causeway, on wooden posts
  k.at(6, 0, 0, () => {
    for (let x = -7.5; x <= 7.5; x += 3) for (const s of [-1, 1]) k.box('wood', x, deck, s * 2.6, 0.3, 2.7, 0.3, 0, true);
    k.keralaRoof('tiles', 17, 5.4, deck + 2.7, 1.9, { overhang: 0.6 });
  });
  // the stepped laterite edge of the lake
  wallLine(k, offsetRing(ANANTHA_SHORE, 0).map((p) => p), { h: 0.8, thick: 1.6 });
  k.sign(19, 9, Math.PI / 2, 'ANANTHAPURA LAKE TEMPLE', 'അനന്തപുരം തടാക ക്ഷേത്രം');
}

/* ── Madhur temple ────────────────────────────────────────────── */

function madhur(k: Kit) {
  // the compound: laterite wall, gate tower on the east (towards the river)
  const C: V2[] = [[-42, -32], [22, -32], [22, 32], [-42, 32]];
  wallLine(k, C, { closed: true, h: 2.4, thick: 0.9, skip: (x, z) => x > 20 && Math.abs(z) < 3.5 });
  k.at(22, 0, Math.PI / 2, () => keralaBuilding(k, 11, 7, { wall: 'laterite', wallH: 3.2, upper: { h: 2.4, mat: 'wood' }, roofH: 3.4, gables: true, finials: 1, plinth: 0.6 }));
  // the nalambalam: a cloister round the shrine
  for (const [x, z, w, d, yaw] of [[-10, -17, 40, 6, 0], [-10, 17, 40, 6, Math.PI], [-27, 0, 28, 6, Math.PI / 2], [7, -10.5, 15, 6, -Math.PI / 2], [7, 10.5, 15, 6, -Math.PI / 2]] as number[][])
    k.at(x, z, yaw, () => keralaBuilding(k, w, d, { wallH: 2.8, roofH: 2.4, doors: false, plinth: 0.7 }));
  // the namaskara mandapam
  k.at(1, 0, 0, () => keralaBuilding(k, 5, 5, { open: true, wallH: 2.6, roof: 'copper', roofH: 2.2, finials: 1, plinth: 0.8 }));
  // the shrine: apsidal ("elephant's back"), three tiers of copper, three gold finials
  k.at(-12, 0, 0, () => keralaBuilding(k, 17, 11, { plinth: 1.3, wall: 'wood', wallH: 3.6, roof: 'copper', tiers: 3, roofH: 4.6, apse: true, finials: 3 }));
  // the gold flagstaff and the brass lamp tower
  const g = k.gy(12, 0);
  k.box('stone', 12, g - 0.5, 0, 2, 1.6, 2, 0, true);
  k.lathe('gold', 12, g + 1.1, 0, [[0.32, 0], [0.22, 12], [0.12, 12.4], [0, 12.6]], 10);
  for (let i = 0; i < 6; i++) k.box('gold', 12, g + 2.6 + i * 1.6, 0, 1.1, 0.1, 0.25);
  const gl = k.gy(16, 5);
  k.lathe('gold', 16, gl, 5, [[0.7, 0], [0.25, 0.6], [0.2, 4.6], [0.05, 5]], 10);
  for (let i = 0; i < 9; i++) k.lathe('gold', 16, gl + 0.8 + i * 0.45, 5, [[0.25, 0], [0.75 - i * 0.05, 0.06], [0.75 - i * 0.05, 0.1], [0.25, 0.12]], 12);
  k.sign(30, 6, Math.PI / 2, 'MADHUR TEMPLE', 'മധൂർ ശ്രീ മദനന്തേശ്വര സിദ്ധിവിനായക ക്ഷേത്രം');
}

/* ── Malik Deenar Juma Masjid ─────────────────────────────────── */

function malikDeenar(k: Kit) {
  // the front faces east-south-east: worshippers face Mecca, west-north-west
  k.at(0, 0, 1.17, () => {
    // the old Kerala mosque: white walls, a wooden upper storey, two tiers of tiles
    const { base } = keralaBuilding(k, 26, 16, { wall: 'plaster', wallH: 4.6, upper: { h: 2.8, mat: 'wood' }, tiers: 2, roofH: 5, gables: true, finials: 1, doors: true });
    // the new front: a white arcade with a dome at each end and a minaret
    const z0 = 8 + 3.6;
    for (let i = 0; i <= 7; i++) k.box('white', -13 + (26 * i) / 7, base, z0 + 3, 0.7, 4.4, 0.7, 0, true);
    k.box('white', 0, base + 4.4, z0, 27, 1.2, 7.2, 0, true);
    k.box('white', 0, base + 5.6, z0 + 3.4, 27, 0.9, 0.3);
    k.box('stone', 0, base - 0.9, z0, 27, 0.9, 7.2, 0, true);
    for (let i = 0; i < 7; i++) k.box('dark', -13 + (26 * (i + 0.5)) / 7, base + 3.2, z0 + 3.38, 2.4, 0.5, 0.05);
    for (const s of [-1, 1]) k.dome('white', s * 10.5, base + 5.6, z0, 2.6);
    k.lathe('white', -15.5, base - 0.9, z0 + 2, [[1.6, 0], [1.4, 18], [2.1, 18.2], [2.1, 19], [1.2, 19.2], [1.1, 25], [1.7, 25.2], [1.7, 25.8], [0.9, 26], [0, 26]], 8, Math.PI / 8);
    k.dome('green', -15.5, base + 25, z0 + 2, 1.0);
    // the compound wall
    wallLine(k, [[-22, -16], [22, -16], [22, 22], [3, 22]], { h: 1.6, thick: 0.4, mat: 'white' });
    wallLine(k, [[-3, 22], [-22, 22], [-22, -16]], { h: 1.6, thick: 0.4, mat: 'white' });
  });
  k.sign(14, 24, 1.17, 'MALIK DEENAR JUMA MASJID', 'മാലിക് ദീനാർ ജുമാ മസ്ജിദ്');
}

/* ── Nileshwar Palace ─────────────────────────────────────────── */

function nileshwar(k: Kit) {
  k.at(2.5, 1.5, 0, () => keralaBuilding(k, 19, 17, { wall: 'plaster', wallH: 3.6, upper: { h: 3, mat: 'wood' }, roofH: 5.5, gables: true, finials: 1 }));
  k.sign(2.5, 16, 0, 'NILESHWAR PALACE', 'നീലേശ്വരം കോവിലകം');
}

const rect = (x0: number, z0: number, x1: number, z1: number): V2[] => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

const DEFS: Def[] = [
  { id: 'bekal', lat: 12.39385, lon: 75.03291, r: 420, clear: [offsetRing(BEKAL_WALL, 10), rect(-25, -72, 22, 14)], build: bekal },
  { id: 'chandragiri', lat: 12.4685, lon: 75.0032, r: 220, clear: [offsetRing(CHANDRAGIRI_WALL, 12)], build: chandragiri },
  { id: 'hosdurg', lat: 12.30907, lon: 75.09467, r: 80, clear: [offsetRing(HOSDURG_WALL, 8)], build: hosdurg },
  { id: 'ananthapura', lat: 12.5842, lon: 74.98206, r: 60, clear: [rect(-40, -30, 22, 36)], build: ananthapura },
  { id: 'madhur', lat: 12.55349, lon: 75.01018, r: 60, clear: [rect(-48, -38, 36, 38)], build: madhur },
  { id: 'malik', lat: 12.4849, lon: 74.989, r: 50, clear: [rect(-30, -30, 30, 32)], build: malikDeenar },
  { id: 'nileshwar', lat: 12.25624, lon: 75.12926, r: 30, clear: [rect(-12, -12, 17, 19)], build: nileshwar },
];

/* ── Placing ──────────────────────────────────────────────────── */

interface Placed {
  def: Def;
  x: number;
  z: number;
  /** the world turns by this from east/south */
  yaw: number;
  clear: V2[][];
  box: [number, number, number, number];
}

let placedFor: Meta | null = null;
let placed: Placed[] = [];

/** Each landmark's world position and grounds (once the map's frame is known). */
function placeAll(meta: Meta | null) {
  if (meta === placedFor) return placed;
  placedFor = meta;
  const f = meta?.frame;
  if (!meta || !f) return (placed = []);
  const kx = f.kx;
  const kz = f.kz;
  placed = DEFS.map((def) => {
    const ex = (def.lon - meta.site.lon) * kx - f.origin[0];
    const ez = -(def.lat - meta.site.lat) * kz - f.origin[1];
    const x = ex * f.ax[0] + ez * f.ax[1];
    const z = ex * f.az[0] + ez * f.az[1];
    const toWorld = ([lx, lz]: V2): V2 => [x + lx * f.ax[0] + lz * f.ax[1], z + lx * f.az[0] + lz * f.az[1]];
    const clear = def.clear.map((r) => r.map(toWorld));
    const all = clear.flat();
    const box: [number, number, number, number] = [Math.min(...all.map((p) => p[0])), Math.min(...all.map((p) => p[1])), Math.max(...all.map((p) => p[0])), Math.max(...all.map((p) => p[1]))];
    return { def, x, z, yaw: Math.atan2(f.ax[1], f.ax[0]), clear, box };
  });
  return placed;
}

/** Is (x, z) in a landmark's grounds, where the town's own buildings and trees don't go? */
export function inLandmark(x: number, z: number) {
  for (const p of placeAll(getMeta())) {
    const [x0, z0, x1, z1] = p.box;
    if (x < x0 || x > x1 || z < z0 || z > z1) continue;
    if (p.clear.some((r) => inRing(r, x, z))) return true;
  }
  return false;
}

/* ── Drawing ──────────────────────────────────────────────────── */

/** Laterite: rough, porous red-brown blocks (about 40 × 22 cm), weathered dark — 2 m × 1 m of wall. */
function lateriteTexture() {
  return canvasTexture(512, 256, (g) => {
    g.fillStyle = '#3e2418';
    g.fillRect(0, 0, 512, 256);
    let s = 7;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const rows = 5;
    const rh = 256 / rows;
    const bw = 512 / 5;
    for (let r = 0; r < rows; r++) {
      const y = r * rh;
      for (let x = -(r % 2) * bw * 0.5; x < 512; x += bw) {
        g.fillStyle = `hsl(${10 + rnd() * 12}, ${30 + rnd() * 16}%, ${27 + rnd() * 11}%)`;
        g.fillRect(x + 2, y + 2, bw - 4, rh - 4);
        // laterite is full of little holes
        for (let i = 0; i < 40; i++) {
          g.fillStyle = `rgba(25, 12, 6, ${0.3 + rnd() * 0.4})`;
          g.beginPath();
          g.arc(x + 3 + rnd() * (bw - 6), y + 3 + rnd() * (rh - 6), 0.8 + rnd() * 2.4, 0, Math.PI * 2);
          g.fill();
        }
        // and paler where it's worn
        g.fillStyle = `rgba(190, 140, 110, ${rnd() * 0.12})`;
        g.fillRect(x + 2, y + 2, bw - 4, (rh - 4) * rnd());
      }
    }
    // grime from the monsoons
    for (let i = 0; i < 14; i++) {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 60 + rnd() * 80);
      gr.addColorStop(0, 'rgba(20, 18, 16, 0.16)');
      gr.addColorStop(1, 'rgba(20, 18, 16, 0)');
      g.save();
      g.translate(rnd() * 512, rnd() * 256);
      g.fillStyle = gr;
      g.fillRect(-150, -150, 300, 300);
      g.restore();
    }
  });
}

function woodTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#4a2c1a';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = x % 64 ? '#55331f' : '#4d2e1b';
      g.fillRect(x + 1, 0, 30, 256);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(x, 0, 2, 256);
    }
    for (let i = 0; i < 90; i++) {
      g.strokeStyle = 'rgba(30,15,8,0.25)';
      const x = Math.random() * 256;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + Math.random() * 4 - 2, 256);
      g.stroke();
    }
  });
}

function copperTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#7b5a3a';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 400; i++) {
      g.fillStyle = `rgba(${70 + Math.random() * 40}, ${120 + Math.random() * 40}, ${95 + Math.random() * 30}, ${Math.random() * 0.25})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 20, 2 + Math.random() * 10);
    }
    for (let x = 0; x < 256; x += 32) {
      g.fillStyle = 'rgba(40,25,15,0.55)';
      g.fillRect(x, 0, 3, 256);
    }
  });
}

type Mats = Record<MatKey, THREE.MeshStandardMaterial>;

function useMats(): Mats {
  const stucco = usePBR('white_stucco', [1, 1]);
  const clay = usePBR('clay_roof_tiles', [1, 1]);
  const soil = usePBR('red_laterite_soil_stones', [1, 1]);
  const concrete = usePBR('concrete', [1, 1], { tint: '#9b958b' });
  return useMemo(() => {
    const std = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
    const v = <M extends THREE.MeshStandardMaterial>(m: M, side: THREE.Side = THREE.FrontSide) => {
      const c = Object.assign(m.clone(), { vertexColors: true, side });
      // (cloning turns userData into JSON: the wet look needs a real colour back)
      c.userData = { dryRoughness: m.userData.dryRoughness, baseColor: m.color.clone() };
      return c;
    };
    const laterite = std({ map: lateriteTexture(), roughness: 0.97 });
    laterite.userData.dryRoughness = 0.97;
    laterite.userData.baseColor = laterite.color.clone();
    return {
      laterite,
      plaster: v(stucco),
      tiles: v(clay, THREE.DoubleSide),
      copper: std({ map: copperTexture(), metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide }),
      wood: std({ map: woodTexture(), roughness: 0.8, side: THREE.DoubleSide }),
      stone: v(concrete),
      gold: std({ color: '#d9a82b', metalness: 1, roughness: 0.28 }),
      dark: std({ color: '#15100c', roughness: 1 }),
      paving: v(soil),
      white: std({ color: '#f2f0ea', roughness: 0.75 }),
      water: std({ color: '#2f6a70', roughness: 0.1, metalness: 0.2 }),
      green: std({ color: '#2f7a4f', roughness: 0.5, metalness: 0.2 }),
    };
  }, [stucco, clay, soil, concrete]);
}

function signTexture(s: SignSpec) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 370;
  const g = canvas.getContext('2d')!;
  g.fillStyle = '#5a3a22';
  g.fillRect(0, 0, 1024, 370);
  g.fillStyle = '#f3ead6';
  g.fillRect(18, 18, 988, 334);
  g.fillStyle = '#5a2a14';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  let size = 110;
  g.font = `bold ${size}px system-ui, sans-serif`;
  while (g.measureText(s.text).width > 940 && size > 40) g.font = `bold ${(size -= 4)}px system-ui, sans-serif`;
  g.fillText(s.text, 512, s.sub ? 140 : 185);
  if (s.sub) {
    g.fillStyle = '#7a4a2a';
    let sub = 62;
    g.font = `${sub}px system-ui, sans-serif`;
    while (g.measureText(s.sub).width > 940 && sub > 26) g.font = `${(sub -= 3)}px system-ui, sans-serif`;
    g.fillText(s.sub, 512, 265);
  }
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

interface Built {
  geos: Map<MatKey, THREE.BufferGeometry>;
  solids: Solid[];
  signs: { mesh: THREE.Mesh; texture: THREE.Texture }[];
}

/** Draw within this far of a landmark's edge (the fog hides more), solid within this. */
const SHOW = 1100;
const SOLID = 160;

function LandmarkView({ p, mats }: { p: Placed; mats: Mats }) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [solid, setSolid] = useState(false);
  const group = useRef<THREE.Group>(null);
  const { world: physics, rapier } = useRapier();

  // build once the ground under it has loaded
  useEffect(() => {
    let alive = true;
    const meta = getMeta()!;
    const size = meta.tile;
    const keys = new Set<string>();
    for (let i = Math.floor((p.box[0] - 20) / size); i <= Math.floor((p.box[2] + 20) / size); i++)
      for (let j = Math.floor((p.box[1] - 20) / size); j <= Math.floor((p.box[3] + 20) / size); j++) if (hasTile(`${i}_${j}`)) keys.add(`${i}_${j}`);
    Promise.all([...keys].map(loadTile)).then((list) => {
      if (!alive) return;
      const tiles = new Map<string, Tile>();
      for (const t of list) if (t) tiles.set(t.key, t);
      const c = Math.cos(p.yaw);
      const s = Math.sin(p.yaw);
      const G = (lx: number, lz: number) => {
        const x = p.x + lx * c + lz * s;
        const z = p.z - lx * s + lz * c;
        const t = tiles.get(`${Math.floor(x / size)}_${Math.floor(z / size)}`);
        return t ? tileGround(t, x, z) : 0;
      };
      const k = new Kit(G);
      p.def.build(k);
      const signs = k.signs.map((sg) => {
        const texture = signTexture(sg);
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sg.w, sg.h), new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }));
        mesh.position.copy(sg.c);
        mesh.rotation.y = sg.yaw;
        mesh.raycast = noRaycast;
        return { mesh, texture };
      });
      setBuilt({ geos: k.geometries(), solids: k.solids, signs });
    });
    return () => {
      alive = false;
    };
  }, [p]);
  useEffect(
    () => () => {
      if (!built) return;
      for (const g of built.geos.values()) g.dispose();
      for (const s of built.signs) {
        s.mesh.geometry.dispose();
        (s.mesh.material as THREE.Material).dispose();
        s.texture.dispose();
      }
    },
    [built]
  );

  // solid only when someone could walk into it
  useFrame(() => {
    const pl = world.player;
    const near = pl.x > p.box[0] - SOLID && pl.x < p.box[2] + SOLID && pl.z > p.box[1] - SOLID && pl.z < p.box[3] + SOLID;
    if (near !== solid) setSolid(near);
  });
  useEffect(() => {
    if (!solid || !built) return;
    const q0 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), p.yaw);
    const made: Collider[] = [];
    for (const s of built.solids) {
      const c = s.c.clone().applyQuaternion(q0).add(new THREE.Vector3(p.x, 0, p.z));
      if (s.kind === 'box') {
        const q = q0.clone().multiply(s.q);
        made.push(physics.createCollider(rapier.ColliderDesc.cuboid(s.h.x, s.h.y, s.h.z).setTranslation(c.x, c.y, c.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })));
      } else made.push(physics.createCollider(rapier.ColliderDesc.cylinder(s.hh, s.r).setTranslation(c.x, c.y, c.z)));
    }
    return () => {
      for (const c of made) if (physics.getCollider(c.handle)) physics.removeCollider(c, false);
    };
  }, [solid, built, p, physics, rapier]);

  if (!built) return null;
  return (
    <group ref={group} position={[p.x, 0, p.z]} rotation={[0, p.yaw, 0]}>
      {[...built.geos].map(([m, g]) => (
        <mesh key={m} geometry={g} material={mats[m]} castShadow={m !== 'dark' && m !== 'gold'} receiveShadow raycast={noRaycast} />
      ))}
      {built.signs.map((s, i) => (
        <primitive key={i} object={s.mesh} />
      ))}
    </group>
  );
}

export function Landmarks() {
  const meta = useMeta();
  const all = useMemo(() => placeAll(meta), [meta]);
  const mats = useMats();
  const camera = useThree((s) => s.camera);
  const [shown, setShown] = useState<string[]>([]);
  const last = useRef(0);
  useFrame(({ clock }) => {
    applyWetness([mats.laterite, mats.paving, mats.plaster], world.wet);
    if (clock.elapsedTime - last.current < 0.5) return;
    last.current = clock.elapsedTime;
    const { x, z } = camera.position;
    const next = all.filter((p) => x > p.box[0] - SHOW && x < p.box[2] + SHOW && z > p.box[1] - SHOW && z < p.box[3] + SHOW).map((p) => p.def.id);
    if (next.join() !== shown.join()) setShown(next);
  });
  return (
    <group>
      {all
        .filter((p) => shown.includes(p.def.id))
        .map((p) => (
          <LandmarkView key={p.def.id} p={p} mats={mats} />
        ))}
    </group>
  );
}
