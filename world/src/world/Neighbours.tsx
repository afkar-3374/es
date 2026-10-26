import * as THREE from 'three';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { usePBR } from './materials';
import { world } from './state';

/*
 * The rest of the street: two- and three-storey Kerala shop-buildings with closed
 * metal shutters, blank signboards, window sunshades and rooftop water tanks. All
 * boxes are merged by material so the whole street is a few draw calls.
 */

type Kind = 'plaster' | 'shutter' | 'glass' | 'lit' | 'frame' | 'roof' | 'concrete' | 'sign' | 'tank';

const PLASTER = ['#f1e6c8', '#cfe3d1', '#f3d2bd', '#e7e1d6', '#d9e2ef', '#f4ddb0', '#e9cfd6', '#d8d2c2'];
const SHUTTER = ['#6f8fa6', '#7e8c79', '#8a8f96', '#a08b6b', '#5f7d8c'];
const SIGN = ['#2f5d8a', '#b8423c', '#2e7d5b', '#d08a2a', '#6a4a8c', '#3a3a3a'];

// Deterministic randomness so the street looks the same for everyone
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** A box with UVs in metres (so textures don't stretch) and a flat vertex colour. */
function box(w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.ColorRepresentation, tile = 2.5) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // face order: +x, -x, +y, -y, +z, -z (4 vertices each)
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  }
  g.translate(x, y, z);
  const c = new THREE.Color(color);
  const colors = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = c.r;
    colors[i + 1] = c.g;
    colors[i + 2] = c.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/** A gable roof (triangle prism along x) of clay tiles. */
function gableRoof(w: number, d: number, rise: number, x: number, y: number, z: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-d / 2 - 0.5, 0);
  shape.lineTo(d / 2 + 0.5, 0);
  shape.lineTo(0, rise);
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: w + 0.8, bevelEnabled: false });
  g.rotateY(Math.PI / 2);
  g.translate(x - (w + 0.8) / 2, y, z);
  // tile UVs in metres
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2, uv.getY(i) / 2);
  const colors = new Float32Array(g.attributes.position.count * 3).fill(1);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

interface Lot {
  x0: number;
  x1: number;
  depth: number;
  floors: number;
}

function buildLot(lot: Lot, r: () => number, add: (k: Kind, g: THREE.BufferGeometry) => void) {
  const w = lot.x1 - lot.x0;
  const cx = (lot.x0 + lot.x1) / 2;
  const floorH = 3.5;
  const h = lot.floors * floorH;
  const plaster = PLASTER[Math.floor(r() * PLASTER.length)];
  const sloped = lot.floors <= 2 && r() < 0.35;

  // main mass (front face at z = 0, building extends towards -z)
  add('plaster', box(w, h, lot.depth, cx, h / 2, -lot.depth / 2, plaster));
  if (!sloped) {
    add('plaster', box(w + 0.1, 0.9, 0.2, cx, h + 0.45, -0.1, plaster)); // parapet
    add('concrete', box(w + 0.2, 0.08, 0.3, cx, h + 0.94, -0.1, '#bdb8ad'));
  } else {
    add('roof', gableRoof(w, lot.depth, 2.2, cx, h, -lot.depth / 2));
  }

  // ground floor: closed shutters with a blank signboard above
  const bays = Math.max(1, Math.round((w - 1) / 3.2));
  const bayW = (w - 1) / bays;
  for (let b = 0; b < bays; b++) {
    const bx = lot.x0 + 0.5 + bayW * (b + 0.5);
    add('shutter', box(bayW - 0.5, 2.8, 0.06, bx, 1.55, 0.04, SHUTTER[Math.floor(r() * SHUTTER.length)]));
    add('concrete', box(bayW - 0.3, 0.14, 0.12, bx, 3.0, 0.07, '#9d9a92'));
  }
  if (r() < 0.75) add('sign', box(w - 0.6, 0.85, 0.08, cx, 3.55, 0.08, SIGN[Math.floor(r() * SIGN.length)]));
  add('concrete', box(w, 0.12, 1.1, cx, 3.2, 0.55, '#c9c4b8')); // shop-front sunshade

  // upper floors: windows with frames and concrete sunshades (chajja)
  for (let f = 1; f < lot.floors; f++) {
    const y = f * floorH + 1.55;
    const count = Math.max(1, Math.floor(w / 2.8));
    for (let i = 0; i < count; i++) {
      const wx = lot.x0 + (w / count) * (i + 0.5);
      add('frame', box(1.4, 1.5, 0.08, wx, y, 0.03, '#3b3f44'));
      add(r() < 0.45 ? 'lit' : 'glass', box(1.25, 1.35, 0.09, wx, y, 0.04, '#ffffff'));
      add('concrete', box(1.9, 0.08, 0.55, wx, y + 0.95, 0.28, '#cfcac0'));
    }
  }

  // black rooftop water tank
  if (!sloped && r() < 0.6) {
    const tank = new THREE.CylinderGeometry(0.6, 0.6, 1.2, 16);
    tank.translate(lot.x0 + 1.2 + r() * (w - 2.4), h + 0.6, -lot.depth + 1.5 + r() * 2);
    const colors = new Float32Array(tank.attributes.position.count * 3).fill(0.12);
    tank.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    add('tank', tank);
  }
}

function makeLots(seed: number, from: number, to: number, dir: 1 | -1): Lot[] {
  const r = rng(seed);
  const lots: Lot[] = [];
  let x = from;
  while (dir > 0 ? x < to : x > to) {
    const w = 7 + Math.floor(r() * 7);
    const gap = r() < 0.35 ? 1 + r() * 1.5 : 0;
    const x0 = dir > 0 ? x + gap : x - gap - w;
    const x1 = x0 + w;
    lots.push({ x0, x1, depth: 11 + Math.floor(r() * 6), floors: 1 + Math.floor(r() * 3) });
    x = dir > 0 ? x1 : x0;
  }
  return lots;
}

export function Neighbours() {
  const plasterTex = usePBR('painted_plaster_wall', [1, 1], { normalScale: 0.6 });
  const shutterTex = usePBR('painted_metal_shutter', [1, 1]);
  const roofTex = usePBR('clay_roof_tiles', [1, 1]);

  const { meshes, colliders, litMat } = useMemo(() => {
    const groups = new Map<Kind, THREE.BufferGeometry[]>();
    const add = (k: Kind, g: THREE.BufferGeometry) => {
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(g.index ? g.toNonIndexed() : g);
    };
    const r = rng(2026);
    const colliders: { x: number; z: number; w: number; d: number; h: number }[] = [];

    // north side: on both sides of the Electrosparkzz building, fronts at z = 0
    const north = [...makeLots(11, 13.5, 160, 1), ...makeLots(12, -13.5, -160, -1)];
    // south side: fronts at z = 18, facing the road
    const south = [...makeLots(21, -160, 160, 1)];

    for (const lot of north) {
      const parts: [Kind, THREE.BufferGeometry][] = [];
      buildLot(lot, r, (k, g) => parts.push([k, g]));
      parts.forEach(([k, g]) => add(k, g));
      colliders.push({ x: (lot.x0 + lot.x1) / 2, z: -lot.depth / 2, w: lot.x1 - lot.x0, d: lot.depth, h: lot.floors * 3.5 });
    }
    const flip = new THREE.Matrix4().makeRotationY(Math.PI);
    for (const lot of south) {
      const parts: [Kind, THREE.BufferGeometry][] = [];
      // build facing +z, then turn around and move to the south side
      buildLot({ ...lot, x0: -lot.x1, x1: -lot.x0 }, r, (k, g) => parts.push([k, g]));
      parts.forEach(([k, g]) => {
        g.applyMatrix4(flip);
        g.translate(0, 0, 18.2);
        add(k, g);
      });
      colliders.push({ x: (lot.x0 + lot.x1) / 2, z: 18.2 + lot.depth / 2, w: lot.x1 - lot.x0, d: lot.depth, h: lot.floors * 3.5 });
    }

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
    const meshes = [...groups.entries()].map(([k, list]) => ({ key: k, geometry: mergeGeometries(list)!, material: mats[k] }));
    return { meshes, colliders, litMat };
  }, [plasterTex, shutterTex, roofTex]);

  // Some upstairs windows glow at night
  useFrame(() => {
    litMat.emissiveIntensity = world.night * 1.6;
  });

  return (
    <group>
      {meshes.map((m) => (
        <mesh key={m.key} geometry={m.geometry} material={m.material} castShadow receiveShadow />
      ))}
      <RigidBody type="fixed" colliders={false}>
        {colliders.map((c, i) => (
          <CuboidCollider key={i} args={[c.w / 2, c.h / 2, c.d / 2]} position={[c.x, c.h / 2, c.z]} />
        ))}
      </RigidBody>
    </group>
  );
}
