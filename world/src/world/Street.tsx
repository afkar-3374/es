import * as THREE from 'three';
import { Lamp, VirtualLight } from './Lamps';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { applyWetness, canvasTexture, usePBR } from './materials';
import { world } from './state';
import { mergeStatic } from './merge';

/*
 * Street layout (metres). The street runs east–west along X.
 *   z  0 … 5    forecourt in front of the Electrosparkzz building (north side)
 *   z  5 … 15   two-lane road, centre line at z = 10
 *   z 15 … 18   footpath on the south side, buildings beyond
 */
export const ROAD = { north: 5, south: 15, centre: 10, length: 120 };
export const FOOTPATH_H = 0.16;

/** The modelled stretch; the real road (MapTiles) carries on from both ends. */
export const SEGMENTS: [number, number][] = [[-ROAD.length / 2, ROAD.length / 2]];

export function Street() {
  const asphalt = usePBR('asphalt_02', [ROAD.length / 6, 10 / 6]);
  const paving = usePBR('hexagonal_concrete_paving', [1 / 2.5, 5 / 2.5]);
  const paving2 = usePBR('hexagonal_concrete_paving', [1 / 2.5, 3 / 2.5]);
  const kerbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.85,
        map: canvasTexture(64, 8, (g) => {
          g.fillStyle = '#1b1b1b';
          g.fillRect(0, 0, 32, 8);
          g.fillStyle = '#e9e6dc';
          g.fillRect(32, 0, 32, 8);
        }, [1 / 1.6, 1]),
      }),
    []
  );
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 0.6 }), []);

  // Wet roads and paving in the rain
  const wetting = useMemo(() => [asphalt, paving, paving2], [asphalt, paving, paving2]);
  useFrame(() => applyWetness(wetting, world.wet));

  // Road paint: dashed centre line, edge lines and a zebra crossing in front of the building
  const markings = useMemo(() => {
    const parts: { x: number; z: number; w: number; d: number }[] = [];
    for (let x = -ROAD.length / 2 + 6; x < ROAD.length / 2 - 8; x += 6) {
      if (Math.abs(x) < 6) continue; // no centre line across the crossing
      if (!SEGMENTS.some(([a, b]) => x > a && x + 3 < b)) continue; // nor across junctions
      parts.push({ x: x + 1.5, z: ROAD.centre, w: 3, d: 0.12 });
    }
    for (const [a, b] of SEGMENTS) {
      parts.push({ x: (a + b) / 2, z: ROAD.north + 0.35, w: b - a, d: 0.12 });
      parts.push({ x: (a + b) / 2, z: ROAD.south - 0.35, w: b - a, d: 0.12 });
    }
    for (let z = ROAD.north + 0.8; z < ROAD.south - 0.6; z += 1.0) parts.push({ x: 0, z: z + 0.25, w: 4, d: 0.5 });
    return parts;
  }, []);

  return (
    <group>
      {/* Road */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, ROAD.centre]} receiveShadow material={asphalt}>
        <planeGeometry args={[ROAD.length, ROAD.south - ROAD.north]} />
      </mesh>
      {markings.map((m, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[m.x, 0.012, m.z]} material={paint} receiveShadow>
          <planeGeometry args={[m.w, m.d]} />
        </mesh>
      ))}

      {/* Footpaths with Kerala-style black-and-white kerbs, broken where side roads join */}
      {SEGMENTS.map(([x0, x1]) => (
        <Footpaths key={x0} x0={x0} x1={x1} paving={paving} paving2={paving2} kerb={kerbMat} />
      ))}

      <Poles />
      <StreetLights />

      <RigidBody type="fixed" colliders={false}>
        {SEGMENTS.map(([x0, x1]) => (
          <group key={x0}>
            <CuboidCollider args={[(x1 - x0) / 2, FOOTPATH_H / 2, 2.5]} position={[(x0 + x1) / 2, FOOTPATH_H / 2, 2.5]} />
            <CuboidCollider args={[(x1 - x0) / 2, FOOTPATH_H / 2, 1.5]} position={[(x0 + x1) / 2, FOOTPATH_H / 2, 16.5]} />
          </group>
        ))}
      </RigidBody>
    </group>
  );
}

/** One stretch of both footpaths (materials are cloned so each stretch tiles at its own length). */
function Footpaths({ x0, x1, paving, paving2, kerb }: { x0: number; x1: number; paving: THREE.MeshStandardMaterial; paving2: THREE.MeshStandardMaterial; kerb: THREE.MeshStandardMaterial }) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  const mats = useMemo(() => {
    const tiled = (m: THREE.MeshStandardMaterial) => {
      const c = m.clone();
      for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
        const t = m[key];
        if (!t) continue;
        c[key] = t.clone();
        c[key]!.repeat.set(t.repeat.x * w, t.repeat.y);
        c[key]!.needsUpdate = true;
      }
      return c;
    };
    return { a: tiled(paving), b: tiled(paving2), k: tiled(kerb) };
  }, [paving, paving2, kerb, w]);
  // wet with the rest
  useFrame(() => {
    mats.a.roughness = paving.roughness;
    mats.a.color.copy(paving.color);
    mats.b.roughness = paving2.roughness;
    mats.b.color.copy(paving2.color);
  });
  return (
    <group>
      <mesh position={[cx, FOOTPATH_H / 2, 2.5]} receiveShadow material={mats.a}>
        <boxGeometry args={[w, FOOTPATH_H, 5]} />
      </mesh>
      <mesh position={[cx, FOOTPATH_H / 2, 16.5]} receiveShadow material={mats.b}>
        <boxGeometry args={[w, FOOTPATH_H, 3]} />
      </mesh>
      {[ROAD.north - 0.12, ROAD.south + 0.12].map((z) => (
        <mesh key={z} position={[cx, 0.11, z]} castShadow receiveShadow material={mats.k}>
          <boxGeometry args={[w, 0.22, 0.24]} />
        </mesh>
      ))}
    </group>
  );
}

/** Concrete electric poles along the south footpath, with sagging wires. */
function Poles() {
  const xs = useMemo(() => Array.from({ length: 5 }, (_, i) => -56 + i * 28), []);
  const concrete = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a7a39a', roughness: 0.9 }), []);
  const wires = useMemo(() => {
    const pts: THREE.Vector3[] = [];
    for (const h of [8.6, 8.2, 7.8]) {
      for (let i = 0; i < xs.length - 1; i++) {
        const a = xs[i];
        const b = xs[i + 1];
        const steps = 12;
        for (let k = 0; k < steps; k++) {
          const t0 = k / steps;
          const t1 = (k + 1) / steps;
          const sag = (t: number) => h - Math.sin(t * Math.PI) * 0.9;
          pts.push(new THREE.Vector3(a + (b - a) * t0, sag(t0), 17.6), new THREE.Vector3(a + (b - a) * t1, sag(t1), 17.6));
        }
      }
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }, [xs]);
  const merged = useRef<THREE.Group>(null);
  useLayoutEffect(() => (merged.current ? mergeStatic(merged.current) : undefined), []);
  return (
    <group>
      <group ref={merged}>
        {xs.map((x) => (
          <group key={x} position={[x, 0, 17.6]}>
            <mesh position={[0, 4.5, 0]} castShadow material={concrete}>
              <boxGeometry args={[0.22, 9, 0.18]} />
            </mesh>
            <mesh position={[0, 8.4, 0]} castShadow material={concrete}>
              <boxGeometry args={[1.4, 0.1, 0.12]} />
            </mesh>
          </group>
        ))}
      </group>
      <lineSegments geometry={wires}>
        <lineBasicMaterial color="#222" />
      </lineSegments>
      <RigidBody type="fixed" colliders={false}>
        {xs.map((x) => (
          <CuboidCollider key={x} args={[0.12, 4.5, 0.1]} position={[x, 4.5, 17.6]} />
        ))}
      </RigidBody>
    </group>
  );
}

/** LED street lights on the north footpath; they switch on at dusk. */
function StreetLights() {
  const xs = useMemo(() => [-54, -36, -18, 18, 36, 54], []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.45, metalness: 0.7 }), []);
  const lampMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9dde0', emissive: '#ffe7c2', emissiveIntensity: 0, roughness: 0.3 }), []);
  const lights = useRef<(VirtualLight | null)[]>([]);
  useFrame(() => {
    const on = world.night;
    lampMat.emissiveIntensity = on * 4;
    lights.current.forEach((l) => l && (l.intensity = on * 38));
  });
  const merged = useRef<THREE.Group>(null);
  useLayoutEffect(() => (merged.current ? mergeStatic(merged.current) : undefined), []);
  return (
    <group ref={merged}>
      {xs.map((x, i) => (
        <group key={x} position={[x, 0, 4.5]}>
          <mesh position={[0, 4, 0]} castShadow material={metal}>
            <cylinderGeometry args={[0.07, 0.1, 8, 10]} />
          </mesh>
          <mesh position={[0, 7.9, 0.8]} rotation-x={Math.PI / 2} castShadow material={metal}>
            <cylinderGeometry args={[0.045, 0.045, 1.6, 8]} />
          </mesh>
          <mesh position={[0, 7.85, 1.6]} material={lampMat}>
            <boxGeometry args={[0.35, 0.08, 0.7]} />
          </mesh>
          {/* every lamp can light the street; the nearest ones borrow the shared lights */}
          {<Lamp ref={(l) => (lights.current[i] = l)} position={[0, 7.4, 1.6]} color="#ffd9a6" distance={24} decay={1.5} intensity={0} />}
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {xs.map((x) => (
          <CuboidCollider key={x} args={[0.1, 4, 0.1]} position={[x, 4, 4.5]} />
        ))}
      </RigidBody>
    </group>
  );
}
