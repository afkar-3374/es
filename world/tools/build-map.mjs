// Turns the OpenStreetMap download (tools/fetch-osm.mjs) into the town's map:
//   public/map/meta.json      where everything is, tile list, place names, the overview image
//   public/map/t/<i>_<j>.json one 1 km tile: roads, buildings, direction signs, water
//   public/map/overview.png   the whole district, for the big map (M)
//
//   node tools/build-map.mjs <cache-dir>
//
// World space: metres, x east-ish, z south-ish, rotated so the road in front of the
// Electrosparkzz building runs exactly along x at z = 10 with the building on its −z
// side (the building and its street are modelled that way). Move the building by
// changing SITE and re-running.
import { readdirSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

/** Where the Electrosparkzz building stands (for now: Kasaragod town centre). */
const SITE = { lat: 12.4996, lon: 74.9869 };

const CACHE = process.argv[2];
if (!CACHE) throw new Error('usage: node tools/build-map.mjs <cache-dir>');
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'map');
const TILE = 1000;
const CELL = 5; // water mask resolution (m)
const CELLS = TILE / CELL;
/** Kept clear for the building, its car park, its street and the shops along it (world space). */
const CLEAR_BUILDINGS = { x0: -60, x1: 60, z0: -82, z1: 36 };
const CLEAR_ROADS = { x0: -60, x1: 60, z0: -82, z1: 36 };

/* ── Load ─────────────────────────────────────────────────────── */

const elements = new Map();
let district = null;
for (const f of readdirSync(CACHE)) {
  if (!f.endsWith('.json')) continue;
  const data = JSON.parse(readFileSync(join(CACHE, f), 'utf8'));
  if (f === 'district.json') district = data.elements.find((e) => e.type === 'relation');
  else for (const e of data.elements) elements.set(`${e.type}${e.id}`, e);
}
if (!district) throw new Error('district.json missing');
console.log(`${elements.size} elements`);

/* ── Geometry helpers ─────────────────────────────────────────── */

/** Join open ways into closed rings (relations hand their outlines over in pieces). */
function rings(parts) {
  const open = parts.filter((p) => p.length > 1).map((p) => p.slice());
  const out = [];
  const key = (p) => `${p.lat.toFixed(7)},${p.lon.toFixed(7)}`;
  while (open.length) {
    let ring = open.pop();
    let grew = true;
    while (key(ring[0]) !== key(ring[ring.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const p = open[i];
        const end = key(ring[ring.length - 1]);
        if (key(p[0]) === end) ring = ring.concat(p.slice(1));
        else if (key(p[p.length - 1]) === end) ring = ring.concat(p.slice().reverse().slice(1));
        else if (key(p[p.length - 1]) === key(ring[0])) ring = p.concat(ring.slice(1));
        else if (key(p[0]) === key(ring[0])) ring = p.slice().reverse().concat(ring.slice(1));
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (ring.length >= 4) out.push(ring);
  }
  return out;
}

function inRingLL(ring, lat, lon) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.lat > lat !== b.lat > lat && lon < ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat) + a.lon) inside = !inside;
  }
  return inside;
}

const districtRings = rings(district.members.filter((m) => m.type === 'way' && m.role === 'outer').map((m) => m.geometry));
// a 1.5 km margin round the district, so roads and towns at the border don't stop dead
const MARGIN = 0.014;
function inDistrict(lat, lon) {
  if (districtRings.some((r) => inRingLL(r, lat, lon))) return true;
  for (const [dl, dn] of [[MARGIN, 0], [-MARGIN, 0], [0, MARGIN], [0, -MARGIN]]) if (districtRings.some((r) => inRingLL(r, lat + dl, lon + dn))) return true;
  return false;
}

/* ── Projection ───────────────────────────────────────────────── */

const KX = 111320 * Math.cos((SITE.lat * Math.PI) / 180);
const KZ = 110574;
const enu = (p) => [(p.lon - SITE.lon) * KX, -(p.lat - SITE.lat) * KZ];

const ways = [...elements.values()].filter((e) => e.type === 'way' && e.geometry);
const tag = (e, k) => e.tags?.[k];

const ROAD_CLASS = {
  motorway: 0, trunk: 0, motorway_link: 0, trunk_link: 0,
  primary: 1, primary_link: 1,
  secondary: 2, secondary_link: 2,
  tertiary: 3, tertiary_link: 3,
  residential: 4, unclassified: 4, living_street: 4, road: 4,
  service: 5,
  track: 6,
  footway: 7, path: 7, pedestrian: 7, cycleway: 7, steps: 7, bridleway: 7,
};
const WIDTH = [14, 11, 9.5, 8, 6, 4.5, 3.5, 2];
const SPEED = [70, 55, 45, 38, 25, 15, 10]; // km/h, for picking routes to the building
const roads = ways.filter((w) => tag(w, 'highway') in ROAD_CLASS && tag(w, 'area') !== 'yes' && w.geometry.some((p) => p && inDistrict(p.lat, p.lon)));
console.log(`${roads.length} roads`);

// The street in front of the building: the nearest straight 120 m of a proper road
function pickFrontage() {
  let best = null;
  for (const w of roads) {
    const cls = ROAD_CLASS[tag(w, 'highway')];
    if (cls > 4) continue;
    const pts = w.geometry.map(enu);
    // sample every 5 m along the road
    const samples = [];
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1];
      const [bx, bz] = pts[i];
      const len = Math.hypot(bx - ax, bz - az);
      for (let t = 0; t < len; t += 5) samples.push([ax + ((bx - ax) * t) / len, az + ((bz - az) * t) / len]);
    }
    for (let i = 12; i < samples.length - 12; i++) {
      const [px, pz] = samples[i];
      const far = Math.hypot(px, pz);
      if (far > 1500) continue;
      const a = samples[i - 12];
      const b = samples[i + 12];
      const dx = b[0] - a[0];
      const dz = b[1] - a[1];
      const L = Math.hypot(dx, dz);
      let dev = 0;
      for (let k = i - 12; k <= i + 12; k++) dev = Math.max(dev, Math.abs(((samples[k][0] - a[0]) * dz - (samples[k][1] - a[1]) * dx) / L));
      if (dev > 2.5) continue;
      const score = far + [0, 0, 40, 90, 250][cls];
      if (!best || score < best.score) best = { score, p: [px, pz], d: [dx / L, dz / L], way: w.id, name: tag(w, 'name') ?? '' };
    }
  }
  return best;
}
const front = pickFrontage();
if (!front) throw new Error('no straight road near the site');

// put the building on the side of the road with more room (fewer buildings within 70 m)
const normal = [-front.d[1], front.d[0]];
let sideCount = [0, 0];
for (const w of ways) {
  if (!tag(w, 'building')) continue;
  const [x, z] = enu(w.geometry[0]);
  const rx = x - front.p[0];
  const rz = z - front.p[1];
  if (Math.hypot(rx, rz) > 70) continue;
  sideCount[rx * normal[0] + rz * normal[1] > 0 ? 0 : 1]++;
}
const toBuilding = sideCount[0] <= sideCount[1] ? normal : [-normal[0], -normal[1]];
// world axes: z points away from the building, x along the road (a proper rotation)
const AZ = [-toBuilding[0], -toBuilding[1]];
const AX = [AZ[1], -AZ[0]];
const ORIGIN = [front.p[0] + toBuilding[0] * 10, front.p[1] + toBuilding[1] * 10];
const world = ([x, z]) => {
  const dx = x - ORIGIN[0];
  const dz = z - ORIGIN[1];
  return [dx * AX[0] + dz * AX[1], dx * AZ[0] + dz * AZ[1]];
};
const unworld = ([x, z]) => [ORIGIN[0] + x * AX[0] + z * AZ[0], ORIGIN[1] + x * AX[1] + z * AZ[1]];
const W = (p) => world(enu(p));
// which way north is in the world (for the map and the sun)
const NORTH = [-AX[1], -AZ[1]];
console.log(`front road: ${front.name || '(unnamed)'} way ${front.way}; north = ${NORTH.map((n) => n.toFixed(3))}`);

/* ── Tiles ────────────────────────────────────────────────────── */

const tiles = new Map();
const tileOf = (x, z) => `${Math.floor(x / TILE)}_${Math.floor(z / TILE)}`;
function tileFor(x, z) {
  const k = tileOf(x, z);
  if (!tiles.has(k)) tiles.set(k, { i: Math.floor(x / TILE), j: Math.floor(z / TILE), b: [], h: [], o: [], s: [], wpoly: [], wline: [] });
  return tiles.get(k);
}
const dm = (v) => Math.round(v * 10); // decimetres

const inside = (r, x, z) => x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;

/** Cut a line where it enters the cleared site; returns the pieces outside. */
function clipOut(pts, r) {
  const out = [];
  let cur = [];
  const flush = () => {
    if (cur.length > 1) out.push(cur);
    cur = [];
  };
  const near = (q, p) => Math.max(q[0], p[0]) > r.x0 && Math.min(q[0], p[0]) < r.x1 && Math.max(q[1], p[1]) > r.z0 && Math.min(q[1], p[1]) < r.z1;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (i === 0 || !near(pts[i - 1], p)) {
      if (!inside(r, p[0], p[1])) cur.push(p);
      continue;
    }
    // the segment passes the site: walk it in 1 m steps
    const q = pts[i - 1];
    const n = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1])));
    for (let k = 1; k <= n; k++) {
      const s = k === n ? p : [q[0] + ((p[0] - q[0]) * k) / n, q[1] + ((p[1] - q[1]) * k) / n];
      if (inside(r, s[0], s[1])) flush();
      else cur.push(s);
    }
  }
  flush();
  return out;
}

/** Drop points that barely change the line (Douglas–Peucker). */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, az] = pts[a];
    const [bx, bz] = pts[b];
    const L = Math.hypot(bx - ax, bz - az);
    let best = -1;
    let bi = -1;
    for (let i = a + 1; i < b; i++) {
      // (a closed outline starts and ends at the same point: then it's the distance from there)
      const d = L < 1e-6 ? Math.hypot(pts[i][0] - ax, pts[i][1] - az) : Math.abs(((pts[i][0] - ax) * (bz - az) - (pts[i][1] - az) * (bx - ax)) / L);
      if (d > best) {
        best = d;
        bi = i;
      }
    }
    if (best > tol) {
      keep[bi] = 1;
      stack.push([a, bi], [bi, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

// Roads: split into runs per tile (each run drawn by the tile it mostly lies in)
for (const w of roads) {
  const cls = ROAD_CLASS[tag(w, 'highway')];
  let width = WIDTH[cls];
  const lanes = Number(tag(w, 'lanes'));
  if (lanes >= 2 && cls <= 4) width = Math.max(width, lanes * 3.4);
  const bridge = tag(w, 'bridge') === 'yes' ? 1 : 0;
  for (const piece of clipOut(w.geometry.map(W), CLEAR_ROADS)) {
    const pts = simplify(piece, 0.4);
    let run = [pts[0]];
    let key = null;
    for (let i = 1; i < pts.length; i++) {
      const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
      const k = tileOf(mid[0], mid[1]);
      if (key && k !== key) {
        pushRoad(key, run);
        run = [pts[i - 1]];
      }
      key = k;
      run.push(pts[i]);
    }
    if (key) pushRoad(key, run);
  }
  function pushRoad(key, run) {
    const [i, j] = key.split('_').map(Number);
    const t = tileFor(i * TILE + 1, j * TILE + 1);
    t.b.push([cls, Math.round(width * 10) / 10, bridge, ...run.flatMap(([x, z]) => [dm(x - t.i * TILE), dm(z - t.j * TILE)])]);
  }
}
// Railway: drawn as a ballast strip with rails
for (const w of ways.filter((w) => tag(w, 'railway') === 'rail' && w.geometry.some((p) => inDistrict(p.lat, p.lon)))) {
  for (const piece of clipOut(w.geometry.map(W), CLEAR_ROADS)) {
    const pts = simplify(piece, 0.3);
    for (let i = 1; i < pts.length; i++) {
      const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
      const t = tileFor(mid[0], mid[1]);
      t.b.push([8, 4, 0, dm(pts[i - 1][0] - t.i * TILE), dm(pts[i - 1][1] - t.j * TILE), dm(pts[i][0] - t.i * TILE), dm(pts[i][1] - t.j * TILE)]);
    }
  }
}

/* ── Buildings ────────────────────────────────────────────────── */

const hash = (n) => {
  let h = n % 2147483647;
  h = (h * 16807) % 2147483647;
  h = (h * 16807) % 2147483647;
  return h / 2147483647;
};

function area(r) {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [];
  for (const q of p) {
    while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
    lo.push(q);
  }
  const up = [];
  for (const q of p.reverse()) {
    while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
    up.push(q);
  }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}

/** The smallest box around a footprint (for its collider): centre, half sizes, angle. */
function box(ring) {
  const h = hull(ring);
  let best = null;
  for (let i = 0; i < h.length; i++) {
    const a = h[i];
    const b = h[(i + 1) % h.length];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const [x, z] of h) {
      const u = x * c + z * s;
      const v = -x * s + z * c;
      x0 = Math.min(x0, u); x1 = Math.max(x1, u); z0 = Math.min(z0, v); z1 = Math.max(z1, v);
    }
    const A = (x1 - x0) * (z1 - z0);
    if (!best || A < best.A) {
      const cu = (x0 + x1) / 2;
      const cv = (z0 + z1) / 2;
      best = { A, cx: cu * c - cv * s, cz: cu * s + cv * c, hx: (x1 - x0) / 2, hz: (z1 - z0) / 2, ang };
    }
  }
  return best;
}

function heightOf(e) {
  const h = parseFloat(tag(e, 'height'));
  if (h > 2 && h < 200) return h;
  const lv = parseFloat(tag(e, 'building:levels'));
  if (lv >= 1 && lv < 60) return lv * 3.2 + 0.5;
  const kind = tag(e, 'building');
  const r = hash(e.id);
  if (['apartments', 'commercial', 'retail', 'hotel', 'office', 'hospital', 'college', 'school'].includes(kind)) return 6.9 + Math.floor(r * 3) * 3.2;
  if (['shed', 'hut', 'roof', 'garage', 'kiosk'].includes(kind)) return 2.8;
  return r < 0.78 ? 3.7 : r < 0.97 ? 6.9 : 10.1;
}

let nBuildings = 0;
function addBuilding(e, ringLL) {
  const c = ringLL[0];
  if (!inDistrict(c.lat, c.lon)) return;
  let ring = simplify(ringLL.map(W), 0.25);
  if (ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
  if (ring.length < 3) return;
  if (ring.some(([x, z]) => inside(CLEAR_BUILDINGS, x, z))) return;
  // counter-clockwise in the x/z plane as seen from above
  if (area(ring) < 0) ring.reverse();
  const A = Math.abs(area(ring));
  if (A < 6) return;
  const cx = ring.reduce((a, p) => a + p[0], 0) / ring.length;
  const cz = ring.reduce((a, p) => a + p[1], 0) / ring.length;
  const t = tileFor(cx, cz);
  const h = heightOf(e);
  t.h.push([Math.round(h * 10) / 10, Math.floor(hash(e.id + 7) * 1000), ...ring.flatMap(([x, z]) => [dm(x - t.i * TILE), dm(z - t.j * TILE)])]);
  const b = box(ring);
  t.o.push([dm(b.cx - t.i * TILE), dm(b.cz - t.j * TILE), dm(b.hx), dm(b.hz), Math.round(b.ang * 1000) / 1000, Math.round(h * 10) / 10]);
  nBuildings++;
}
for (const e of elements.values()) {
  if (!tag(e, 'building')) continue;
  if (e.type === 'way' && e.geometry) addBuilding(e, e.geometry);
  if (e.type === 'relation') for (const r of rings(e.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry))) addBuilding(e, r);
}
console.log(`${nBuildings} buildings`);

/* ── Water ────────────────────────────────────────────────────── */

// The sea: walking east along each 5 m strip from far out at sea, every coastline crossed
// switches between sea and land. Worked out in plain east/north space, then sampled.
const coast = ways.filter((w) => tag(w, 'natural') === 'coastline').map((w) => w.geometry.map(enu));
const ROW = 5;
const rowCross = new Map();
for (const line of coast) {
  for (let i = 1; i < line.length; i++) {
    const [ax, az] = line[i - 1];
    const [bx, bz] = line[i];
    const r0 = Math.ceil(Math.min(az, bz) / ROW);
    const r1 = Math.floor(Math.max(az, bz) / ROW);
    for (let r = r0; r <= r1; r++) {
      const z = r * ROW;
      if (z === Math.max(az, bz)) continue; // count shared vertices once
      const x = ax + ((bx - ax) * (z - az)) / (bz - az);
      if (!rowCross.has(r)) rowCross.set(r, []);
      rowCross.get(r).push(x);
    }
  }
}
for (const list of rowCross.values()) list.sort((a, b) => a - b);
function isSea(wx, wz) {
  const [x, z] = unworld([wx, wz]);
  const list = rowCross.get(Math.round(z / ROW));
  if (!list) return false;
  let n = 0;
  for (const c of list) if (c < x) n++;
  return n % 2 === 0 && x < list[list.length - 1];
}

// lakes, ponds, rivers drawn as areas
for (const e of elements.values()) {
  const water = tag(e, 'natural') === 'water' || tag(e, 'waterway') === 'riverbank' || tag(e, 'landuse') === 'reservoir';
  if (!water) continue;
  let polys = [];
  if (e.type === 'way' && e.geometry) polys = [{ outer: [e.geometry], inner: [] }];
  if (e.type === 'relation') {
    const outer = rings(e.members.filter((m) => m.type === 'way' && m.role === 'outer' && m.geometry).map((m) => m.geometry));
    const inner = rings(e.members.filter((m) => m.type === 'way' && m.role === 'inner' && m.geometry).map((m) => m.geometry));
    polys = [{ outer, inner }];
  }
  for (const p of polys) {
    const ringsW = [...p.outer, ...p.inner].map((r) => r.map(W));
    if (!ringsW.length) continue;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const r of ringsW) for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.floor(x0 / TILE); i <= Math.floor(x1 / TILE); i++)
      for (let j = Math.floor(z0 / TILE); j <= Math.floor(z1 / TILE); j++) tileFor(i * TILE + 1, j * TILE + 1).wpoly.push(ringsW);
  }
}
// rivers and streams drawn as lines
const LINE_W = { river: 22, canal: 9, stream: 4 };
for (const w of ways) {
  const kind = tag(w, 'waterway');
  if (!(kind in LINE_W)) continue;
  const width = Math.min(parseFloat(tag(w, 'width')) || LINE_W[kind], 120);
  const pts = w.geometry.map(W);
  for (let i = 1; i < pts.length; i++) {
    const mid = [(pts[i - 1][0] + pts[i][0]) / 2, (pts[i - 1][1] + pts[i][1]) / 2];
    for (const k of new Set([tileOf(...pts[i - 1]), tileOf(...pts[i]), tileOf(...mid)])) {
      const [ti, tj] = k.split('_').map(Number);
      tileFor(ti * TILE + 1, tj * TILE + 1).wline.push([pts[i - 1], pts[i], width]);
    }
  }
}

/** Every tile within the district gets ground, even without roads or buildings, and the sea off it gets water. */
let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
for (const r of districtRings) for (const p of r) {
  const [x, z] = W(p);
  minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
}
for (let i = Math.floor(minX / TILE) - 2; i <= Math.floor(maxX / TILE) + 2; i++)
  for (let j = Math.floor(minZ / TILE) - 2; j <= Math.floor(maxZ / TILE) + 2; j++) {
    const [x, z] = unworld([i * TILE + TILE / 2, j * TILE + TILE / 2]);
    const lat = SITE.lat - z / KZ;
    const lon = SITE.lon + x / KX;
    if (inDistrict(lat, lon) || tiles.has(`${i}_${j}`) || isSea(i * TILE + TILE / 2, j * TILE + TILE / 2)) tileFor(i * TILE + 1, j * TILE + 1);
  }

function waterMask(t) {
  const bits = new Uint8Array((CELLS * CELLS) / 8);
  let count = 0;
  const set = (cx, cz) => {
    const k = cz * CELLS + cx;
    if (!(bits[k >> 3] & (1 << (k & 7)))) {
      bits[k >> 3] |= 1 << (k & 7);
      count++;
    }
  };
  const X0 = t.i * TILE;
  const Z0 = t.j * TILE;
  // sea
  for (let cz = 0; cz < CELLS; cz++) for (let cx = 0; cx < CELLS; cx++) if (isSea(X0 + (cx + 0.5) * CELL, Z0 + (cz + 0.5) * CELL)) set(cx, cz);
  // areas: even–odd fill along each row of cells
  for (const ringsW of t.wpoly) {
    for (let cz = 0; cz < CELLS; cz++) {
      const z = Z0 + (cz + 0.5) * CELL;
      const xs = [];
      for (const r of ringsW)
        for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
          const [ax, az] = r[a];
          const [bx, bz] = r[b];
          if (az > z !== bz > z) xs.push(ax + ((bx - ax) * (z - az)) / (bz - az));
        }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil((xs[k] - X0) / CELL - 0.5));
        const c1 = Math.min(CELLS - 1, Math.floor((xs[k + 1] - X0) / CELL - 0.5));
        for (let cx = c0; cx <= c1; cx++) set(cx, cz);
      }
    }
  }
  // lines
  for (const [[ax, az], [bx, bz], w] of t.wline) {
    const r = w / 2;
    const c0 = Math.max(0, Math.floor((Math.min(ax, bx) - r - X0) / CELL));
    const c1 = Math.min(CELLS - 1, Math.floor((Math.max(ax, bx) + r - X0) / CELL));
    const d0 = Math.max(0, Math.floor((Math.min(az, bz) - r - Z0) / CELL));
    const d1 = Math.min(CELLS - 1, Math.floor((Math.max(az, bz) + r - Z0) / CELL));
    const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
    for (let cz = d0; cz <= d1; cz++)
      for (let cx = c0; cx <= c1; cx++) {
        const px = X0 + (cx + 0.5) * CELL;
        const pz = Z0 + (cz + 0.5) * CELL;
        const tt = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (pz - az) * (bz - az)) / L2));
        if (Math.hypot(px - (ax + (bx - ax) * tt), pz - (az + (bz - az) * tt)) <= Math.max(r, CELL * 0.5)) set(cx, cz);
      }
  }
  // never flood the building's own site
  for (let cz = 0; cz < CELLS; cz++)
    for (let cx = 0; cx < CELLS; cx++) {
      const x = X0 + (cx + 0.5) * CELL;
      const z = Z0 + (cz + 0.5) * CELL;
      if (inside({ x0: -70, x1: 70, z0: -95, z1: 30 }, x, z)) {
        const k = cz * CELLS + cx;
        if (bits[k >> 3] & (1 << (k & 7))) {
          bits[k >> 3] &= ~(1 << (k & 7));
          count--;
        }
      }
    }
  return { bits, count };
}

/* ── Routes to the building, and signs at every junction ─────── */

const nodePos = new Map();
const adj = new Map();
const link = (a, b, cost, len) => {
  if (!adj.has(a)) adj.set(a, []);
  adj.get(a).push([b, cost, len]);
};
for (const w of roads) {
  const cls = ROAD_CLASS[tag(w, 'highway')];
  if (cls > 6 || !w.nodes) continue;
  const oneway = tag(w, 'oneway') === 'yes';
  for (let i = 0; i < w.nodes.length; i++) {
    nodePos.set(w.nodes[i], W(w.geometry[i]));
    if (i === 0) continue;
    const a = w.nodes[i - 1];
    const b = w.nodes[i];
    const [ax, az] = nodePos.get(a);
    const [bx, bz] = nodePos.get(b);
    const len = Math.hypot(bx - ax, bz - az);
    const cost = len / SPEED[cls];
    // routes are worked out backwards from the building: reverse the one-way rule
    link(b, a, cost, len);
    if (!oneway) link(a, b, cost, len);
  }
}
// start: the node of the front road closest to the front door (0, 10)
let startNode = null;
let startD = Infinity;
for (const w of roads) {
  if (w.id !== front.way) continue;
  for (const n of w.nodes) {
    const [x, z] = nodePos.get(n);
    const d = Math.hypot(x, z - 10);
    if (d < startD) {
      startD = d;
      startNode = n;
    }
  }
}
// Dijkstra with a binary heap
const cost = new Map([[startNode, 0]]);
const metres = new Map([[startNode, startD]]);
const next = new Map();
const heap = [[0, startNode]];
const push = (item) => {
  heap.push(item);
  let i = heap.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (heap[p][0] <= heap[i][0]) break;
    [heap[p], heap[i]] = [heap[i], heap[p]];
    i = p;
  }
};
const pop = () => {
  const top = heap[0];
  const last = heap.pop();
  if (heap.length) {
    heap[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
      if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
      if (m === i) break;
      [heap[m], heap[i]] = [heap[i], heap[m]];
      i = m;
    }
  }
  return top;
};
while (heap.length) {
  const [c, n] = pop();
  if (c > cost.get(n)) continue;
  for (const [m, w, len] of adj.get(n) ?? []) {
    const nc = c + w;
    if (nc < (cost.get(m) ?? Infinity)) {
      cost.set(m, nc);
      metres.set(m, metres.get(n) + len);
      next.set(m, n);
      push([nc, m]);
    }
  }
}
console.log(`${cost.size} of ${nodePos.size} road nodes can reach the building`);

const neighbours = new Map();
for (const [a, list] of adj) for (const [b] of list) {
  if (!neighbours.has(a)) neighbours.set(a, new Set());
  if (!neighbours.has(b)) neighbours.set(b, new Set());
  neighbours.get(a).add(b);
  neighbours.get(b).add(a);
}
const signs = [];
for (const [n, set] of neighbours) {
  if (set.size < 3 || !next.has(n)) continue;
  const [x, z] = nodePos.get(n);
  if (inside({ x0: -70, x1: 70, z0: -95, z1: 30 }, x, z)) continue;
  // the way to go: a point ~15 m along the route
  let m = n;
  let walked = 0;
  let to = nodePos.get(n);
  while (walked < 15 && next.has(m)) {
    const p = nodePos.get(next.get(m));
    walked += Math.hypot(p[0] - to[0], p[1] - to[1]);
    to = p;
    m = next.get(m);
  }
  if (walked < 1) continue;
  const ang = Math.atan2(to[1] - z, to[0] - x);
  // the post stands on the corner furthest from all the roads meeting here
  const arms = [...set].map((o) => nodePos.get(o));
  let best = null;
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + Math.PI / 8;
    const r = 7;
    const px = x + Math.cos(a) * r;
    const pz = z + Math.sin(a) * r;
    let clear = Infinity;
    for (const [ox, oz] of arms) {
      const L2 = (ox - x) ** 2 + (oz - z) ** 2 || 1e-9;
      const tt = Math.max(0, Math.min(1, ((px - x) * (ox - x) + (pz - z) * (oz - z)) / L2));
      clear = Math.min(clear, Math.hypot(px - (x + (ox - x) * tt), pz - (z + (oz - z) * tt)));
    }
    if (!best || clear > best.clear) best = { clear, px, pz };
  }
  signs.push([best.px, best.pz, ang, metres.get(n)]);
}
// one sign per junction cluster
const grid = new Map();
let nSigns = 0;
for (const s of signs) {
  const k = `${Math.floor(s[0] / 14)}_${Math.floor(s[1] / 14)}`;
  if (grid.has(k)) continue;
  grid.set(k, 1);
  const t = tileFor(s[0], s[1]);
  t.s.push([dm(s[0] - t.i * TILE), dm(s[1] - t.j * TILE), Math.round(s[2] * 1000) / 1000, Math.round(s[3])]);
  nSigns++;
}
console.log(`${nSigns} direction signs`);

/* ── Place names ──────────────────────────────────────────────── */

const places = [...elements.values()]
  .filter((e) => e.type === 'node' && tag(e, 'name') && inDistrict(e.lat, e.lon))
  .map((e) => {
    const [x, z] = W(e);
    return { n: tag(e, 'name:en') || tag(e, 'name'), k: tag(e, 'place'), x: Math.round(x), z: Math.round(z) };
  });

/* ── Write tiles ──────────────────────────────────────────────── */

rmSync(OUT, { recursive: true, force: true });
mkdirSync(join(OUT, 't'), { recursive: true });
let bytes = 0;
const list = [];
const waterTiles = new Map();
for (const [k, t] of tiles) {
  const { bits, count } = waterMask(t);
  waterTiles.set(k, { bits, count });
  const data = { b: t.b, h: t.h, o: t.o, s: t.s };
  if (count === CELLS * CELLS) data.w = 1;
  else if (count > 0) data.w = Buffer.from(bits).toString('base64');
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, 't', `${k}.json`), json);
  bytes += json.length;
  list.push(k);
}
console.log(`${list.length} tiles, ${(bytes / 1e6).toFixed(1)} MB`);

/* ── Overview image (8 m per pixel would be huge: 40 m) ───────── */

const MPP = 40;
const X0 = Math.floor(minX / TILE) * TILE - TILE;
const Z0 = Math.floor(minZ / TILE) * TILE - TILE;
const IW = Math.ceil((maxX - X0 + 2 * TILE) / MPP);
const IH = Math.ceil((maxZ - Z0 + 2 * TILE) / MPP);
const img = new Uint8Array(IW * IH * 4);
const px = (x, y, [r, g, b, a = 255]) => {
  if (x < 0 || y < 0 || x >= IW || y >= IH) return;
  const o = (y * IW + x) * 4;
  img[o] = r; img[o + 1] = g; img[o + 2] = b; img[o + 3] = a;
};
// land inside the district, darker outside it
for (let y = 0; y < IH; y++)
  for (let x = 0; x < IW; x++) {
    const wx = X0 + (x + 0.5) * MPP;
    const wz = Z0 + (y + 0.5) * MPP;
    const t = waterTiles.get(tileOf(wx, wz));
    let water = false;
    if (t?.count) {
      const cx = Math.floor((wx - Math.floor(wx / TILE) * TILE) / CELL);
      const cz = Math.floor((wz - Math.floor(wz / TILE) * TILE) / CELL);
      const k = cz * CELLS + cx;
      water = !!(t.bits[k >> 3] & (1 << (k & 7)));
    } else if (!t) water = isSea(wx, wz);
    px(x, y, water ? [134, 201, 214] : t ? [214, 226, 190] : [196, 204, 180]);
  }
const line = (ax, az, bx, bz, w, col) => {
  const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (MPP / 2)) + 1;
  const r = Math.max(0, Math.round(w / 2));
  for (let s = 0; s <= steps; s++) {
    const x = Math.round((ax + ((bx - ax) * s) / steps - X0) / MPP);
    const y = Math.round((az + ((bz - az) * s) / steps - Z0) / MPP);
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) px(x + dx, y + dy, col);
  }
};
const ROAD_COL = [[232, 120, 60], [240, 170, 70], [246, 210, 110], [255, 255, 255], [255, 255, 255], [250, 250, 250]];
for (const cls of [5, 4, 3, 2, 1, 0])
  for (const t of tiles.values())
    for (const r of t.b) {
      if (r[0] !== cls) continue;
      for (let i = 5; i < r.length; i += 2) line(t.i * TILE + r[i - 2] / 10, t.j * TILE + r[i - 1] / 10, t.i * TILE + r[i] / 10, t.j * TILE + r[i + 1] / 10, cls <= 1 ? 2 : cls <= 3 ? 1 : 0, ROAD_COL[cls]);
    }
for (const t of tiles.values()) for (const r of t.b) if (r[0] === 8) line(t.i * TILE + r[3] / 10, t.j * TILE + r[4] / 10, t.i * TILE + r[5] / 10, t.j * TILE + r[6] / 10, 0, [120, 110, 120]);

function png(w, h, rgba) {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
writeFileSync(join(OUT, 'overview.png'), png(IW, IH, img));

writeFileSync(
  join(OUT, 'meta.json'),
  JSON.stringify({
    site: SITE,
    front: front.name,
    north: NORTH.map((n) => Math.round(n * 1e6) / 1e6),
    tile: TILE,
    cell: CELL,
    bounds: { x0: Math.floor(minX), x1: Math.ceil(maxX), z0: Math.floor(minZ), z1: Math.ceil(maxZ) },
    overview: { x0: X0, z0: Z0, mpp: MPP, w: IW, h: IH },
    tiles: list,
    places,
  })
);
console.log(`overview ${IW}×${IH}; done`);
