import * as THREE from 'three';
import { Lamp, VirtualLight } from './Lamps';
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { applyWetness, canvasTexture, usePBR } from './materials';
import { world } from './state';
import { mergeStatic } from './merge';
import { inGap, useMeta, type Gap } from './map';

/*
 * Street layout (metres). The street runs east–west along X.
 *   z  0 … 5    forecourt in front of the Electrosparkzz building (north side)
 *   z  5 … 15   two-lane road, centre line at z = 10
 *   z 15 … 18   footpath on the south side, buildings beyond
 */
export const ROAD = { north: 5, south: 15, centre: 10, length: 120 };
export const FOOTPATH_H = 0.16;

/**
 * The stretches of footpath on one side of the modelled street (the real road carries on
 * from both ends), broken where real side roads join it.
 */
export function segments(gaps: Gap[] | undefined, side: Gap['side']): [number, number][] {
  const out: [number, number][] = [];
  let x = -ROAD.length / 2;
  for (const g of (gaps ?? []).filter((g) => g.side === side).sort((a, b) => a.x - b.x)) {
    const a = g.x - g.w / 2 - 1.5;
    const b = g.x + g.w / 2 + 1.5;
    if (a > x) out.push([x, a]);
    x = Math.max(x, b);
  }
  if (x < ROAD.length / 2) out.push([x, ROAD.length / 2]);
  return out.filter(([a, b]) => b - a > 1);
}

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

  const gaps = useMeta()?.gaps;
  const north = useMemo(() => segments(gaps, 'n'), [gaps]);
  const south = useMemo(() => segments(gaps, 's'), [gaps]);

  // Road paint: dashed centre line, edge lines and a zebra crossing in front of the building
  const markings = useMemo(() => {
    const parts: { x: number; z: number; w: number; d: number }[] = [];
    for (let x = -ROAD.length / 2 + 6; x < ROAD.length / 2 - 8; x += 6) {
      if (Math.abs(x) < 6) continue; // no centre line across the crossing
      parts.push({ x: x + 1.5, z: ROAD.centre, w: 3, d: 0.12 });
    }
    // edge lines, broken where side roads join
    for (const [a, b] of north) parts.push({ x: (a + b) / 2, z: ROAD.north + 0.35, w: b - a, d: 0.12 });
    for (const [a, b] of south) parts.push({ x: (a + b) / 2, z: ROAD.south - 0.35, w: b - a, d: 0.12 });
    for (let z = ROAD.north + 0.8; z < ROAD.south - 0.6; z += 1.0) parts.push({ x: 0, z: z + 0.25, w: 4, d: 0.5 });
    return parts;
  }, [north, south]);

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
      {north.map(([x0, x1]) => (
        <Footpath key={`n${x0}`} side="n" x0={x0} x1={x1} paving={paving} kerb={kerbMat} />
      ))}
      {south.map(([x0, x1]) => (
        <Footpath key={`s${x0}`} side="s" x0={x0} x1={x1} paving={paving2} kerb={kerbMat} />
      ))}

      <Poles gaps={gaps} />
      <StreetLights gaps={gaps} />

      {/* (keyed on the gaps: the colliders are made once, when they mount) */}
      <RigidBody key={JSON.stringify(gaps ?? [])} type="fixed" colliders={false}>
        {north.map(([x0, x1]) => (
          <CuboidCollider key={`n${x0}`} args={[(x1 - x0) / 2, FOOTPATH_H / 2, 2.5]} position={[(x0 + x1) / 2, FOOTPATH_H / 2, 2.5]} />
        ))}
        {south.map(([x0, x1]) => (
          <CuboidCollider key={`s${x0}`} args={[(x1 - x0) / 2, FOOTPATH_H / 2, 1.5]} position={[(x0 + x1) / 2, FOOTPATH_H / 2, 16.5]} />
        ))}
      </RigidBody>
    </group>
  );
}

/** One stretch of footpath on one side (materials are cloned so each stretch tiles at its own length). */
function Footpath({ side, x0, x1, paving, kerb }: { side: Gap['side']; x0: number; x1: number; paving: THREE.MeshStandardMaterial; kerb: THREE.MeshStandardMaterial }) {
  const w = x1 - x0;
  const cx = (x0 + x1) / 2;
  // the building's side is the 5 m forecourt, the far side a 3 m footpath
  const [z, depth, kerbZ] = side === 'n' ? [2.5, 5, ROAD.north - 0.12] : [16.5, 3, ROAD.south + 0.12];
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
    return { a: tiled(paving), k: tiled(kerb) };
  }, [paving, kerb, w]);
  // wet with the rest
  useFrame(() => {
    mats.a.roughness = paving.roughness;
    mats.a.color.copy(paving.color);
  });
  return (
    <group>
      <mesh position={[cx, FOOTPATH_H / 2, z]} receiveShadow material={mats.a}>
        <boxGeometry args={[w, FOOTPATH_H, depth]} />
      </mesh>
      <mesh position={[cx, 0.11, kerbZ]} castShadow receiveShadow material={mats.k}>
        <boxGeometry args={[w, 0.22, 0.24]} />
      </mesh>
    </group>
  );
}

/** Concrete electric poles along the south footpath, with sagging wires. */
function Poles({ gaps }: { gaps?: Gap[] }) {
  const xs = useMemo(() => Array.from({ length: 5 }, (_, i) => -56 + i * 28).filter((x) => !inGap(gaps, 's', x, x)), [gaps]);
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
  useLayoutEffect(() => (merged.current ? mergeStatic(merged.current) : undefined), [xs]);
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
function StreetLights({ gaps }: { gaps?: Gap[] }) {
  const xs = useMemo(() => [-54, -36, -18, 18, 36, 54].filter((x) => !inGap(gaps, 'n', x, x)), [gaps]);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.45, metalness: 0.7 }), []);
  const lampMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9dde0', emissive: '#ffe7c2', emissiveIntensity: 0, roughness: 0.3 }), []);
  const lights = useRef<(VirtualLight | null)[]>([]);
  useFrame(() => {
    const on = world.night;
    lampMat.emissiveIntensity = on * 4;
    lights.current.forEach((l) => l && (l.intensity = on * 38));
  });
  const merged = useRef<THREE.Group>(null);
  useLayoutEffect(() => (merged.current ? mergeStatic(merged.current) : undefined), [xs]);
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
