import * as THREE from 'three';
import { noRaycast } from './merge';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from './materials';
import { world } from './state';

const TRUNK_HEIGHT = 9;

/** A gently curved, tapering coconut trunk with growth rings. */
function trunkGeometry() {
  const g = new THREE.CylinderGeometry(0.15, 0.24, TRUNK_HEIGHT, 7, 7, true);
  g.translate(0, TRUNK_HEIGHT / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / TRUNK_HEIGHT;
    p.setX(i, p.getX(i) + Math.pow(t, 1.8) * 1.2); // lean
  }
  g.computeVertexNormals();
  return g;
}

/** One frond: a long leaf strip that arches out and droops, with a leaflet texture. */
function frondGeometry(length: number, droop: number) {
  const g = new THREE.PlaneGeometry(1.4, length, 1, 6);
  g.translate(0, length / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const t = y / length;
    // arch up first, then droop; leaflets fold slightly into a V
    p.setZ(i, Math.sin(t * Math.PI * 0.55) * length * 0.35 - t * t * droop + Math.abs(p.getX(i)) * 0.25);
    p.setX(i, p.getX(i) * (1 - t * 0.55));
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function crownGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  const fronds = 13;
  for (let i = 0; i < fronds; i++) {
    const f = frondGeometry(3.6 + Math.random() * 1.2, 1.2 + Math.random() * 1.6);
    f.rotateX(-0.25 - Math.random() * 0.5);
    f.rotateY((i / fronds) * Math.PI * 2 + Math.random() * 0.3);
    parts.push(f);
  }
  const merged = mergeGeometries(parts)!;
  return merged;
}

function coconutsGeometry() {
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.IcosahedronGeometry(0.17, 0);
    const a = (i / 5) * Math.PI * 2;
    s.translate(Math.cos(a) * 0.22, -0.25 - Math.random() * 0.15, Math.sin(a) * 0.22);
    parts.push(s);
  }
  return mergeGeometries(parts)!;
}

const leafTexture = () =>
  canvasTexture(64, 256, (g) => {
    g.clearRect(0, 0, 64, 256);
    // midrib
    g.fillStyle = '#c8b46a';
    g.fillRect(30, 0, 4, 256);
    // leaflets angled from the midrib
    for (let y = 4; y < 256; y += 5) {
      const shade = 70 + Math.random() * 40;
      g.strokeStyle = `rgb(${shade * 0.55},${shade + 30},${shade * 0.35})`;
      g.lineWidth = 2.2;
      g.beginPath();
      g.moveTo(32, y);
      g.lineTo(2, y - 14);
      g.moveTo(32, y);
      g.lineTo(62, y - 14);
      g.stroke();
    }
  });

const barkTexture = () =>
  canvasTexture(64, 256, (g) => {
    g.fillStyle = '#7b6f62';
    g.fillRect(0, 0, 64, 256);
    for (let y = 0; y < 256; y += 6) {
      g.fillStyle = `rgba(60,50,42,${0.35 + Math.random() * 0.3})`;
      g.fillRect(0, y, 64, 2);
    }
    for (let i = 0; i < 300; i++) {
      g.fillStyle = `rgba(${150 + Math.random() * 40},${140 + Math.random() * 30},120,0.15)`;
      g.fillRect(Math.random() * 64, Math.random() * 256, 2, 2);
    }
  }, [1, 6]);

export interface PalmSpot {
  x: number;
  z: number;
  /** ground height (0 if left out) */
  y?: number;
  scale?: number;
  turn?: number;
}

/** Palms are grouped into square tiles so tiles behind you or far away aren't drawn at all. */
const TILE = 64;
const DRAW = 280; // metres: past this the fog has them
const SWAY = 90; // only nearby crowns move in the wind
const SHADOW = 70; // and only nearby palms cast shadows

type Item = PalmSpot & { scale: number; turn: number; top: THREE.Vector3; phase: number };

/** Coconut palms, drawn as instances in tiles: three draw calls per tile in view. */
export function Palms({ spots }: { spots: PalmSpot[] }) {
  const parts = useMemo(
    () => ({
      trunk: trunkGeometry(),
      crown: crownGeometry(),
      nuts: coconutsGeometry(),
      trunkMat: new THREE.MeshStandardMaterial({ map: barkTexture(), roughness: 0.95 }),
      crownMat: new THREE.MeshStandardMaterial({ map: leafTexture(), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75, color: '#d8f0b8' }),
      nutMat: new THREE.MeshStandardMaterial({ color: '#6d7a2c', roughness: 0.7, flatShading: true }),
    }),
    []
  );
  const tiles = useMemo(() => {
    const map = new Map<string, Item[]>();
    for (const s of spots) {
      const scale = s.scale ?? 0.85 + Math.random() * 0.35;
      const turn = s.turn ?? Math.random() * Math.PI * 2;
      // where the crown sits on top of the leaning trunk
      const top = new THREE.Vector3(1.2, TRUNK_HEIGHT, 0).multiplyScalar(scale).applyAxisAngle(new THREE.Vector3(0, 1, 0), turn);
      const key = `${Math.floor(s.x / TILE)},${Math.floor(s.z / TILE)}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ ...s, scale, turn, top, phase: Math.random() * 10 });
    }
    return [...map.values()];
  }, [spots]);
  return (
    <group>
      {tiles.map((items, i) => (
        <PalmTile key={i} items={items} {...parts} />
      ))}
    </group>
  );
}

function PalmTile({ items, trunk, crown, nuts, trunkMat, crownMat, nutMat }: { items: Item[]; trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry; nuts: THREE.BufferGeometry; trunkMat: THREE.Material; crownMat: THREE.Material; nutMat: THREE.Material }) {
  const trunks = useRef<THREE.InstancedMesh>(null);
  const crowns = useRef<THREE.InstancedMesh>(null);
  const coconuts = useRef<THREE.InstancedMesh>(null);
  const group = useRef<THREE.Group>(null);
  const centre = useMemo(() => {
    const c = new THREE.Vector3();
    items.forEach((it) => c.add(new THREE.Vector3(it.x, 0, it.z)));
    return c.divideScalar(items.length);
  }, [items]);
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const e = useMemo(() => new THREE.Euler(), []);
  const v = useMemo(() => new THREE.Vector3(), []);
  const s = useMemo(() => new THREE.Vector3(), []);
  const state = useRef({ placed: false, shadow: true });

  const place = (t: number, strength: number) => {
    items.forEach((it, i) => {
      if (!state.current.placed) {
        e.set(0, it.turn, 0);
        q.setFromEuler(e);
        s.setScalar(it.scale);
        v.set(it.x, it.y ?? 0, it.z);
        m.compose(v, q, s);
        trunks.current?.setMatrixAt(i, m);
      }
      // crown sways in the wind
      const sway = Math.sin(t * 1.3 + it.phase) * strength;
      e.set(sway, it.turn + Math.sin(t * 0.7 + it.phase) * strength * 0.6, sway * 0.6);
      q.setFromEuler(e);
      s.setScalar(it.scale);
      v.set(it.x + it.top.x, (it.y ?? 0) + it.top.y, it.z + it.top.z);
      m.compose(v, q, s);
      crowns.current?.setMatrixAt(i, m);
      coconuts.current?.setMatrixAt(i, m);
    });
    for (const r of [trunks, crowns, coconuts]) {
      if (!r.current) continue;
      r.current.instanceMatrix.needsUpdate = true;
      if (!state.current.placed) r.current.computeBoundingSphere();
    }
    state.current.placed = true;
  };

  useFrame(({ clock }) => {
    const g = group.current;
    if (!g || !trunks.current) return;
    const p = world.player;
    const d = Math.hypot(centre.x - p.x, centre.z - p.z) - TILE * 0.7;
    g.visible = d < DRAW;
    if (!state.current.placed) place(0, 0);
    if (!g.visible) return;
    if (d < SWAY) place(clock.elapsedTime, 0.02 + Math.min(world.wind, 60) * 0.0025);
    const shadow = d < SHADOW;
    if (shadow !== state.current.shadow) {
      state.current.shadow = shadow;
      for (const r of [trunks, crowns, coconuts]) if (r.current) r.current.castShadow = shadow;
    }
  });

  return (
    <group ref={group}>
      <instancedMesh ref={trunks} args={[trunk, trunkMat, items.length]} castShadow receiveShadow raycast={noRaycast} />
      <instancedMesh ref={crowns} args={[crown, crownMat, items.length]} castShadow raycast={noRaycast} />
      <instancedMesh ref={coconuts} args={[nuts, nutMat, items.length]} castShadow raycast={noRaycast} />
    </group>
  );
}
