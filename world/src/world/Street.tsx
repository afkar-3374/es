import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { applyWetness, canvasTexture, usePBR } from './materials';
import { world } from './state';

/*
 * Street layout (metres). The street runs east–west along X.
 *   z  0 … 5    forecourt in front of the Electrosparkzz building (north side)
 *   z  5 … 15   two-lane road, centre line at z = 10
 *   z 15 … 18   footpath on the south side, buildings beyond
 */
export const ROAD = { north: 5, south: 15, centre: 10, length: 400 };
const FOOTPATH_H = 0.16;

export function Street() {
  const asphalt = usePBR('asphalt_02', [ROAD.length / 6, 10 / 6]);
  const paving = usePBR('hexagonal_concrete_paving', [ROAD.length / 2.5, 5 / 2.5]);
  const paving2 = usePBR('hexagonal_concrete_paving', [ROAD.length / 2.5, 3 / 2.5]);
  const soil = usePBR('red_laterite_soil_stones', [ROAD.length / 4, 60 / 4]);
  const kerbMat = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 0.85,
        map: canvasTexture(64, 8, (g) => {
          g.fillStyle = '#1b1b1b';
          g.fillRect(0, 0, 32, 8);
          g.fillStyle = '#e9e6dc';
          g.fillRect(32, 0, 32, 8);
        }, [ROAD.length / 1.6, 1]),
      }),
    []
  );
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 0.6 }), []);

  // Wet roads and paving in the rain
  const wetting = useMemo(() => [asphalt, paving, paving2, soil], [asphalt, paving, paving2, soil]);
  useFrame(() => applyWetness(wetting, world.wet));

  // Road paint: dashed centre line, edge lines and a zebra crossing in front of the building
  const markings = useMemo(() => {
    const parts: { x: number; z: number; w: number; d: number }[] = [];
    for (let x = -ROAD.length / 2; x < ROAD.length / 2; x += 6) {
      if (Math.abs(x) < 6) continue; // no centre line across the crossing
      parts.push({ x: x + 1.5, z: ROAD.centre, w: 3, d: 0.12 });
    }
    parts.push({ x: 0, z: ROAD.north + 0.35, w: ROAD.length, d: 0.12 });
    parts.push({ x: 0, z: ROAD.south - 0.35, w: ROAD.length, d: 0.12 });
    for (let z = ROAD.north + 0.8; z < ROAD.south - 0.6; z += 1.0) parts.push({ x: 0, z: z + 0.25, w: 4, d: 0.5 });
    return parts;
  }, []);

  return (
    <group>
      {/* Ground under everything */}
      <mesh rotation-x={-Math.PI / 2} position={[0, -0.01, 0]} receiveShadow material={soil}>
        <planeGeometry args={[ROAD.length, 60]} />
      </mesh>

      {/* Road */}
      <mesh rotation-x={-Math.PI / 2} position={[0, 0.005, ROAD.centre]} receiveShadow material={asphalt}>
        <planeGeometry args={[ROAD.length, ROAD.south - ROAD.north]} />
      </mesh>
      {markings.map((m, i) => (
        <mesh key={i} rotation-x={-Math.PI / 2} position={[m.x, 0.012, m.z]} material={paint} receiveShadow>
          <planeGeometry args={[m.w, m.d]} />
        </mesh>
      ))}

      {/* Footpaths with Kerala-style black-and-white kerbs */}
      <mesh position={[0, FOOTPATH_H / 2, 2.5]} receiveShadow material={paving}>
        <boxGeometry args={[ROAD.length, FOOTPATH_H, 5]} />
      </mesh>
      <mesh position={[0, FOOTPATH_H / 2, 16.5]} receiveShadow material={paving2}>
        <boxGeometry args={[ROAD.length, FOOTPATH_H, 3]} />
      </mesh>
      {[ROAD.north - 0.12, ROAD.south + 0.12].map((z) => (
        <mesh key={z} position={[0, 0.11, z]} castShadow receiveShadow material={kerbMat}>
          <boxGeometry args={[ROAD.length, 0.22, 0.24]} />
        </mesh>
      ))}

      <Poles />
      <StreetLights />

      {/* Walkable ground */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[ROAD.length / 2, 0.5, 40]} position={[0, -0.5, 0]} />
        <CuboidCollider args={[ROAD.length / 2, FOOTPATH_H / 2, 2.5]} position={[0, FOOTPATH_H / 2, 2.5]} />
        <CuboidCollider args={[ROAD.length / 2, FOOTPATH_H / 2, 1.5]} position={[0, FOOTPATH_H / 2, 16.5]} />
      </RigidBody>
    </group>
  );
}

/** Concrete electric poles along the south footpath, with sagging wires. */
function Poles() {
  const xs = useMemo(() => Array.from({ length: 14 }, (_, i) => -195 + i * 30), []);
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
  return (
    <group>
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
  const xs = useMemo(() => [-60, -36, -18, 18, 36, 60], []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.45, metalness: 0.7 }), []);
  const lampMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9dde0', emissive: '#ffe7c2', emissiveIntensity: 0, roughness: 0.3 }), []);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const on = world.night;
    lampMat.emissiveIntensity = on * 4;
    lights.current.forEach((l) => l && (l.intensity = on * 38));
  });
  return (
    <group>
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
          <pointLight ref={(l) => (lights.current[i] = l)} position={[0, 7.4, 1.6]} color="#ffd9a6" distance={22} decay={1.6} intensity={0} />
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
