import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { useRapier } from '@react-three/rapier';
import type { Collider } from '@dimforge/rapier3d-compat';
import { applyWetness, canvasTexture, usePBR } from './materials';
import { noRaycast } from './merge';
import { PLASTER } from './Neighbours';
import { world } from './state';
import { Lamp, VirtualLight } from './Lamps';
import { Palms, type PalmSpot } from './Palms';
import { rng } from './layout';
import { inLandmark } from './Landmarks';
import { useReal } from './real';
import { boxDistance, cellsPerTile, forgetTilesFarFrom, getMeta, COVER, hasTile, isWater, loadedTile, loadMeta, loadTile, onMapChange, RAIL, tileCover, tileGround, tileKey, waterAt, waterRects, type Tile } from './map';

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
  /** Append a whole geometry (e.g. a box), moved by `matrix`, in one colour. */
  add(g: THREE.BufferGeometry, matrix: THREE.Matrix4, c: THREE.Color) {
    const flat = g.index ? g.toNonIndexed() : g;
    flat.applyMatrix4(matrix);
    const p = flat.attributes.position;
    const n = flat.attributes.normal;
    const uv = flat.attributes.uv;
    for (let i = 0; i < p.count; i++) this.vert(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i), uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, c);
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

/**
 * A flat strip along a line (x, z pairs), `w` wide and `shift` to its left, at height y; UVs in
 * metres / tile. Raised by `hs` at each point, or (with `ground`) lying on the ground at every
 * corner, so on a slope its uphill edge isn't buried.
 */
function strip(m: Mesh, pts: number[], w: number, y: number, c: THREE.Color, tile: number, shift = 0, hs?: number[], ground?: (x: number, z: number) => number) {
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
    const y0 = y + (hs ? hs[i] : 0);
    const y1 = y + (hs ? hs[i + 1] : 0);
    for (const [[x, z], u, v] of q) m.vert(x, ground ? y + ground(x, z) : v === v0 ? y0 : y1, z, 0, 1, 0, u, v, c);
  }
}

/** Short dashes along the middle of a line (at the line's heights, if it has them). */
function dashes(m: Mesh, pts: number[], y: number, c: THREE.Color, hs?: number[], ground?: (x: number, z: number) => number) {
  let phase = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const dx = pts[i] - ax;
    const dz = pts[i + 1] - az;
    const len = Math.hypot(dx, dz);
    for (let s = phase; s < len; s += 9) {
      const e = Math.min(s + 3, len);
      const h0 = hs ? hs[i / 2 - 1] + ((hs[i / 2] - hs[i / 2 - 1]) * s) / len : 0;
      const h1 = hs ? hs[i / 2 - 1] + ((hs[i / 2] - hs[i / 2 - 1]) * e) / len : 0;
      strip(m, [ax + (dx * s) / len, az + (dz * s) / len, ax + (dx * e) / len, az + (dz * e) / len], 0.12, y, c, 1, 0, [h0, h1], ground);
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
  const plain = new Mesh(); // parapets
  const roofs = new Mesh();
  const tiled = new Mesh(); // clay-tile roofs
  const tanks = new Mesh();
  const water = new Mesh();
  const c = new THREE.Color();
  const white = new THREE.Color('#efeee8');
  const posts = new Mesh();
  const heads = new Mesh();
  const glows = new Mesh();
  const boards = new Mesh();
  const sand = new Mesh();
  const surf = new Mesh();
  const wires: number[] = [];
  const lamps: [number, number, number][] = [];
  // a shop's front faces a proper road (not a path)
  const facesRoad = roadTester(t, 1, 5);
  const G = (x: number, z: number) => tileGround(t, x, z);
  // (a lamp post never stands in another road)
  const onRoad = roadTester(t, 0.5);

  for (const r of t.data.b) {
    const [cls, w, bridge] = r;
    // every 12 m, so the road follows the lie of the land; a bridge runs level from end to end
    const pts = densify(r.slice(3).map((v, k) => v / 10 + (k % 2 ? oz : ox)), 6);
    const hs = roadHeights(pts, bridge === 1, G);
    // on the ground (a little proud of it, for the creases between its height points); a bridge runs level
    const on = bridge === 1 ? undefined : (x: number, z: number) => G(x, z) + 0.05;
    if (cls <= 4) streetLamps(pts, w, cls, posts, heads, glows, lamps, onRoad, G);
    if (cls >= 2 && cls <= 4 && !bridge) electricity(pts, w, plain, wires, onRoad, G);
    if (cls === RAIL) {
      // ballast, sleepers across it, and two steel rails
      strip(ground, pts, 3.4, ROAD_Y[cls], c.set('#857c72'), 2, 0, hs, on);
      sleepers(paint, pts, ROAD_Y[cls] + 0.012, c.set('#4e3b2c'), hs, on);
      for (const side of [-0.76, 0.76]) strip(paint, pts, 0.09, ROAD_Y[cls] + 0.06, c.set('#a4a9ae'), 1, side, hs, on);
      continue;
    }
    if (cls >= 6) {
      strip(ground, pts, w, ROAD_Y[cls], c.set(cls === 6 ? '#a8673f' : '#b9b4aa'), 2, 0, hs, on);
      continue;
    }
    strip(asphalt, pts, w, ROAD_Y[cls], c.set('#ffffff'), 6, 0, hs, on);
    if (cls <= 3) dashes(paint, pts, ROAD_Y[cls] + 0.004, white, hs, on && ((x, z) => on(x, z) + 0.01));
  }

  t.data.h.forEach((b, n) => {
    const [h, seed] = b;
    const ring: [number, number][] = [];
    for (let k = 2; k + 1 < b.length; k += 2) ring.push([b[k] / 10 + ox, b[k + 1] / 10 + oz]);
    // a landmark is modelled properly instead
    if (inLandmark(ring.reduce((s, p) => s + p[0], 0) / ring.length, ring.reduce((s, p) => s + p[1], 0) / ring.length)) return;
    let A = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x0, z0] = ring[k];
      const [x1, z1] = ring[(k + 1) % ring.length];
      A += x0 * z1 - x1 * z0;
    }
    const box = t.data.o[n];
    const floorArea = Math.abs(A) / 2;
    // on a slope it stands on its lowest corner (the walls go down to meet the ground)
    let base = Infinity;
    for (const [x, z] of ring) base = Math.min(base, G(x, z));
    if (!Number.isFinite(base)) base = 0;
    const top = base + h;
    // Kerala: most homes have a sloped roof of clay tiles; bigger and taller buildings are flat concrete
    const house = !!box && floorArea < 260 && h < 8 && seed % 100 < 62;
    const parapet = house ? 0 : 0.9;
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
      // the façade texture is one window bay (3 m) by one floor (3.2 m)
      const u0 = u / BAY;
      const u1 = (u + len) / BAY;
      const v1 = h / FLOOR_H;
      walls.vert(x0, base, z0, nx, 0, nz, u0, 0, wall);
      walls.vert(x1, base, z1, nx, 0, nz, u1, 0, wall);
      walls.vert(x1, top, z1, nx, 0, nz, u1, v1, wall);
      walls.vert(x0, base, z0, nx, 0, nz, u0, 0, wall);
      walls.vert(x1, top, z1, nx, 0, nz, u1, v1, wall);
      walls.vert(x0, top, z0, nx, 0, nz, u0, v1, wall);
      // a low wall round a flat roof
      if (parapet) {
        const rim = top + parapet;
        plain.vert(x0, top, z0, nx, 0, nz, 0, 0, wall);
        plain.vert(x1, top, z1, nx, 0, nz, 0, 0, wall);
        plain.vert(x1, rim, z1, nx, 0, nz, 0, 0, wall);
        plain.vert(x0, top, z0, nx, 0, nz, 0, 0, wall);
        plain.vert(x1, rim, z1, nx, 0, nz, 0, 0, wall);
        plain.vert(x0, rim, z0, nx, 0, nz, 0, 0, wall);
      }
      u += len;
    }
    // a shop on the ground floor, on the side facing the road
    if (h >= 3.5 && seed % 4 !== 0) {
      for (let k = 0; k < ring.length; k++) {
        const [x0, z0] = ring[k];
        const [x1, z1] = ring[(k + 1) % ring.length];
        const len = Math.hypot(x1 - x0, z1 - z0);
        if (len < 3.2) continue;
        const s = A > 0 ? 1 : -1;
        const nx = (s * (z1 - z0)) / len;
        const nz = (-s * (x1 - x0)) / len;
        const mx = (x0 + x1) / 2;
        const mz = (z0 + z1) / 2;
        if (!facesRoad(mx + nx * 6, mz + nz * 6) || facesRoad(mx + nx * 0.5, mz + nz * 0.5)) continue;
        // up to 9 m of it, in the middle
        const part = Math.min(1, 9 / len);
        const t0 = (1 - part) / 2;
        const ax = x0 + (x1 - x0) * t0 + nx * 0.07;
        const az = z0 + (z1 - z0) * t0 + nz * 0.07;
        const bx = x0 + (x1 - x0) * (1 - t0) + nx * 0.07;
        const bz = z0 + (z1 - z0) * (1 - t0) + nz * 0.07;
        const cell = (seed * 7 + n) % (SHOP_COLS * SHOP_ROWS);
        const u0 = (cell % SHOP_COLS) / SHOP_COLS;
        const u1 = u0 + 1 / SHOP_COLS;
        const v1 = 1 - Math.floor(cell / SHOP_COLS) / SHOP_ROWS;
        const v0 = v1 - 1 / SHOP_ROWS;
        // (which way round the board reads depends on the outline's direction)
        const [ua, ub] = s > 0 ? [u1, u0] : [u0, u1];
        const y0 = base + 2.75;
        const y1 = base + 3.55;
        boards.vert(ax, y0, az, nx, 0, nz, ua, v0, white1);
        boards.vert(bx, y0, bz, nx, 0, nz, ub, v0, white1);
        boards.vert(bx, y1, bz, nx, 0, nz, ub, v1, white1);
        boards.vert(ax, y0, az, nx, 0, nz, ua, v0, white1);
        boards.vert(bx, y1, bz, nx, 0, nz, ub, v1, white1);
        boards.vert(ax, y1, az, nx, 0, nz, ua, v1, white1);
        // the open shop front below it
        const q = [
          [ax, base + 0.15, az],
          [bx, base + 0.15, bz],
          [bx, base + 2.65, bz],
          [ax, base + 0.15, az],
          [bx, base + 2.65, bz],
          [ax, base + 2.65, az],
        ];
        // open, or its shutter down
        for (const [x, y, z] of q) plain.vert(x, y, z, nx, 0, nz, 0, 0, seed % 3 ? SHOP_OPEN : SHOP_SHUTTER);
        break;
      }
    }
    if (house) {
      hipRoof(tiled, box, ox, oz, top, c.set(TILE_RED[seed % TILE_RED.length]));
      return;
    }
    const roof = c.set(ROOF[(seed >> 5) % ROOF.length]);
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map(([x, z]) => new THREE.Vector2(x, z)),
      []
    );
    for (const tri of tris) for (const k of tri) roofs.vert(ring[k][0], top + 0.02, ring[k][1], 0, 1, 0, ring[k][0] / 3, ring[k][1] / 3, roof);
    // the black water tank nearly every Kerala roof has
    if (box && floorArea > 30 && seed % 10 < 7) {
      const [cx, cz, hx, hz, ang] = box;
      const fu = ((((seed >> 2) % 7) / 6) * 2 - 1) * Math.max(0, hx / 10 - 1.2);
      const fv = ((((seed >> 4) % 5) / 4) * 2 - 1) * Math.max(0, hz / 10 - 1.2);
      const x = cx / 10 + ox + fu * Math.cos(ang) - fv * Math.sin(ang);
      const z = cz / 10 + oz + fu * Math.sin(ang) + fv * Math.cos(ang);
      tanks.add(TANK, new THREE.Matrix4().makeTranslation(x, top, z), BLACK);
    }
  });

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
      for (const [x, z] of q) water.vert(x, G(x, z) + 0.008, z, 0, 1, 0, x / 40, z / 40, blue);
    }
    // beaches: open ground (sand, bare or by the water, as the land cover has it) within 40 m of
    // the water is sand; the water along a beach breaks white
    const N = cellsPerTile();
    const dist = new Uint8Array(N * N).fill(255);
    const queue: number[] = [];
    for (let k = 0; k < N * N; k++)
      if (waterAt(t, k % N, Math.floor(k / N))) {
        dist[k] = 0;
        queue.push(k);
      }
    for (let qi = 0; qi < queue.length; qi++) {
      const k = queue[qi];
      if (dist[k] >= 8) continue;
      const cx = k % N;
      const cz = Math.floor(k / N);
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const j = nz * N + nx;
        if (dist[j] > dist[k] + 1) {
          dist[j] = dist[k] + 1;
          queue.push(j);
        }
      }
    }
    const sandy = (k: number) => {
      if (dist[k] === 0 || dist[k] > 8) return false;
      const x = ox + ((k % N) + 0.5) * cell;
      const z = oz + (Math.floor(k / N) + 0.5) * cell;
      const kind = tileCover(t, x, z);
      return kind === COVER.bare || kind === COVER.water || (dist[k] <= 2 && kind === COVER.grass);
    };
    const isSand = new Uint8Array(N * N);
    for (let k = 0; k < N * N; k++) if (sandy(k)) isSand[k] = 1;
    const quad = (m: Mesh, cx: number, cz: number, lift: number, col: THREE.Color) => {
      const x0 = ox + cx * cell;
      const z0 = oz + cz * cell;
      const x1 = x0 + cell;
      const z1 = z0 + cell;
      for (const [x, z] of [[x0, z0], [x1, z0], [x1, z1], [x0, z0], [x1, z1], [x0, z1]]) m.vert(x, G(x, z) + lift, z, 0, 1, 0, x / 6, z / 6, col);
    };
    for (let k = 0; k < N * N; k++) {
      const cx = k % N;
      const cz = Math.floor(k / N);
      if (isSand[k]) quad(sand, cx, cz, 0.035, white1);
      // surf: water right by the sand
      else if (dist[k] === 0) {
        let byBeach = false;
        for (let dz = -2; dz <= 2 && !byBeach; dz++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx >= 0 && nz >= 0 && nx < N && nz < N && isSand[nz * N + nx]) {
              byBeach = true;
              break;
            }
          }
        if (byBeach) quad(surf, cx, cz, 0.03, white1);
      }
    }
  }

  return {
    land: landGeometry(t),
    asphalt: asphalt.geometry(),
    ground: ground.geometry(),
    paint: paint.geometry(),
    walls: walls.geometry(),
    plain: plain.geometry(),
    roofs: roofs.geometry(),
    tiled: tiled.geometry(),
    tanks: tanks.geometry(),
    water: water.geometry(),
    sand: sand.geometry(),
    surf: surf.geometry(),
    posts: posts.geometry(),
    heads: heads.geometry(),
    glows: glows.geometry(),
    boards: boards.geometry(),
    wires: wires.length ? new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(wires, 3)) : null,
    lamps,
  };
}

/** Ripples for the water: a tiling normal map made from a few crossing waves. */
function waveNormals() {
  const S = 256;
  const h = new Float32Array(S * S);
  const waves = Array.from({ length: 9 }, (_, i) => ({ kx: Math.round(Math.cos(i * 1.7) * (2 + i)), kz: Math.round(Math.sin(i * 1.7) * (2 + i)), a: 1 / (1 + i * 0.5), p: i * 2.1 }));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) v += w.a * Math.sin(((w.kx * x + w.kz * y) / S) * Math.PI * 2 + w.p);
      h[y * S + x] = v;
    }
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const img = g.createImageData(S, S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const dx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
      const dy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
      const n = new THREE.Vector3(-dx * 0.6, -dy * 0.6, 1).normalize();
      const o = (y * S + x) * 4;
      img.data[o] = (n.x * 0.5 + 0.5) * 255;
      img.data[o + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[o + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[o + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** Beach sand: pale, a little grainy, darker where the waves wet it (2 m a repeat at UV/6). */
function sandTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#e3d3ae';
    g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 5000; i++) {
      const l = 60 + Math.random() * 30;
      g.fillStyle = `hsla(40, 35%, ${l}%, 0.35)`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = 'rgba(150,120,80,0.08)';
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 256, 20 + Math.random() * 40, 6 + Math.random() * 10, Math.random() * 3, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/** Foam: broken white streaks. */
function foamTexture() {
  return canvasTexture(256, 256, (g) => {
    g.clearRect(0, 0, 256, 256);
    for (let i = 0; i < 260; i++) {
      g.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.5})`;
      g.beginPath();
      g.ellipse(Math.random() * 256, Math.random() * 256, 4 + Math.random() * 18, 1 + Math.random() * 3, Math.random() * 0.4, 0, Math.PI * 2);
      g.fill();
    }
  });
}

/**
 * Windows lit at night: the façade's window in a block of 8 bays × 8 floors, some lit warm
 * (bulbs), some cool (tube lights), most dark. Repeats every 8 windows, so neighbours differ.
 */
const LIT = 8;
function litWindows() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S * LIT;
  const g = c.getContext('2d')!;
  g.fillStyle = '#000';
  g.fillRect(0, 0, S * LIT, S * LIT);
  // the window's place in the façade texture (256 px there)
  const [wx0, wx1, wy0, wy1] = [68 / 2, 188 / 2, 70 / 2, 182 / 2];
  for (let j = 0; j < LIT; j++)
    for (let i = 0; i < LIT; i++) {
      const r = Math.random();
      if (r > 0.42) continue;
      g.fillStyle = r < 0.26 ? '#ffc777' : '#dfeaff';
      g.fillRect(i * S + wx0, j * S + wy0, wx1 - wx0, wy1 - wy0);
      // a curtain half drawn, now and then
      if (Math.random() < 0.4) {
        g.fillStyle = 'rgba(0,0,0,0.55)';
        g.fillRect(i * S + wx0, j * S + wy0, (wx1 - wx0) * (0.3 + Math.random() * 0.4), wy1 - wy0);
      }
    }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1 / LIT, 1 / LIT);
  return t;
}

/** One window bay along a wall, and one floor up it (the façade texture's size) */
const BAY = 3;
const FLOOR_H = 3.2;
const TILE_RED = ['#b4543a', '#a5492f', '#c06447', '#9b4a35'];
const BLACK = new THREE.Color('#2a2b2e');
const TANK = new THREE.CylinderGeometry(0.62, 0.62, 1.15, 8, 1).translate(0, 0.6, 0);

/**
 * A hipped roof of clay tiles over a building's box (centre, half sizes, angle; decimetres
 * for position and size), with the eaves reaching out past the walls.
 */
function hipRoof(m: Mesh, box: number[], ox: number, oz: number, h: number, colour: THREE.Color) {
  const [cx, cz, hx, hz, ang] = box;
  const x = cx / 10 + ox;
  const z = cz / 10 + oz;
  const co = Math.cos(ang);
  const si = Math.sin(ang);
  // the ridge runs along the longer side
  const long = hx >= hz;
  const a = (long ? hx : hz) / 10 + 0.5;
  const b = (long ? hz : hx) / 10 + 0.5;
  const rise = Math.min(2.6, b * 0.6);
  const r = Math.max(0, a - b);
  // corners and ridge ends in (along, across) space, then out into the world
  const P = (u: number, v: number, y: number): [number, number, number] => {
    const [lu, lv] = long ? [u, v] : [v, u];
    return [x + lu * co - lv * si, y, z + lu * si + lv * co];
  };
  const e = h - 0.25; // eaves a little below the top of the walls
  const c1 = P(-a, -b, e);
  const c2 = P(a, -b, e);
  const c3 = P(a, b, e);
  const c4 = P(-a, b, e);
  const r1 = P(-r, 0, h + rise);
  const r2 = P(r, 0, h + rise);
  const tri = (p: number[], q: number[], s: number[]) => {
    // facing up, whichever way round
    const ux = q[0] - p[0], uy = q[1] - p[1], uz = q[2] - p[2];
    const vx = s[0] - p[0], vy = s[1] - p[1], vz = s[2] - p[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    if (ny < 0) {
      [q, s] = [s, q];
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    const L = Math.hypot(nx, ny, nz) || 1;
    for (const pt of [p, q, s]) m.vert(pt[0], pt[1], pt[2], nx / L, ny / L, nz / L, pt[0] / 1.6, (pt[2] + pt[1]) / 1.6, colour);
  };
  tri(c1, c2, r2);
  tri(c1, r2, r1);
  tri(c3, c4, r1);
  tri(c3, r1, r2);
  tri(c2, c3, r2);
  tri(c4, c1, r1);
}

/** One bay of a Kerala building's front: plaster, a window with its frame and grill, the sunshade above. */
function facadeTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  // plaster, a little weathered towards the bottom
  const wash = g.createLinearGradient(0, 0, 0, S);
  wash.addColorStop(0, '#ffffff');
  wash.addColorStop(1, '#e9e6df');
  g.fillStyle = wash;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 900; i++) {
    g.fillStyle = `rgba(120,110,95,${Math.random() * 0.05})`;
    g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  // (the texture's top is the top of a floor: v grows upwards)
  const wx0 = 68, wx1 = 188, wy0 = 70, wy1 = 182;
  // the sunshade slab over the window and its shadow
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.fillRect(wx0 - 18, wy0 - 10, wx1 - wx0 + 36, 22);
  g.fillStyle = '#d9d5cc';
  g.fillRect(wx0 - 18, wy0 - 18, wx1 - wx0 + 36, 10);
  // frame, glass, grill
  g.fillStyle = '#f4f2ee';
  g.fillRect(wx0 - 6, wy0 - 6, wx1 - wx0 + 12, wy1 - wy0 + 12);
  const glass = g.createLinearGradient(0, wy0, 0, wy1);
  glass.addColorStop(0, '#3d5566');
  glass.addColorStop(1, '#1f2a33');
  g.fillStyle = glass;
  g.fillRect(wx0, wy0, wx1 - wx0, wy1 - wy0);
  g.fillStyle = 'rgba(255,255,255,0.12)';
  g.beginPath();
  g.moveTo(wx0, wy1);
  g.lineTo(wx0 + 40, wy0);
  g.lineTo(wx0 + 60, wy0);
  g.lineTo(wx0 + 20, wy1);
  g.fill();
  g.fillStyle = '#6b6f73';
  for (let x = wx0 + 15; x < wx1; x += 15) g.fillRect(x, wy0, 3, wy1 - wy0);
  g.fillStyle = '#f4f2ee';
  g.fillRect((wx0 + wx1) / 2 - 3, wy0, 6, wy1 - wy0);
  // the sill
  g.fillStyle = '#d4d0c7';
  g.fillRect(wx0 - 10, wy1 + 4, wx1 - wx0 + 20, 7);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Railway sleepers: short bars across the line every 0.7 m. */
function sleepers(m: Mesh, pts: number[], y: number, c: THREE.Color, hs?: number[], ground?: (x: number, z: number) => number) {
  let phase = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const dx = pts[i] - ax;
    const dz = pts[i + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    const ux = dx / len;
    const uz = dz / len;
    for (let s = phase; s < len; s += 0.7) {
      const x = ax + ux * s;
      const z = az + uz * s;
      const h = hs ? hs[i / 2 - 1] + ((hs[i / 2] - hs[i / 2 - 1]) * s) / len : 0;
      strip(m, [x + uz * 1.3, z - ux * 1.3, x - uz * 1.3, z + ux * 1.3], 0.24, y, c, 1, 0, [h, h], ground);
    }
    phase = (((phase - len) % 0.7) + 0.7) % 0.7;
  }
}

/** A line (x, z pairs) with extra points so no stretch is longer than `step` metres. */
function densify(pts: number[], step: number) {
  const out = [pts[0], pts[1]];
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const n = Math.ceil(Math.hypot(pts[i] - ax, pts[i + 1] - az) / step);
    for (let k = 1; k <= n; k++) out.push(ax + ((pts[i] - ax) * k) / n, az + ((pts[i + 1] - az) * k) / n);
  }
  return out;
}

/** The ground's height at each point of a road; a bridge runs straight from one end to the other. */
function roadHeights(pts: number[], bridge: boolean, G: (x: number, z: number) => number) {
  const n = pts.length / 2;
  if (!bridge) return Array.from({ length: n }, (_, k) => G(pts[k * 2], pts[k * 2 + 1]));
  const along = [0];
  for (let k = 1; k < n; k++) along.push(along[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]));
  const total = along[n - 1] || 1;
  const h0 = G(pts[0], pts[1]);
  const h1 = G(pts[n * 2 - 2], pts[n * 2 - 1]);
  return along.map((d) => h0 + ((h1 - h0) * d) / total);
}

/** The tile's ground: a grid of its heights (or nothing, where the ground is flat), split into
 *  triangles the same way as its physics ground so you stand exactly on what you see. */
function landGeometry(t: Tile) {
  const meta = getMeta()!;
  if (!t.ground || !meta.hstep || !meta.hn) return null;
  const n = meta.hn;
  const step = meta.hstep;
  const pos = new Float32Array(n * n * 3);
  const uv = new Float32Array(n * n * 2);
  const col = new Float32Array(n * n * 3);
  for (let r = 0; r < n; r++)
    for (let q = 0; q < n; q++) {
      const k = r * n + q;
      const x = t.i * meta.tile + q * step;
      const z = t.j * meta.tile + r * step;
      pos.set([x, t.ground[k] - 0.03, z], k * 3);
      uv.set([x / 4, z / 4], k * 2);
      // the ground's colour from what grows (or doesn't) there, blended across a few cells
      let cr = 0, cg = 0, cb = 0;
      for (const [dx, dz] of [[0, 0], [-12, -12], [12, -12], [-12, 12], [12, 12]]) {
        const c = GROUND_TINT[tileCover(t, x + dx, z + dz)] ?? GROUND_TINT[0];
        cr += c[0] / 5;
        cg += c[1] / 5;
        cb += c[2] / 5;
      }
      col.set([cr, cg, cb], k * 3);
    }
  const index: number[] = [];
  for (let r = 0; r < n - 1; r++)
    for (let q = 0; q < n - 1; q++) {
      const a = r * n + q; // (x, z)
      const b = r * n + q + 1; // (x + 1, z)
      const c = (r + 1) * n + q; // (x, z + 1)
      const d = (r + 1) * n + q + 1; // (x + 1, z + 1)
      // facing up, split along b–c
      index.push(a, c, b, b, c, d);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** How the grass looks over each kind of ground (ESA WorldCover class → tint) */
const GROUND_TINT: Record<number, [number, number, number]> = {
  0: [1, 1, 1],
  [COVER.trees]: [0.78, 0.92, 0.72], // shade under the trees
  [COVER.shrubs]: [0.98, 0.96, 0.8],
  [COVER.grass]: [1.05, 1.08, 0.86],
  [COVER.crops]: [1.08, 1.28, 0.7], // bright paddy
  [COVER.built]: [1.12, 0.92, 0.78], // dusty laterite
  [COVER.bare]: [1.35, 0.95, 0.72], // red laterite
  [COVER.water]: [1.45, 1.35, 1.05], // sand at the water's edge
  [COVER.wetland]: [0.82, 1.05, 0.88],
  [COVER.mangroves]: [0.7, 0.86, 0.72],
};

/** The hand-made street and its shops (they have their own lamps and palms). */
const SITE = { x0: -64, x1: 64, z0: -34, z1: 40 };
const inSite = (x: number, z: number) => x > SITE.x0 && x < SITE.x1 && z > SITE.z0 && z < SITE.z1;

const POLE = new THREE.BoxGeometry(0.14, 7, 0.14).translate(0, 3.5, 0);
const ARM = new THREE.BoxGeometry(1.5, 0.08, 0.08).translate(0.75, 6.9, 0);
const HEAD = new THREE.BoxGeometry(0.62, 0.1, 0.3).translate(1.45, 6.84, 0);
const GLOW = new THREE.PlaneGeometry(18, 18).rotateX(-Math.PI / 2);
const STEEL = new THREE.Color('#6b7075');

/** Street lights along a road: on alternate sides of big roads, one side of small ones, leaning over it. */
function streetLamps(pts: number[], w: number, cls: number, posts: Mesh, heads: Mesh, glows: Mesh, lamps: [number, number, number][], onRoad: (x: number, z: number) => boolean, G: (x: number, z: number) => number) {
  const every = cls <= 2 ? 30 : 42;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let next = every / 2;
  let walked = 0;
  let n = 0;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const dx = pts[i] - ax;
    const dz = pts[i + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    while (next <= walked + len) {
      const f = (next - walked) / len;
      next += every;
      const side = cls <= 2 && n++ % 2 ? -1 : 1;
      // left of the direction of travel is (dz, -dx)… times side
      const nx = (dz / len) * side;
      const nz = (-dx / len) * side;
      const px = ax + dx * f + nx * (w / 2 + 0.7);
      const pz = az + dz * f + nz * (w / 2 + 0.7);
      if (inSite(px, pz) || onRoad(px, pz)) continue;
      // the arm points back over the road
      q.setFromAxisAngle(up, Math.atan2(nz, -nx));
      const gy = G(px, pz);
      m.compose(new THREE.Vector3(px, gy, pz), q, new THREE.Vector3(1, 1, 1));
      posts.add(POLE, m, STEEL);
      posts.add(ARM, m, STEEL);
      heads.add(HEAD, m, white1);
      const hx = px - nx * 1.45;
      const hz = pz - nz * 1.45;
      glows.add(GLOW, new THREE.Matrix4().makeTranslation(hx, G(hx, hz) + 0.05, hz), white1);
      lamps.push([hx, gy + 6.7, hz]);
    }
    walked += len;
  }
}
const white1 = new THREE.Color('#ffffff');

// KSEB electricity poles: concrete, a cross-arm with three insulators, wires sagging between
const ELEC_POLE = mergeGeometries([
  new THREE.BoxGeometry(0.2, 8.4, 0.2).translate(0, 4.2, 0),
  new THREE.BoxGeometry(0.1, 0.1, 1.5).translate(0, 7.7, 0),
  ...[-0.6, 0, 0.6].map((z) => new THREE.CylinderGeometry(0.04, 0.05, 0.16, 6).translate(0, 7.83, z)),
]);
const CONCRETE = new THREE.Color('#a9a59c');

/** Poles along one side of a road (opposite its lamps), every ~34 m, and the wires between them. */
function electricity(pts: number[], w: number, poles: Mesh, wires: number[], onRoad: (x: number, z: number) => boolean, G: (x: number, z: number) => number) {
  const every = 34;
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  let next = every * 0.3;
  let walked = 0;
  let prev: THREE.Vector3[] | null = null;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2];
    const az = pts[i - 1];
    const dx = pts[i] - ax;
    const dz = pts[i + 1] - az;
    const len = Math.hypot(dx, dz);
    if (len < 0.01) continue;
    while (next <= walked + len) {
      const f = (next - walked) / len;
      next += every;
      // the right of the direction of travel (lamps are on the left)
      const nx = -dz / len;
      const nz = dx / len;
      const px = ax + dx * f + nx * (w / 2 + 1.3);
      const pz = az + dz * f + nz * (w / 2 + 1.3);
      if (inSite(px, pz) || onRoad(px, pz) || inLandmark(px, pz)) {
        prev = null;
        continue;
      }
      // the cross-arm runs across the road
      q.setFromAxisAngle(up, Math.atan2(-dz, dx));
      const gy = G(px, pz);
      m.compose(new THREE.Vector3(px, gy, pz), q, new THREE.Vector3(1, 1, 1));
      poles.add(ELEC_POLE, m, CONCRETE);
      const tops = [-0.6, 0, 0.6].map((s) => new THREE.Vector3(px + nx * s, gy + 7.9, pz + nz * s));
      if (prev) {
        // each wire sags a little between the poles (a few straight pieces)
        for (let k = 0; k < 3; k++) {
          const a = prev[k];
          const b = tops[k];
          const span = a.distanceTo(b);
          if (span > every * 2.2 || Math.abs(a.y - b.y) > 5) continue;
          let last = a;
          for (let sgi = 1; sgi <= 6; sgi++) {
            const t = sgi / 6;
            const p = a.clone().lerp(b, t);
            p.y -= 4 * t * (1 - t) * span * 0.018;
            wires.push(last.x, last.y, last.z, p.x, p.y, p.z);
            last = p;
          }
        }
      }
      prev = tops;
    }
    walked += len;
  }
}

/* Shops: most buildings facing a proper road have a shop on the ground floor, with its board. */
const SHOP_KINDS = ['SUPERMARKET', 'BAKERY', 'TEXTILES', 'MEDICALS', 'HOTEL', 'MOBILES', 'HARDWARES', 'STORES', 'FANCY', 'JEWELLERY', 'OPTICALS', 'TAILORS', 'TEA STALL', 'FOOTWEAR', 'ELECTRICALS', 'BOOK STALL'];
const SHOP_ML = ['സൂപ്പർമാർക്കറ്റ്', 'ബേക്കറി', 'ടെക്സ്റ്റൈൽസ്', 'മെഡിക്കൽസ്', 'ഹോട്ടൽ', 'മൊബൈൽസ്', 'ഹാർഡ്‌വെയേഴ്സ്', 'സ്റ്റോഴ്സ്', 'ഫാൻസി', 'ജ്വല്ലറി', 'ഒപ്റ്റിക്കൽസ്', 'ടെയ്‌ലേഴ്സ്', 'ചായക്കട', 'ഫുട്‌വെയർ', 'ഇലക്ട്രിക്കൽസ്', 'ബുക്ക് സ്റ്റാൾ'];
const SHOP_NAMES = ['NEW', 'SREE', 'AL', 'CITY', 'MALABAR', 'STAR', 'ROYAL', 'GREEN', 'KASARAGOD', 'CHANDRAGIRI', 'BEKAL', 'FRIENDS'];
const SHOP_COLS = 8;
const SHOP_ROWS = 16;
let shopAtlas: THREE.Texture | null = null;
function shopBoards() {
  if (shopAtlas) return shopAtlas;
  const W = 256;
  const H = 64;
  const canvas = document.createElement('canvas');
  canvas.width = W * SHOP_COLS;
  canvas.height = H * SHOP_ROWS;
  const g = canvas.getContext('2d')!;
  const bg = ['#c62828', '#1565c0', '#2e7d32', '#f9a825', '#ffffff', '#6a1b9a', '#ef6c00', '#00838f'];
  for (let i = 0; i < SHOP_COLS * SHOP_ROWS; i++) {
    const x = (i % SHOP_COLS) * W;
    const y = Math.floor(i / SHOP_COLS) * H;
    const b = bg[(i * 5) % bg.length];
    g.fillStyle = b;
    g.fillRect(x, y, W, H);
    g.fillStyle = b === '#ffffff' || b === '#f9a825' ? '#b71c1c' : '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const kind = i % SHOP_KINDS.length;
    const name = `${SHOP_NAMES[Math.floor(i / SHOP_KINDS.length) % SHOP_NAMES.length]} ${SHOP_KINDS[kind]}`;
    let size = 30;
    g.font = `900 ${size}px Arial, sans-serif`;
    while (g.measureText(name).width > W - 16 && size > 12) g.font = `900 ${(size -= 2)}px Arial, sans-serif`;
    g.fillText(name, x + W / 2, y + 22);
    g.font = '700 17px sans-serif';
    g.fillText(SHOP_ML[kind], x + W / 2, y + 48);
  }
  shopAtlas = new THREE.CanvasTexture(canvas);
  shopAtlas.colorSpace = THREE.SRGBColorSpace;
  shopAtlas.anisotropy = 8;
  return shopAtlas;
}
const SHOP_OPEN = new THREE.Color('#75614f');
const SHOP_SHUTTER = new THREE.Color('#8e9194');

/** A quick test for "is (x, z) on any of this tile's roads (with `pad` metres to spare)?" */
function roadTester(t: Tile, pad: number, maxClass = 99) {
  const size = getMeta()!.tile;
  const ox = t.i * size;
  const oz = t.j * size;
  const CELL = 40;
  const N = size / CELL;
  const cells: number[][][] = Array.from({ length: N * N }, () => []);
  for (const r of t.data.b) {
    if (r[0] > maxClass) continue;
    const reach = r[1] / 2 + pad;
    for (let k = 5; k + 1 < r.length; k += 2) {
      const ax = r[k - 2] / 10 + ox;
      const az = r[k - 1] / 10 + oz;
      const bx = r[k] / 10 + ox;
      const bz = r[k + 1] / 10 + oz;
      for (let j = Math.max(0, Math.floor((Math.min(az, bz) - reach - oz) / CELL)); j <= Math.min(N - 1, Math.floor((Math.max(az, bz) + reach - oz) / CELL)); j++)
        for (let i = Math.max(0, Math.floor((Math.min(ax, bx) - reach - ox) / CELL)); i <= Math.min(N - 1, Math.floor((Math.max(ax, bx) + reach - ox) / CELL)); i++) cells[j * N + i].push([ax, az, bx, bz, reach]);
    }
  }
  return (x: number, z: number) => {
    const i = Math.floor((x - ox) / CELL);
    const j = Math.floor((z - oz) / CELL);
    if (i < 0 || j < 0 || i >= N || j >= N) return false;
    return cells[j * N + i].some(([ax, az, bx, bz, reach]) => {
      const L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1e-9;
      const u = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / L2));
      return Math.hypot(x - (ax + (bx - ax) * u), z - (az + (bz - az) * u)) < reach;
    });
  };
}

/** How thickly trees grow on each kind of ground (chance per 16 m square) */
const TREES: Record<number, number> = {
  [COVER.trees]: 0.5,
  [COVER.mangroves]: 0.7,
  [COVER.shrubs]: 0.14,
  [COVER.grass]: 0.04,
  [COVER.crops]: 0.025, // a palm on the bund now and then
  [COVER.built]: 0.09,
  [COVER.bare]: 0.02,
  [COVER.wetland]: 0.08,
};

/** Coconut palms and leafy trees over the land, as thick as what really grows there, off the roads, clear of buildings and water. */
function scatterPalms(t: Tile): { palms: PalmSpot[]; trees: PalmSpot[] } {
  const meta = getMeta()!;
  const size = meta.tile;
  const ox = t.i * size;
  const oz = t.j * size;
  const CELL = 40;
  const N = size / CELL;
  const onRoad = roadTester(t, 2.5);
  const boxesIn: number[][][] = Array.from({ length: N * N }, () => []);
  const mark = (list: number[][][], x0: number, z0: number, x1: number, z1: number, item: number[]) => {
    for (let j = Math.max(0, Math.floor((z0 - oz) / CELL)); j <= Math.min(N - 1, Math.floor((z1 - oz) / CELL)); j++)
      for (let i = Math.max(0, Math.floor((x0 - ox) / CELL)); i <= Math.min(N - 1, Math.floor((x1 - ox) / CELL)); i++) list[j * N + i].push(item);
  };
  for (const [cx, cz, hx, hz, ang] of t.data.o) {
    const x = cx / 10 + ox;
    const z = cz / 10 + oz;
    const r = Math.hypot(hx, hz) / 10 + 2;
    mark(boxesIn, x - r, z - r, x + r, z + r, [x, z, hx / 10 + 1.5, hz / 10 + 1.5, ang]);
  }
  const rand = rng(t.i * 7919 + t.j * 104729 + 17);
  const out: PalmSpot[] = [];
  const trees: PalmSpot[] = [];
  const STEP = 16;
  for (let gz = 0; gz < size; gz += STEP)
    for (let gx = 0; gx < size; gx += STEP) {
      const x = ox + gx + rand() * STEP;
      const z = oz + gz + rand() * STEP;
      // as thick as what really grows there (or, without land cover, in groves)
      const kind = tileCover(t, x, z);
      const grove = (Math.sin(x / 83) + Math.sin(z / 61 + x / 140) + 2) / 4;
      const density = t.cover ? (TREES[kind] ?? 0) : grove * grove * 0.75;
      if (rand() > density) continue;
      if (x >= ox + size || z >= oz + size || inSite(x, z) || isWater(x, z) || inLandmark(x, z)) continue;
      const cell = Math.floor((z - oz) / CELL) * N + Math.floor((x - ox) / CELL);
      if (onRoad(x, z)) continue;
      const inBuilding = boxesIn[cell].some(([bx, bz, hx, hz, ang]) => {
        const c = Math.cos(ang);
        const s = Math.sin(ang);
        const u = (x - bx) * c + (z - bz) * s;
        const v = -(x - bx) * s + (z - bz) * c;
        return Math.abs(u) < hx && Math.abs(v) < hz;
      });
      if (inBuilding) continue;
      // coconut palms, or (in woods and mangroves) leafy trees
      const leafy = kind === COVER.mangroves || (kind === COVER.trees && rand() < 0.45) || (kind === COVER.shrubs && rand() < 0.6);
      // woodland trees grow big; scrub stays low
      const scale = leafy ? (kind === COVER.shrubs ? 0.45 : kind === COVER.trees ? 1.1 : 0.8) + rand() * 0.5 : 0.8 + rand() * 0.45;
      (leafy ? trees : out).push({ x, z, y: tileGround(t, x, z), scale, turn: rand() * Math.PI * 2 });
      if (out.length + trees.length >= 850) return { palms: out, trees };
    }
  return { palms: out, trees };
}

/** A leafy tree (mango, jackfruit, the woods): a trunk and a few clumps of leaves, low-poly. */
const LEAF_TREE = (() => {
  const trunk = new THREE.CylinderGeometry(0.16, 0.26, 3.2, 6, 1).translate(0, 1.6, 0);
  const clumps = [
    [0, 4.6, 0, 2.3],
    [1.3, 4.1, 0.4, 1.6],
    [-1.1, 4.2, -0.6, 1.7],
    [0.2, 5.4, -0.9, 1.5],
  ].map(([x, y, z, r]) => new THREE.IcosahedronGeometry(r, 1).translate(x, y, z));
  return { trunk, leaves: mergeGeometries(clumps.map((g) => g.toNonIndexed()))! };
})();
const TREE_MATS = {
  trunk: new THREE.MeshStandardMaterial({ color: '#5b4636', roughness: 1 }),
  leaves: new THREE.MeshStandardMaterial({ color: '#3f6b2f', roughness: 0.9, flatShading: true }),
};

function LeafyTrees({ spots }: { spots: PalmSpot[] }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const leaves = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const shade = new THREE.Color();
    spots.forEach((p, i) => {
      q.setFromAxisAngle(up, p.turn ?? 0);
      const k = p.scale ?? 1;
      m.compose(v.set(p.x, p.y ?? 0, p.z), q, s.set(k, k * (0.85 + ((i * 37) % 10) / 30), k));
      trunks.current?.setMatrixAt(i, m);
      leaves.current?.setMatrixAt(i, m);
      // no two quite the same green
      leaves.current?.setColorAt(i, shade.setHSL(0.27 + ((i * 13) % 9) / 100, 0.45, 0.32 + ((i * 7) % 10) / 100));
    });
    for (const r of [trunks, leaves]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (r.current.instanceColor) r.current.instanceColor.needsUpdate = true;
      r.current.computeBoundingSphere();
    }
  }, [spots]);
  return (
    <group>
      <instancedMesh ref={trunks} args={[LEAF_TREE.trunk, TREE_MATS.trunk, spots.length]} castShadow receiveShadow raycast={noRaycast} />
      <instancedMesh ref={leaves} args={[LEAF_TREE.leaves, TREE_MATS.leaves, spots.length]} castShadow receiveShadow raycast={noRaycast} />
    </group>
  );
}

/** Lights for a tile's lamps (shared real lights go to the nearest ones at night). */
function TileLamps({ at }: { at: [number, number, number][] }) {
  const lights = useRef<(VirtualLight | null)[]>([]);
  useFrame(() => {
    const on = world.night * 30;
    for (const l of lights.current) if (l) l.intensity = on;
  });
  return (
    <>
      {at.map((p, i) => (
        <Lamp key={i} ref={(l) => (lights.current[i] = l)} position={p} color="#ffd9a6" distance={22} decay={1.5} intensity={0} />
      ))}
    </>
  );
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
    const gy = tileGround(t, x, z);
    // the post
    const p = 0.05;
    for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const ax = x + nx * p - nz * p;
      const az = z + nz * p + nx * p;
      const bx = x + nx * p + nz * p;
      const bz = z + nz * p - nx * p;
      const q = [[ax, 0, az], [bx, 0, bz], [bx, TOP, bz], [ax, 0, az], [bx, TOP, bz], [ax, TOP, az]] as const;
      for (const [qx, qy, qz] of q) posts.vert(qx, qy + gy, qz, nx, 0, nz, 0, 0, grey);
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
      for (const [[qx, qz], qy, qu, qv] of q) boards.vert(qx + nx * 0.012, qy + gy, qz + nz * 0.012, nx, 0, nz, qu, qv, white);
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
    // the ground itself: a height grid (rows run along z, columns along x)
    const meta = getMeta()!;
    if (t.ground && meta.hn) {
      const n = meta.hn;
      const heights = new Float32Array(n * n);
      for (let iz = 0; iz < n; iz++) for (let ix = 0; ix < n; ix++) heights[iz + ix * n] = t.ground[iz * n + ix];
      const desc = rapier.ColliderDesc.heightfield(n - 1, n - 1, heights, { x: size, y: 1, z: size }).setTranslation(ox + size / 2, 0, oz + size / 2);
      made.push(physics.createCollider(desc));
    }
    for (const [cx, cz, hx, hz, ang, h] of t.data.o) {
      q.setFromAxisAngle(up, -ang);
      const x = cx / 10 + ox;
      const z = cz / 10 + oz;
      if (inLandmark(x, z)) continue;
      // standing on its lowest corner, as it's drawn
      const r = Math.hypot(hx, hz) / 10;
      const base = Math.min(tileGround(t, x - r, z - r), tileGround(t, x + r, z - r), tileGround(t, x - r, z + r), tileGround(t, x + r, z + r), tileGround(t, x, z));
      const desc = rapier.ColliderDesc.cuboid(hx / 10, h / 2, hz / 10)
        .setTranslation(x, base + h / 2, z)
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
        const wx = ox + ((a + e) * cell) / 2;
        const wz = oz + ((b + f) * cell) / 2;
        const desc = rapier.ColliderDesc.cuboid(((e - a) * cell) / 2, 0.7, ((f - b) * cell) / 2).setTranslation(wx, tileGround(t, wx, wz) + 0.5, wz);
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
  land: THREE.MeshStandardMaterial;
  plain: THREE.MeshStandardMaterial;
  tiled: THREE.MeshStandardMaterial;
  tank: THREE.MeshStandardMaterial;
  roofs: THREE.MeshStandardMaterial;
  water: THREE.MeshStandardMaterial;
  post: THREE.MeshStandardMaterial;
  lampPost: THREE.MeshStandardMaterial;
  lampHead: THREE.MeshStandardMaterial;
  glow: THREE.MeshBasicMaterial;
  boards: THREE.MeshStandardMaterial;
  wire: THREE.LineBasicMaterial;
  sand: THREE.MeshStandardMaterial;
  surf: THREE.MeshBasicMaterial;
}

function TileView({ tile, mats, near }: { tile: Tile; mats: Mats; near: boolean }) {
  const built = useMemo<Built>(() => buildTile(tile), [tile]);
  const signs = useMemo(() => (near ? buildSigns(tile) : null), [tile, near]);
  const greenery = useMemo(() => (near ? scatterPalms(tile) : { palms: [], trees: [] }), [tile, near]);
  const boardMat = useMemo(() => (signs ? new THREE.MeshStandardMaterial({ map: signs.texture, roughness: 0.5 }) : null), [signs]);
  useEffect(
    () => () => {
      for (const g of Object.values(built)) if (g instanceof THREE.BufferGeometry) g.dispose();
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
      {built.land && <mesh geometry={built.land} material={mats.land} receiveShadow raycast={noRaycast} />}
      {built.water && <mesh geometry={built.water} material={mats.water} receiveShadow raycast={noRaycast} />}
      {built.sand && <mesh geometry={built.sand} material={mats.sand} receiveShadow raycast={noRaycast} />}
      {built.surf && <mesh geometry={built.surf} material={mats.surf} renderOrder={2} raycast={noRaycast} />}
      {built.ground && <mesh geometry={built.ground} material={mats.ground} receiveShadow raycast={noRaycast} />}
      {built.asphalt && <mesh geometry={built.asphalt} material={mats.asphalt} receiveShadow raycast={noRaycast} />}
      {built.paint && <mesh geometry={built.paint} material={mats.paint} receiveShadow raycast={noRaycast} />}
      {built.walls && <mesh geometry={built.walls} material={mats.walls} castShadow={near} receiveShadow raycast={noRaycast} />}
      {built.roofs && <mesh geometry={built.roofs} material={mats.roofs} castShadow={near} receiveShadow raycast={noRaycast} />}
      {built.plain && <mesh geometry={built.plain} material={mats.plain} castShadow={near} receiveShadow raycast={noRaycast} />}
      {built.tiled && <mesh geometry={built.tiled} material={mats.tiled} castShadow={near} receiveShadow raycast={noRaycast} />}
      {built.tanks && <mesh geometry={built.tanks} material={mats.tank} castShadow={near} raycast={noRaycast} />}
      {signs && boardMat && (
        <>
          <mesh geometry={signs.posts} material={mats.post} castShadow raycast={noRaycast} />
          <mesh geometry={signs.boards} material={boardMat} raycast={noRaycast} />
        </>
      )}
      {built.posts && <mesh geometry={built.posts} material={mats.lampPost} castShadow={near} raycast={noRaycast} />}
      {built.heads && <mesh geometry={built.heads} material={mats.lampHead} raycast={noRaycast} />}
      {built.glows && <mesh geometry={built.glows} material={mats.glow} renderOrder={1} raycast={noRaycast} />}
      {built.boards && <mesh geometry={built.boards} material={mats.boards} receiveShadow raycast={noRaycast} />}
      {near && built.wires && <lineSegments geometry={built.wires} material={mats.wire} raycast={noRaycast} />}
      {near && built.lamps.length > 0 && <TileLamps at={built.lamps} />}
      {greenery.palms.length > 0 && <Palms spots={greenery.palms} />}
      {greenery.trees.length > 0 && <LeafyTrees spots={greenery.trees} />}
    </group>
  );
}

/** A soft round spot, bright in the middle. */
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Grid cells per side of one block of the far land (see FarLand). */
const FAR_BLOCK = 64;

/**
 * Kasaragod beyond the tiles you're near: the whole district's hills as one coarse mesh,
 * painted with the map's overview (land, roads, rivers, the sea), a little below the
 * detailed ground so it only shows past it.
 */
function FarLand() {
  const [meta, setMeta] = useState(getMeta);
  useEffect(() => onMapChange(() => setMeta(getMeta())), []);
  const far = meta?.far;
  const geometry = useMemo(() => {
    if (!far || !meta) return null;
    const heights = new Int16Array(Uint8Array.from(atob(far.g), (c) => c.charCodeAt(0)).buffer);
    const { nx, nz, step, x0, z0 } = far;
    const pos = new Float32Array(nx * nz * 3);
    const uv = new Float32Array(nx * nz * 2);
    const w = meta.overview.w * meta.overview.mpp;
    const h = meta.overview.h * meta.overview.mpp;
    for (let r = 0; r < nz; r++)
      for (let q = 0; q < nx; q++) {
        const k = r * nx + q;
        const x = x0 + q * step;
        const z = z0 + r * step;
        // well under the detailed ground (the coarse grid can sit higher on a slope)
        pos.set([x, heights[k] - 8, z], k * 3);
        uv.set([(x - meta.overview.x0) / w, 1 - (z - meta.overview.z0) / h], k * 2);
      }
    // one set of vertices, cut into blocks: a block that's behind you or past the fog isn't drawn
    const whole = new THREE.BufferGeometry();
    whole.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    whole.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const index: number[] = [];
    for (let r = 0; r < nz - 1; r++)
      for (let q = 0; q < nx - 1; q++) {
        const a = r * nx + q;
        index.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
      }
    whole.setIndex(index);
    whole.computeVertexNormals();
    const normal = whole.attributes.normal;
    const blocks: THREE.BufferGeometry[] = [];
    for (let r0 = 0; r0 < nz - 1; r0 += FAR_BLOCK)
      for (let q0 = 0; q0 < nx - 1; q0 += FAR_BLOCK) {
        const r1 = Math.min(nz - 1, r0 + FAR_BLOCK);
        const q1 = Math.min(nx - 1, q0 + FAR_BLOCK);
        const part: number[] = [];
        for (let r = r0; r < r1; r++)
          for (let q = q0; q < q1; q++) {
            const a = r * nx + q;
            part.push(a, a + nx, a + 1, a + 1, a + nx, a + nx + 1);
          }
        const b = new THREE.BufferGeometry();
        b.setAttribute('position', whole.attributes.position);
        b.setAttribute('normal', normal);
        b.setAttribute('uv', whole.attributes.uv);
        b.setIndex(part);
        b.computeBoundingSphere();
        blocks.push(b);
      }
    return blocks;
  }, [far, meta]);
  const material = useMemo(() => {
    const tex = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}map/overview.png`);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    // greener than the map's paper colour, like the land up close
    return new THREE.MeshStandardMaterial({ map: tex, color: '#9fbf7a', roughness: 1, polygonOffset: true, polygonOffsetFactor: 8, polygonOffsetUnits: 16 });
  }, []);
  useEffect(() => () => geometry?.forEach((g) => g.dispose()), [geometry]);
  if (!geometry) return null;
  return (
    <group>
      {geometry.map((g, i) => (
        <mesh key={i} geometry={g} material={material} receiveShadow raycast={noRaycast} />
      ))}
    </group>
  );
}

/** Grass under everything, following the camera (in steps, so the texture stays put). */
function Ground({ mat }: { mat: THREE.MeshStandardMaterial }) {
  const mesh = useRef<THREE.Mesh>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    if (!mesh.current) return;
    // only where no tile has its own ground (past the map, or before a tile loads): far down out of the way
    mesh.current.position.set(Math.round(camera.position.x / 8) * 8, getMeta()?.hstep ? -45 : -0.03, Math.round(camera.position.z / 8) * 8);
  });
  return (
    <mesh ref={mesh} rotation-x={-Math.PI / 2} material={mat} receiveShadow raycast={noRaycast}>
      {/* in 50 m squares: one huge pair of triangles loses depth precision near you and shows through the street */}
      <planeGeometry args={[6000, 6000, 120, 120]} />
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
  // previews (?debug): the physics, to check the ground by casting rays at it
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esPhysics: physics, esRapier: rapier });
  }, [physics, rapier]);
  const [meta, setMeta] = useState(getMeta);
  useEffect(() => onMapChange(() => setMeta(getMeta())), []);
  const ground = useRef<Collider | null>(null);
  // flat maps: a ground box that follows you. With hills each tile has its own ground instead.
  const flat = meta ? !meta.hstep : true;
  useEffect(() => {
    if (!flat) return;
    const c = physics.createCollider(rapier.ColliderDesc.cuboid(200, 1, 200).setTranslation(world.player.x, -1, world.player.z));
    ground.current = c;
    return () => {
      ground.current = null;
      if (physics.getCollider(c.handle)) physics.removeCollider(c, false);
    };
  }, [physics, rapier, flat]);
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
    // (tall: the hills inland rise hundreds of metres)
    const wall = (cx: number, cz: number, hx: number, hz: number) => made.push(physics.createCollider(rapier.ColliderDesc.cuboid(hx, 1200, hz).setTranslation(cx, 0, cz)));
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
  const clay = usePBR('clay_roof_tiles', [1, 1]);
  // Kerala green (the texture alone reads as dry ground)
  const grass = usePBR('sparse_grass', [3000, 3000], { tint: '#a9cf7c' });
  // the same grass on the hills (their UVs are in 4 m steps)
  const land = usePBR('sparse_grass', [1, 1], { tint: '#a9cf7c' });
  const mats = useMemo<Mats>(() => {
    // flat layers lie a hair apart; push the lower ones back so far roads don't flicker
    const offset = <M extends THREE.Material>(m: M, units: number) => Object.assign(m, { polygonOffset: true, polygonOffsetFactor: units, polygonOffsetUnits: units * 2 });
    offset(grass, 6);
    // the texture is dry brown grass: turn it monsoon-green (Kerala is green most of the year)
    for (const m of [grass, land]) {
      m.color.setRGB(1.05, 2.35, 1.35);
      m.userData.baseColor = m.color.clone();
    }
    return {
      asphalt: offset(Object.assign(asphalt, { side: THREE.DoubleSide }), 0),
      ground: offset(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide }), 2),
      paint: offset(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }), -2),
      walls: new THREE.MeshStandardMaterial({ map: facadeTexture(), emissive: '#ffffff', emissiveMap: litWindows(), emissiveIntensity: 0, vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
      plain: Object.assign(plaster, { vertexColors: true, side: THREE.DoubleSide }),
      land: offset(Object.assign(land, { vertexColors: true }), 5),
      tiled: Object.assign(clay, { vertexColors: true, side: THREE.DoubleSide }),
      tank: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45 }),
      roofs: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }),
      water: offset(new THREE.MeshStandardMaterial({ color: '#2f7f95', roughness: 0.08, metalness: 0.2, envMapIntensity: 1.6, side: THREE.DoubleSide, normalMap: waveNormals(), normalScale: new THREE.Vector2(0.55, 0.55) }), 4),
      sand: offset(new THREE.MeshStandardMaterial({ map: sandTexture(), roughness: 1, side: THREE.DoubleSide }), -1),
      surf: offset(new THREE.MeshBasicMaterial({ map: foamTexture(), color: '#ffffff', transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, fog: true }), -3),
      post: new THREE.MeshStandardMaterial({ color: '#8d9095', roughness: 0.6, metalness: 0.4 }),
      lampPost: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.7 }),
      lampHead: new THREE.MeshStandardMaterial({ color: '#d9dde0', emissive: '#ffe7c2', emissiveIntensity: 0, roughness: 0.3 }),
      boards: new THREE.MeshStandardMaterial({ map: shopBoards(), side: THREE.DoubleSide, roughness: 0.55, emissive: '#ffffff', emissiveMap: shopBoards(), emissiveIntensity: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }),
      wire: new THREE.LineBasicMaterial({ color: '#26282b' }),
      // a warm pool of light on the road under each lamp, at night
      glow: offset(
        new THREE.MeshBasicMaterial({
          map: glowTexture(),
          color: '#ffcf8a',
          transparent: true,
          opacity: 0,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          fog: true,
        }),
        -4
      ),
    };
  }, [asphalt, plaster, clay, grass, land]);
  const wetting = useMemo(() => [mats.asphalt, grass, land], [mats, grass, land]);
  useFrame(() => {
    applyWetness(wetting, world.wet);
    mats.lampHead.emissiveIntensity = world.night * 4;
    // the sea moves, and the surf rolls in
    const tw = performance.now() / 1000;
    mats.water.normalMap?.offset.set(tw * 0.012, tw * 0.007);
    if (mats.surf.map) mats.surf.map.offset.set(tw * 0.04, Math.sin(tw * 0.6) * 0.08);
    mats.surf.opacity = 0.35 + 0.25 * Math.sin(tw * 1.3);
    // windows light up after dark
    mats.walls.emissiveIntensity = world.night * 0.9;
    // shop boards are lit at night
    mats.boards.emissiveIntensity = world.night * 0.45;
    mats.glow.opacity = world.night * 0.55;
    mats.glow.visible = world.night > 0.02;
  });

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

  // Google's real-world view draws the land instead (what's solid stays)
  const real = useReal();
  return (
    <group visible={!real}>
      <Ground mat={grass} />
      <FarLand />
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
