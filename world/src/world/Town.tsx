import * as THREE from 'three';
import { noRaycast } from './merge';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, usePBR } from './materials';
import { world } from './state';
import { box, buildLot, gableRoof, makeLots, PLASTER, type Kind, type Lot } from './Neighbours';
import { PLACES, roadById, rng, type Road } from './layout';
import type { PalmSpot } from './Palms';

/*
 * The rest of the town around the main street: shops along the avenues, Kerala
 * houses with tiled roofs and red laterite compound walls on the quieter roads,
 * coconut groves in between, a football ground and a covered market. Everything is
 * generated from fixed seeds, so every visitor sees exactly the same town.
 */

type Add = (k: Kind, g: THREE.BufferGeometry) => void;
interface Solid {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  y?: number;
}

const FOOTPATH = 2.5;
const LATERITE = ['#a9573b', '#b46446', '#9c4f36'];

/** A Kerala house on its plot: front of the plot at z = 0, the house set back towards −z. */
function buildHouse(lot: Lot, r: () => number, add: Add, solids: Solid[]) {
  const w = lot.x1 - lot.x0;
  const cx = (lot.x0 + lot.x1) / 2;
  const hw = Math.max(w - 2.6, 5.5);
  const hd = Math.min(lot.depth - 4.5, 8.5);
  const back = 3.2;
  const zc = -back - hd / 2;
  const floors = lot.floors > 1 && r() < 0.5 ? 2 : 1;
  const h = floors * 3.1;
  const plaster = PLASTER[Math.floor(r() * PLASTER.length)];

  add('plaster', box(hw, h, hd, cx, h / 2, zc, plaster));
  add('roof', gableRoof(hw, hd, 2 + r() * 0.6, cx, h, zc));
  // front door and windows
  add('shutter', box(1.05, 2.1, 0.06, cx, 1.05, -back + 0.03, '#6b4a2e'));
  for (const s of [-1, 1]) {
    const wx = cx + s * Math.min(hw / 2 - 1.1, 2.3);
    add('frame', box(1.3, 1.3, 0.08, wx, 1.6, -back + 0.03, '#3b3f44'));
    add(r() < 0.35 ? 'lit' : 'glass', box(1.15, 1.15, 0.09, wx, 1.6, -back + 0.04, '#ffffff'));
    if (floors === 2) {
      add('frame', box(1.3, 1.3, 0.08, wx, 4.7, -back + 0.03, '#3b3f44'));
      add(r() < 0.35 ? 'lit' : 'glass', box(1.15, 1.15, 0.09, wx, 4.7, -back + 0.04, '#ffffff'));
    }
  }
  // sit-out (verandah) with a sloping slab and two pillars
  const vw = Math.min(hw * 0.7, 6);
  add('concrete', box(vw, 0.14, 2.1, cx, 2.75, -back + 1.0, '#cfc9bd'));
  add('concrete', box(vw, 0.18, 2.1, cx, 0.09, -back + 1.0, '#a29d93'));
  for (const s of [-1, 1]) add('plaster', box(0.26, 2.66, 0.26, cx + s * (vw / 2 - 0.25), 1.41, -back + 1.9, plaster));
  solids.push({ x: cx, z: zc, w: hw, d: hd, h });

  // red laterite compound wall with a gate opening
  const wall = LATERITE[Math.floor(r() * LATERITE.length)];
  const gate = 3;
  const side = (w - gate) / 2;
  for (const s of [-1, 1]) {
    const x = cx + s * (gate / 2 + side / 2);
    add('plaster', box(side, 1.1, 0.24, x, 0.55, -0.12, wall));
    solids.push({ x, z: -0.12, w: side, d: 0.24, h: 1.1 });
    const sx = cx + s * (w / 2 - 0.12);
    add('plaster', box(0.24, 1.1, lot.depth, sx, 0.55, -lot.depth / 2, wall));
    solids.push({ x: sx, z: -lot.depth / 2, w: 0.24, d: lot.depth, h: 1.1 });
  }
  add('concrete', box(w, 0.06, 0.3, cx, 1.13, -0.12, '#cfc9bd'));
}

function makePlots(seed: number, from: number, to: number, depth: number): Lot[] {
  const r = rng(seed);
  const plots: Lot[] = [];
  let x = from;
  while (true) {
    const w = 11 + Math.floor(r() * 6);
    const x0 = x + (r() < 0.4 ? 1 + r() * 3 : 0.4);
    if (x0 + w > to) break;
    plots.push({ x0, x1: x0 + w, depth, floors: 1 + Math.floor(r() * 2) });
    x = x0 + w;
  }
  return plots;
}

/** Facing the road from one side: which way the fronts look and where they stand. */
function frontage(road: Road, side: -1 | 1) {
  // side −1 = the north/west side of the road, +1 = south/east
  const front = road.c + side * (road.w / 2 + FOOTPATH);
  const theta = road.axis === 'x' ? (side === -1 ? 0 : Math.PI) : side === -1 ? Math.PI / 2 : -Math.PI / 2;
  const m = new THREE.Matrix4().makeRotationY(theta);
  // where "along the road" goes in the lot's own x (which way local +x points in the world)
  const flip = road.axis === 'x' ? (side === -1 ? 1 : -1) : side === -1 ? -1 : 1;
  return { front, m, flip };
}

/**
 * Put a row of buildings along one side of a road between `a` and `b` (along the road).
 * `kind` picks shops or houses.
 */
function row(road: Road, side: -1 | 1, a: number, b: number, kind: 'shops' | 'houses', seed: number, maxDepth: number, add: Add, solids: Solid[]) {
  const r = rng(seed * 7 + 3);
  const { front, m, flip } = frontage(road, side);
  const len = b - a;
  const lots = kind === 'shops' ? makeLots(seed, 0, len, 1, [], maxDepth) : makePlots(seed, 0, len, maxDepth);
  for (const lot of lots) {
    // build centred on x = 0 at the origin, then turn and move into place
    const mid = (lot.x0 + lot.x1) / 2;
    const local: Lot = { ...lot, x0: lot.x0 - mid, x1: lot.x1 - mid };
    const parts: [Kind, THREE.BufferGeometry][] = [];
    const own: Solid[] = [];
    if (kind === 'shops') {
      buildLot(local, r, (k, g) => parts.push([k, g]));
      own.push({ x: 0, z: -lot.depth / 2, w: local.x1 - local.x0, d: lot.depth, h: lot.floors * 3.5 });
    } else buildHouse(local, r, (k, g) => parts.push([k, g]), own);
    const along = a + mid;
    const at = (lx: number) => along + flip * lx;
    const pos = road.axis === 'x' ? new THREE.Vector3(at(0), 0, front) : new THREE.Vector3(front, 0, at(0));
    const t = new THREE.Matrix4().makeTranslation(pos.x, 0, pos.z).multiply(m);
    for (const [k, g] of parts) {
      g.applyMatrix4(t);
      add(k, g);
    }
    for (const s of own) {
      const c = new THREE.Vector3(s.x, 0, s.z).applyMatrix4(t);
      const turned = road.axis === 'z';
      solids.push({ x: c.x, z: c.z, w: turned ? s.d : s.w, d: turned ? s.w : s.d, h: s.h });
    }
  }
}

/** A grid of palms with a little jitter over a rectangle (skipping where `free` says no). */
function grove(seed: number, x0: number, x1: number, z0: number, z1: number, spacing: number, out: PalmSpot[]) {
  const r = rng(seed);
  for (let x = x0 + spacing / 2; x < x1; x += spacing)
    for (let z = z0 + spacing / 2; z < z1; z += spacing) {
      if (r() < 0.25) continue;
      out.push({ x: x + (r() - 0.5) * spacing * 0.6, z: z + (r() - 0.5) * spacing * 0.6, scale: 0.8 + r() * 0.45, turn: r() * Math.PI * 2 });
    }
}

/** The whole town, worked out once. */
export function planTown() {
  const groups = new Map<Kind, THREE.BufferGeometry[]>();
  const add: Add = (k, g) => {
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(g.index ? g.toNonIndexed() : g);
  };
  const solids: Solid[] = [];
  const palms: PalmSpot[] = [];
  const north = roadById('north');
  const south = roadById('south');
  const west = roadById('west');
  const east = roadById('east');
  const ring = roadById('ring');
  const coast = roadById('coast');

  // Temple Road: shops facing the town, houses up the hill behind
  row(north, 1, -196, -110, 'shops', 31, 13, add, solids);
  row(north, 1, -18, 18, 'shops', 32, 13, add, solids);
  row(north, 1, 110, 196, 'shops', 33, 13, add, solids);
  row(north, -1, -196, -110, 'houses', 34, 15, add, solids);
  row(north, -1, -90, 90, 'houses', 35, 15, add, solids);
  row(north, -1, 110, 196, 'houses', 36, 15, add, solids);
  // School Road: houses on both sides
  for (const [i, [a, b]] of ([[-196, -110], [-90, 90], [110, 196]] as [number, number][]).entries()) {
    row(south, -1, a, b, 'houses', 40 + i, 14, add, solids);
    row(south, 1, a, b, 'houses', 50 + i, 15, add, solids);
  }
  // the avenues: shops on both sides between the main street and the side roads
  for (const [i, av] of [west, east].entries()) {
    for (const [j, [a, b]] of ([[-72, -24], [42, 92]] as [number, number][]).entries()) {
      row(av, -1, a, b, 'shops', 60 + i * 10 + j, 13, add, solids);
      row(av, 1, a, b, 'shops', 64 + i * 10 + j, 13, add, solids);
    }
  }
  // Hill Road on the east edge, and Beach Road facing the sea
  for (const [j, [a, b]] of ([[-72, -24], [42, 92]] as [number, number][]).entries()) {
    row(ring, -1, a, b, 'houses', 80 + j, 14, add, solids);
    row(ring, 1, a, b, 'houses', 82 + j, 11, add, solids);
  }
  for (const [j, [a, b]] of ([[-195, -108], [-82, -24], [42, 104], [126, 222]] as [number, number][]).entries())
    row(coast, 1, a, b, j % 2 ? 'shops' : 'houses', 90 + j, 13, add, solids);

  // coconut groves fill the blocks
  const blocks: [number, number, number, number][] = [
    [-183, -122, -72, -26],
    [-20, 20, -72, -28],
    [122, 182, -72, -26],
    [-183, -122, 40, 92],
    [-78, 78, 40, 92],
    [122, 182, 40, 92],
    [-183, 196, -205, -118],
    [-183, 196, 138, 228],
    [-78, -22, -84, -75],
  ];
  blocks.forEach(([x0, x1, z0, z1], i) => grove(500 + i, x0, x1, z0, z1, i >= 6 ? 15 : 11, palms));

  // rough grass under the groves (UVs in metres)
  const lawns = mergeGeometries(
    blocks.map(([x0, x1, z0, z1]) => {
      const g = new THREE.PlaneGeometry(x1 - x0 + 4, z1 - z0 + 4);
      g.rotateX(-Math.PI / 2);
      g.translate((x0 + x1) / 2, 0.004, (z0 + z1) / 2);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0 + 4)) / 5, (uv.getY(i) * (z1 - z0 + 4)) / 5);
      return g;
    })
  )!;

  return { groups, solids, palms, lawns };
}

export const TOWN = planTown();

export function Town() {
  const plasterTex = usePBR('painted_plaster_wall', [1, 1], { normalScale: 0.6 });
  const shutterTex = usePBR('painted_metal_shutter', [1, 1]);
  const roofTex = usePBR('clay_roof_tiles', [1, 1]);
  const grass = usePBR('sparse_grass', [1, 1]);

  const { meshes, litMat } = useMemo(() => {
    const litMat = new THREE.MeshStandardMaterial({ color: '#2a2f36', emissive: '#ffcf8a', emissiveIntensity: 0, roughness: 0.2, metalness: 0.1 });
    const mats: Record<Kind, THREE.Material> = {
      plaster: Object.assign(plasterTex.clone(), { vertexColors: true }),
      shutter: Object.assign(shutterTex.clone(), { vertexColors: true }),
      roof: roofTex,
      glass: new THREE.MeshStandardMaterial({ color: '#29323a', roughness: 0.08, metalness: 0.3, envMapIntensity: 1.6 }),
      lit: litMat,
      frame: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }),
      concrete: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
      sign: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
      tank: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 }),
    };
    const meshes = [...TOWN.groups.entries()].map(([k, list]) => ({ key: k, geometry: mergeGeometries(list)!, material: mats[k] }));
    return { meshes, litMat };
  }, [plasterTex, shutterTex, roofTex]);

  // the grass texture's own colour is a dry brown: keep its bumps, paint it green
  const lawn = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7fae58', normalMap: grass.normalMap, roughnessMap: grass.roughnessMap, roughness: 1 }), [grass]);
  useFrame(() => {
    litMat.emissiveIntensity = world.night * 1.6;
  });

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} geometry={m.geometry} material={m.material} castShadow receiveShadow raycast={noRaycast} />
      ))}
      <RigidBody type="fixed" colliders={false}>
        {TOWN.solids.map((c, i) => (
          <CuboidCollider key={i} args={[c.w / 2, c.h / 2, c.d / 2]} position={[c.x, c.h / 2, c.z]} />
        ))}
      </RigidBody>
      <mesh geometry={TOWN.lawns} material={lawn} receiveShadow raycast={noRaycast} />
      <FootballGround grass={grass} />
      <Market />
    </group>
  );
}

/* ── The football ground ─────────────────────────────────────── */

function FootballGround({ grass }: { grass: THREE.MeshStandardMaterial }) {
  const g = PLACES.ground;
  const w = g.x1 - g.x0;
  const d = g.z1 - g.z0;
  const cx = (g.x0 + g.x1) / 2;
  const cz = (g.z0 + g.z1) / 2;
  // a well-kept pitch: mowing stripes, with the grass texture's bumps for detail
  const turf = useMemo(() => {
    const stripes = canvasTexture(256, 16, (g) => {
      for (let i = 0; i < 8; i++) {
        g.fillStyle = i % 2 ? '#6fa64a' : '#7cb555';
        g.fillRect(i * 32, 0, 32, 16);
      }
    });
    const normal = grass.normalMap!.clone();
    normal.repeat.set(w / 3, d / 3);
    normal.needsUpdate = true;
    return new THREE.MeshStandardMaterial({ map: stripes, normalMap: normal, roughness: 0.95 });
  }, [grass, w, d]);
  const chalk = useMemo(() => new THREE.MeshBasicMaterial({ color: '#f4f4ee' }), []);
  const post = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f7f7f2', roughness: 0.4 }), []);
  const lines = useMemo(() => {
    const pw = w - 8;
    const pd = d - 8;
    return [
      [0, -pd / 2, pw, 0.12],
      [0, pd / 2, pw, 0.12],
      [-pw / 2, 0, 0.12, pd],
      [pw / 2, 0, 0.12, pd],
      [0, 0, 0.12, pd],
    ] as [number, number, number, number][];
  }, [w, d]);
  const goalX = (w - 8) / 2;
  return (
    <group position={[cx, 0, cz]}>
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.006, 0]} receiveShadow material={turf}>
        <planeGeometry args={[w, d]} />
      </mesh>
      {lines.map(([x, z, lw, ld], i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[x, 0.012, z]} material={chalk}>
          <planeGeometry args={[lw, ld]} />
        </mesh>
      ))}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.012, 0]} material={chalk}>
        <ringGeometry args={[5.4, 5.55, 48]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * goalX, 0, 0]}>
          {[-1.8, 1.8].map((z) => (
            <mesh key={z} position={[0, 1.1, z]} castShadow material={post}>
              <cylinderGeometry args={[0.06, 0.06, 2.2, 8]} />
            </mesh>
          ))}
          <mesh position={[0, 2.2, 0]} rotation-x={Math.PI / 2} castShadow material={post}>
            <cylinderGeometry args={[0.06, 0.06, 3.7, 8]} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {[-1, 1].flatMap((s) => [-1.8, 1.8].map((z) => <CuboidCollider key={`${s}${z}`} args={[0.07, 1.1, 0.07]} position={[s * goalX, 1.1, z]} />))}
      </RigidBody>
    </group>
  );
}

/* ── The covered market ──────────────────────────────────────── */

function Market() {
  const m = PLACES.market;
  const cx = (m.x0 + m.x1) / 2;
  const cz = (m.z0 + m.z1) / 2;
  const w = m.x1 - m.x0 - 10;
  const d = m.z1 - m.z0 - 12;
  const { geometries, solids } = useMemo(() => {
    const r = rng(77);
    const parts: { roof: THREE.BufferGeometry[]; post: THREE.BufferGeometry[]; stall: THREE.BufferGeometry[]; goods: THREE.BufferGeometry[] } = { roof: [], post: [], stall: [], goods: [] };
    const solids: Solid[] = [];
    const nx = 6;
    const nz = 4;
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++) {
        const x = -w / 2 + (w / (nx - 1)) * i;
        const z = -d / 2 + (d / (nz - 1)) * j;
        parts.post.push(box(0.3, 5.2, 0.3, x, 2.6, z, '#8d939a'));
        solids.push({ x: cx + x, z: cz + z, w: 0.3, d: 0.3, h: 5.2 });
      }
    // a pitched sheet roof
    for (const s of [-1, 1]) {
      const g = box(w + 3, 0.06, d / 2 + 1.5, 0, 0, 0, '#7f98a3');
      g.rotateX(s * 0.18);
      g.translate(0, 5.6, s * (d / 4 + 0.6));
      parts.roof.push(g);
    }
    // two rows of stalls heaped with fruit and vegetables
    const produce = ['#e74c3c', '#f39c12', '#f1c40f', '#27ae60', '#8e44ad', '#d35400', '#2ecc71', '#c0392b'];
    for (const row of [-d / 4, d / 4])
      for (let x = -w / 2 + 3; x < w / 2 - 2; x += 4.2) {
        parts.stall.push(box(3.2, 0.9, 1.6, x, 0.45, row, '#8a6a48'));
        solids.push({ x: cx + x, z: cz + row, w: 3.2, d: 1.6, h: 0.9 });
        for (let k = 0; k < 4; k++) {
          const c = produce[Math.floor(r() * produce.length)];
          parts.goods.push(box(0.65, 0.22 + r() * 0.15, 0.6, x - 1.1 + k * 0.73, 1.0, row + (r() - 0.5) * 0.5, c));
        }
      }
    const geometries = Object.fromEntries(Object.entries(parts).map(([k, list]) => [k, mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!])) as Record<keyof typeof parts, THREE.BufferGeometry>;
    return { geometries, solids };
  }, [cx, cz, w, d]);
  const mats = useMemo(
    () => ({
      roof: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.6, side: THREE.DoubleSide }),
      post: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.5 }),
      stall: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 }),
      goods: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }),
    }),
    []
  );
  return (
    <group>
      <group position={[cx, 0, cz]}>
        {(Object.keys(geometries) as (keyof typeof geometries)[]).map((k) => (
          <mesh key={k} geometry={geometries[k]} material={mats[k]} castShadow receiveShadow />
        ))}
      </group>
      <RigidBody type="fixed" colliders={false}>
        {solids.map((c, i) => (
          <CuboidCollider key={i} args={[c.w / 2, c.h / 2, c.d / 2]} position={[c.x, c.h / 2, c.z]} />
        ))}
      </RigidBody>
    </group>
  );
}
