import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { applyWetness, usePBR } from './materials';
import { noRaycast } from './merge';
import { PLASTER } from './Neighbours';
import { world } from './state';
import { boxDistance, cellsPerTile, forgetTilesFarFrom, getMeta, hasTile, loadedTile, loadMeta, loadTile, onMapChange, RAIL, tileKey, waterRects, type Tile } from './map';

/*
 * Kasaragod beyond the Electrosparkzz street: the real roads, buildings, rivers and sea
 * from OpenStreetMap, a 1 km tile at a time. Tiles you can see are drawn; the ones
 * right around you also get colliders (buildings are solid, water stops you).
 */

/** Tiles this close to the camera are drawn (the fog hides everything past ~600 m). */
const DRAW = 850;
/** …and forgotten past this. */
const FORGET = 1400;
/** Tiles this close get colliders. */
const SOLID = 160;
/** Tiles this close cast shadows and show their signs. */
const NEAR = 350;

const ROAD_Y = [0.03, 0.028, 0.026, 0.024, 0.022, 0.02, 0.016, 0.014, 0.012];
const ROOF = ['#b9b3a7', '#a9a397', '#c4bdb0', '#b5583a', '#a4482f', '#9a9a92'];

/** Positions, normals, uvs and colours, gathered for one merged mesh. */
class Mesh {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
  vert(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number, c: THREE.Color) {
    this.pos.push(x, y, z);
    this.nor.push(nx, ny, nz);
    this.uv.push(u, v);
    this.col.push(c.r, c.g, c.b);
  }
  geometry() {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** A flat strip along a line (x, z pairs), `w` wide and `shift` to its left, at height y; UVs in metres / tile. */
function strip(m: Mesh, pts: number[], w: number, y: number, c: THREE.Color, tile: number, shift = 0) {
  const n = pts.length / 2;
  if (n < 2) return;
  const L: [number, number][] = [];
  const R: [number, number][] = [];
  const along: number[] = [];
  let walked = 0;
  for (let i = 0; i < n; i++) {
    const x = pts[i * 2];
    const z = pts[i * 2 + 1];
    if (i > 0) walked += Math.hypot(x - pts[i * 2 - 2], z - pts[i * 2 - 1]);
    along.push(walked);
    // the direction here: across the joint, so neighbouring pieces meet
    const a = Math.max(0, i - 1);
    const b = Math.min(n - 1, i + 1);
    let dx = pts[b * 2] - pts[a * 2];
    let dz = pts[b * 2 + 1] - pts[a * 2 + 1];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    // keep the width at sharp bends (up to twice as far out)
    let k = 1;
    if (i > 0 && i < n - 1) {
      const sx = pts[i * 2] - pts[i * 2 - 2];
      const sz = pts[i * 2 + 1] - pts[i * 2 - 1];
      const sl = Math.hypot(sx, sz) || 1;
      k = Math.min(2, 1 / Math.max(0.5, (sx * dx + sz * dz) / sl));
    }
    // ends reach a little past the last point so joins and junctions are covered
    const ext = shift ? 0 : i === 0 ? -w / 2 : i === n - 1 ? w / 2 : 0;
    const nx = -dz * k;
    const nz = dx * k;
    const px = x + dx * ext;
    const pz = z + dz * ext;
    L.push([px + nx * (shift + w / 2), pz + nz * (shift + w / 2)]);
    R.push([px + nx * (shift - w / 2), pz + nz * (shift - w / 2)]);
  }
  for (let i = 0; i < n - 1; i++) {
    const v0 = along[i] / tile;
    const v1 = along[i + 1] / tile;
    const u1 = w / tile;
    const q = [
      [L[i], 0, v0],
      [R[i], u1, v0],
      [L[i + 1], 0, v1],
      [R[i], u1, v0],
      [R[i + 1], u1, v1],
      [L[i + 1], 0, v1],
    ] as const;
    for (const [[x, z], u, v] of q) m.vert(x, y, z, 0, 1, 0, u, v, c);
  }
}

/** Short dashes along the middle of a line. */
function dashes(m: Mesh, pts: number[], y: number, c: THREE.Color) {
  let phase = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const dx = pts[i] - ax;
    const dz = pts[i + 1] - az;
    const len = Math.hypot(dx, dz);
    for (let s = phase; s < len; s += 9) {
      const e = Math.min(s + 3, len);
      strip(m, [ax + (dx * s) / len, az + (dz * s) / len, ax + (dx * e) / len, az + (dz * e) / len], 0.12, y, c, 1);
    }
    phase = (((phase - len) % 9) + 9) % 9;
  }
}

/** Everything drawn for one tile, built once when it loads. */
function buildTile(t: Tile) {
  const size = getMeta()!.tile;
  const ox = t.i * size;
  const oz = t.j * size;
  const asphalt = new Mesh();
  const ground = new Mesh(); // tracks, footpaths, railway
  const paint = new Mesh();
  const walls = new Mesh();
  const roofs = new Mesh();
  const water = new Mesh();
  const c = new THREE.Color();
  const white = new THREE.Color('#efeee8');

  for (const r of t.data.b) {
    const [cls, w] = r;
    const pts = r.slice(3).map((v, k) => v / 10 + (k % 2 ? oz : ox));
    if (cls === RAIL) {
      strip(ground, pts, w, ROAD_Y[cls], c.set('#7d7368'), 2);
      for (const side of [-0.75, 0.75]) strip(paint, pts, 0.08, ROAD_Y[cls] + 0.002, c.set('#4a4a4f'), 1, side);
      continue;
    }
    if (cls >= 6) {
      strip(ground, pts, w, ROAD_Y[cls], c.set(cls === 6 ? '#a8673f' : '#b9b4aa'), 2);
      continue;
    }
    strip(asphalt, pts, w, ROAD_Y[cls], c.set('#ffffff'), 6);
    if (cls <= 3) dashes(paint, pts, ROAD_Y[cls] + 0.004, white);
  }

  for (const b of t.data.h) {
    const [h, seed] = b;
    const ring: [number, number][] = [];
    for (let k = 2; k + 1 < b.length; k += 2) ring.push([b[k] / 10 + ox, b[k + 1] / 10 + oz]);
    let A = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x0, z0] = ring[k];
      const [x1, z1] = ring[(k + 1) % ring.length];
      A += x0 * z1 - x1 * z0;
    }
    const wall = c.set(PLASTER[seed % PLASTER.length]).clone().multiplyScalar(0.92 + ((seed >> 3) % 8) / 50);
    let u = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x0, z0] = ring[k];
      const [x1, z1] = ring[(k + 1) % ring.length];
      const len = Math.hypot(x1 - x0, z1 - z0);
      if (len < 0.01) continue;
      // outward, whichever way round the outline goes
      const s = A > 0 ? 1 : -1;
      const nx = (s * (z1 - z0)) / len;
      const nz = (-s * (x1 - x0)) / len;
      const u0 = u / 2.5;
      const u1 = (u + len) / 2.5;
      const v1 = h / 2.5;
      walls.vert(x0, 0, z0, nx, 0, nz, u0, 0, wall);
      walls.vert(x1, 0, z1, nx, 0, nz, u1, 0, wall);
      walls.vert(x1, h, z1, nx, 0, nz, u1, v1, wall);
      walls.vert(x0, 0, z0, nx, 0, nz, u0, 0, wall);
      walls.vert(x1, h, z1, nx, 0, nz, u1, v1, wall);
      walls.vert(x0, h, z0, nx, 0, nz, u0, v1, wall);
      u += len;
    }
    const roof = c.set(ROOF[(seed >> 5) % ROOF.length]);
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map(([x, z]) => new THREE.Vector2(x, z)),
      []
    );
    for (const tri of tris) for (const k of tri) roofs.vert(ring[k][0], h, ring[k][1], 0, 1, 0, ring[k][0] / 3, ring[k][1] / 3, roof);
  }

  if (t.water) {
    const cell = getMeta()!.cell;
    const blue = c.set('#ffffff');
    for (const [a, b, e, f] of waterRects(t)) {
      const x0 = ox + a * cell;
      const z0 = oz + b * cell;
      const x1 = ox + e * cell;
      const z1 = oz + f * cell;
      const q = [
        [x0, z0],
        [x1, z0],
        [x1, z1],
        [x0, z0],
        [x1, z1],
        [x0, z1],
      ];
      for (const [x, z] of q) water.vert(x, 0.008, z, 0, 1, 0, x / 40, z / 40, blue);
    }
  }

  return {
    asphalt: asphalt.geometry(),
    ground: ground.geometry(),
    paint: paint.geometry(),
    walls: walls.geometry(),
    roofs: roofs.geometry(),
    water: water.geometry(),
  };
}

type Built = ReturnType<typeof buildTile>;

/* ── Direction signs: all of a tile's boards share one texture ──── */

const LABEL_W = 128;
const LABEL_H = 40;
const COLS = 1024 / LABEL_W;

function label(g: CanvasRenderingContext2D, x: number, y: number, metres: number, left: boolean) {
  g.fillStyle = '#1f6b3a';
  g.fillRect(x, y, LABEL_W, LABEL_H);
  g.strokeStyle = '#f4f1e8';
  g.lineWidth = 2;
  g.strokeRect(x + 2, y + 2, LABEL_W - 4, LABEL_H - 4);
  g.fillStyle = '#f4f1e8';
  g.textBaseline = 'middle';
  g.font = '700 15px Nunito, sans-serif';
  g.textAlign = left ? 'right' : 'left';
  g.fillText('Electrosparkzz', left ? x + LABEL_W - 8 : x + 8, y + 14);
  g.font = '600 12px Nunito, sans-serif';
  const dist = metres < 950 ? `${Math.round(metres / 50) * 50} m` : `${(metres / 1000).toFixed(1)} km`;
  g.fillText(dist, left ? x + LABEL_W - 8 : x + 8, y + 29);
  // the arrow
  g.beginPath();
  const ax = left ? x + 18 : x + LABEL_W - 18;
  const d = left ? -1 : 1;
  g.moveTo(ax + d * 10, y + 20);
  g.lineTo(ax - d * 2, y + 10);
  g.lineTo(ax - d * 2, y + 16);
  g.lineTo(ax - d * 12, y + 16);
  g.lineTo(ax - d * 12, y + 24);
  g.lineTo(ax - d * 2, y + 24);
  g.lineTo(ax - d * 2, y + 30);
  g.closePath();
  g.fill();
}

function buildSigns(t: Tile) {
  const size = getMeta()!.tile;
  const signs = t.data.s.slice(0, 100);
  if (!signs.length) return null;
  const rows = Math.ceil((signs.length * 2) / COLS);
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = THREE.MathUtils.ceilPowerOfTwo(Math.max(rows * LABEL_H, 64));
  const g = canvas.getContext('2d')!;
  const posts = new Mesh();
  const boards = new Mesh();
  const grey = new THREE.Color('#8d9095');
  const white = new THREE.Color('#ffffff');
  const W = 1.6;
  const H = 0.5;
  const TOP = 2.6;
  signs.forEach(([sx, sz, ang, metres], n) => {
    const x = sx / 10 + t.i * size;
    const z = sz / 10 + t.j * size;
    // the post
    const p = 0.05;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ax = x + nx * p - nz * p;
      const az = z + nz * p + nx * p;
      const bx = x + nx * p + nz * p;
      const bz = z + nz * p - nx * p;
      const q = [[ax, 0, az], [bx, 0, bz], [bx, TOP, bz], [ax, 0, az], [bx, TOP, bz], [ax, TOP, az]] as const;
      for (const [qx, qy, qz] of q) posts.vert(qx, qy, qz, nx, 0, nz, 0, 0, grey);
    }
    // the board runs the way to go, with a label on each face (the arrow points along it from both sides)
    const dx = Math.cos(ang);
    const dz = Math.sin(ang);
    const cx = x + dx * (W / 2 - 0.1);
    const cz = z + dz * (W / 2 - 0.1);
    const ax = cx - (dx * W) / 2;
    const az = cz - (dz * W) / 2;
    const bx = cx + (dx * W) / 2;
    const bz = cz + (dz * W) / 2;
    // a label on each face, reading left to right, with the arrow pointing the way to go
    const faces = [
      { nx: dz, nz: -dx, from: [bx, bz], to: [ax, az], left: true },
      { nx: -dz, nz: dx, from: [ax, az], to: [bx, bz], left: false },
    ];
    faces.forEach(({ nx, nz, from, to, left }, face) => {
      const k = n * 2 + face;
      const lx = (k % COLS) * LABEL_W;
      const ly = Math.floor(k / COLS) * LABEL_H;
      label(g, lx, ly, metres, left);
      const u0 = lx / canvas.width;
      const u1 = (lx + LABEL_W) / canvas.width;
      const v0 = 1 - (ly + LABEL_H) / canvas.height;
      const v1 = 1 - ly / canvas.height;
      const q = [
        [from, TOP - H, u0, v0],
        [to, TOP - H, u1, v0],
        [to, TOP, u1, v1],
        [from, TOP - H, u0, v0],
        [to, TOP, u1, v1],
        [from, TOP, u0, v1],
      ] as const;
      for (const [[qx, qz], qy, qu, qv] of q) boards.vert(qx + nx * 0.012, qy, qz + nz * 0.012, nx, 0, nz, qu, qv, white);
    });
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return { posts: posts.geometry()!, boards: boards.geometry()!, texture };
}

/* ── Colliders ──────────────────────────────────────────────── */

/** Buildings are solid boxes; water is a low wall you can't wade into (except where a road crosses it). */
function useTileColliders(t: Tile) {
  const { world: physics, rapier } = useRapier();
  useEffect(() => {
    const size = getMeta()!.tile;
    const cell = getMeta()!.cell;
    const ox = t.i * size;
    const oz = t.j * size;
    const made: Collider[] = [];
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [cx, cz, hx, hz, ang, h] of t.data.o) {
      q.setFromAxisAngle(up, -ang);
      const desc = rapier.ColliderDesc.cuboid(hx / 10, h / 2, hz / 10)
        .setTranslation(cx / 10 + ox, h / 2, cz / 10 + oz)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      made.push(physics.createCollider(desc));
    }
    if (t.water) {
      // roads (bridges, causeways) stay open
      const N = cellsPerTile();
      const open = new Uint8Array(N * N);
      for (const r of t.data.b) {
        if (r[0] === RAIL || r[0] === 7) continue;
        const reach = r[1] / 2 + 2;
        for (let k = 5; k < r.length; k += 2) {
          const ax = r[k - 2] / 10;
          const az = r[k - 1] / 10;
          const bx = r[k] / 10;
          const bz = r[k + 1] / 10;
          const steps = Math.ceil(Math.hypot(bx - ax, bz - az) / (cell / 2)) + 1;
          for (let s = 0; s <= steps; s++) {
            const px = ax + ((bx - ax) * s) / steps;
            const pz = az + ((bz - az) * s) / steps;
            const c0 = Math.max(0, Math.floor((px - reach) / cell));
            const c1 = Math.min(N - 1, Math.floor((px + reach) / cell));
            const d0 = Math.max(0, Math.floor((pz - reach) / cell));
            const d1 = Math.min(N - 1, Math.floor((pz + reach) / cell));
            for (let d = d0; d <= d1; d++) for (let c = c0; c <= c1; c++) open[d * N + c] = 1;
          }
        }
      }
      for (const [a, b, e, f] of waterRects(t, (cx, cz) => open[cz * N + cx] === 1)) {
        const desc = rapier.ColliderDesc.cuboid(((e - a) * cell) / 2, 0.7, ((f - b) * cell) / 2).setTranslation(ox + ((a + e) * cell) / 2, 0.5, oz + ((b + f) * cell) / 2);
        made.push(physics.createCollider(desc));
      }
    }
    return () => {
      for (const c of made) if (physics.getCollider(c.handle)) physics.removeCollider(c, false);
    };
  }, [t, physics, rapier]);
}

function TileColliders({ tile }: { tile: Tile }) {
  useTileColliders(tile);
  return null;
}

/* ── Drawing ─────────────────────────────────────────────────── */

interface Mats {
  asphalt: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  paint: THREE.MeshStandardMaterial;
  walls: THREE.MeshStandardMaterial;
  roofs: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  post: THREE.MeshStandardMaterial;
}

function TileView({ tile, mats, near }: { tile: Tile; mats: Mats; near: boolean }) {
  const built = useMemo<Built>(() => buildTile(tile), [tile]);
  const signs = useMemo(() => (near ? buildSigns(tile) : null), [tile, near]);
  const boardMat = useMemo(() => (signs ? new THREE.MeshStandardMaterial({ map: signs.texture, roughness: 0.5 }) : null), [signs]);
  useEffect(
    () => () => {
      for (const g of Object.values(built)) g?.dispose();
    },
    [built]
  );
  useEffect(
    () => () => {
      signs?.posts.dispose();
      signs?.boards.dispose();
      signs?.texture.dispose();
      boardMat?.dispose();
    },
    [signs, boardMat]
  );
  return (
    <group>
      {built.water && <mesh geometry={built.water} material={mats.water} receiveShadow raycast={noRaycast} />}
      {built.ground && <mesh geometry={built.ground} material={mats.ground} receiveShadow raycast={noRaycast} />}
      {built.asphalt && <mesh geometry={built.asphalt} material={mats.asphalt} receiveShadow raycast={noRaycast} />}
      {built.paint && <mesh geometry={built.paint} material={mats.paint} receiveShadow raycast={noRaycast} />}
      {built.walls && <mesh geometry={built.walls} material={mats.walls} castShadow={near} receiveShadow raycast={noRaycast} />}
      {built.roofs && <mesh geometry={built.roofs} material={mats.roofs} castShadow={near} receiveShadow raycast={noRaycast} />}
      {signs && boardMat && (
        <>
          <mesh geometry={signs.posts} material={mats.post} castShadow raycast={noRaycast} />
          <mesh geometry={signs.boards} material={boardMat} raycast={noRaycast} />
        </>
      )}
    </group>
  );
}

/** Grass under everything, following the camera (in steps, so the texture stays put). */
function Ground({ mat }: { mat: THREE.MeshStandardMaterial }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (!mesh.current) return;
    mesh.current.position.set(Math.round(camera.position.x / 8) * 8, -0.03, Math.round(camera.position.z / 8) * 8);
  });
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={mat} receiveShadow raycast={noRaycast}>
      {/* in 50 m squares: one huge pair of triangles loses depth precision near you and shows through the street */}
      <planeGeometry args={[12000, 12000, 240, 240]} />
    </mesh>
  );
}

/**
 * The ground you stand on, and the edge of the map. The ground is a 400 m square that
 * follows you: one box the size of the district is too big for the physics to stay exact
 * (people sank into it). The edge is a wall of 1 km pieces for the same reason.
 */
function Bounds() {
  const { world: physics, rapier } = useRapier();
  const [meta, setMeta] = useState(getMeta);
  useEffect(() => onMapChange(() => setMeta(getMeta())), []);
  const ground = useRef<Collider | null>(null);
  useEffect(() => {
    const c = physics.createCollider(rapier.ColliderDesc.cuboid(200, 1, 200).setTranslation(world.player.x, -1, world.player.z));
    ground.current = c;
    return () => {
      ground.current = null;
      if (physics.getCollider(c.handle)) physics.removeCollider(c, false);
    };
  }, [physics, rapier]);
  useFrame(() => {
    const c = ground.current;
    if (!c) return;
    const at = c.translation();
    const p = world.vehicle?.ridden ? world.vehicle : world.player;
    if (Math.hypot(p.x - at.x, p.z - at.z) > 60) c.setTranslation({ x: Math.round(p.x), y: -1, z: Math.round(p.z) });
  });
  useEffect(() => {
    if (!meta) return;
    const b = meta.bounds;
    const x0 = b.x0 - 2000;
    const x1 = b.x1 + 2000;
    const z0 = b.z0 - 2000;
    const z1 = b.z1 + 2000;
    const made: Collider[] = [];
    const wall = (cx: number, cz: number, hx: number, hz: number) => made.push(physics.createCollider(rapier.ColliderDesc.cuboid(hx, 10, hz).setTranslation(cx, 10, cz)));
    for (let x = x0; x < x1; x += 1000) {
      const w = Math.min(1000, x1 - x) / 2;
      wall(x + w, z0, w, 0.5);
      wall(x + w, z1, w, 0.5);
    }
    for (let z = z0; z < z1; z += 1000) {
      const h = Math.min(1000, z1 - z) / 2;
      wall(x0, z + h, 0.5, h);
      wall(x1, z + h, 0.5, h);
    }
    return () => {
      for (const c of made) if (physics.getCollider(c.handle)) physics.removeCollider(c, false);
    };
  }, [meta, physics, rapier]);
  return null;
}

export function MapTiles() {
  const asphalt = usePBR('asphalt_02', [1, 1]);
  const plaster = usePBR('painted_plaster_wall', [1, 1], { normalScale: 0.6 });
  const grass = usePBR('sparse_grass', [3000, 3000]);
  const mats = useMemo<Mats>(() => {
    // flat layers lie a hair apart; push the lower ones back so far roads don't flicker
    const offset = <M extends THREE.Material>(m: M, units: number) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: units, polygonOffsetUnits: units * 2 });
    offset(grass, 6);
    return {
      asphalt: offset(Object.assign(asphalt, { side: THREE.DoubleSide }), 0),
      ground: offset(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 2),
      paint: offset(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), -2),
      walls: Object.assign(plaster, { vertexColors: true, side: THREE.DoubleSide }),
      roofs: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      water: offset(new THREE.MeshStandardMaterial({ color: '#3f8ea0', roughness: 0.12, metalness: 0.15, envMapIntensity: 1.4, side: THREE.DoubleSide }), 4),
      post: new THREE.MeshStandardMaterial({ color: '#8d9095', roughness: 0.6, metalness: 0.4 }),
    };
  }, [asphalt, plaster, grass]);
  const wetting = useMemo(() => [mats.asphalt, grass], [mats, grass]);
  useFrame(() => applyWetness(wetting, world.wet));

  const camera = useThree((s) => s.camera);
  const [shown, setShown] = useState<{ tile: Tile; near: boolean; solid: boolean }[]>([]);
  const last = useRef(0);
  useEffect(() => {
    loadMeta();
    return onMapChange(() => (last.current = 0));
  }, []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    if (now - last.current < 0.5) return;
    last.current = now;
    const meta = getMeta();
    if (!meta) return;
    const size = meta.tile;
    const { x, z } = camera.position;
    const next: typeof shown = [];
    const i0 = Math.floor((x - DRAW) / size);
    const i1 = Math.floor((x + DRAW) / size);
    const j0 = Math.floor((z - DRAW) / size);
    const j1 = Math.floor((z + DRAW) / size);
    for (let i = i0; i <= i1; i++)
      for (let j = j0; j <= j1; j++) {
        const key = `${i}_${j}`;
        if (!hasTile(key)) continue;
        const d = boxDistance(i * size, j * size, size, x, z);
        if (d > DRAW) continue;
        const tile = loadedTile(key);
        if (!tile) {
          loadTile(key);
          continue;
        }
        next.push({ tile, near: d < NEAR, solid: d < SOLID });
      }
    forgetTilesFarFrom(x, z, FORGET);
    const same = next.length === shown.length && next.every((n, k) => n.tile === shown[k].tile && n.near === shown[k].near && n.solid === shown[k].solid);
    if (!same) setShown(next);
  });

  // the tile you're on comes first (keeps it loading first too)
  useEffect(() => void loadTile(tileKey(world.player.x, world.player.z)), []);

  return (
    <group>
      <Ground mat={grass} />
      <Bounds />
      {shown.map(({ tile, near, solid }) => (
        <group key={tile.key}>
          <TileView tile={tile} mats={mats} near={near} />
          {solid && <TileColliders tile={tile} />}
        </group>
      ))}
    </group>
  );
}
