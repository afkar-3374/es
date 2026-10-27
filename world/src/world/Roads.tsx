import * as THREE from 'three';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { applyWetness, usePBR } from './materials';
import { world } from './state';
import { BEACH, BOUNDS, ROADS, segmentsOf, type Road } from './layout';

/*
 * The ground the town stands on, every road except the main street (Street.tsx draws
 * that one), flat paved footpaths beside them, street lamps, and the hills and sea
 * that keep you in town.
 */

const GROUND = { x0: BEACH.sandTop, x1: BOUNDS.maxX + 30, z0: BOUNDS.minZ - 30, z1: BOUNDS.maxZ + 30 };
const SIDE_ROADS = ROADS.filter((r) => r.id !== 'main');

/** A flat rectangle on the ground, as geometry in world space (UVs in metres / tile). */
function flat(x0: number, x1: number, z0: number, z1: number, y: number, tile: number) {
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, y, (z0 + z1) / 2);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * (x1 - x0)) / tile, (uv.getY(i) * (z1 - z0)) / tile);
  return g;
}

/** Turn "along / across the road" into a world rectangle. */
function rect(road: Road, a0: number, a1: number, c0: number, c1: number): [number, number, number, number] {
  return road.axis === 'x' ? [a0, a1, c0, c1] : [c0, c1, a0, a1];
}

export function Roads() {
  const asphalt = usePBR('asphalt_02', [1, 1]);
  const paving = usePBR('hexagonal_concrete_paving', [1, 1]);
  const soil = usePBR('red_laterite_soil_stones', [1, 1]);

  const geo = useMemo(() => {
    const roads: THREE.BufferGeometry[] = [];
    const paint: THREE.BufferGeometry[] = [];
    const paths: THREE.BufferGeometry[] = [];
    const poles: THREE.BufferGeometry[] = [];
    const lamps: THREE.BufferGeometry[] = [];
    SIDE_ROADS.forEach((road, i) => {
      // carriageways sit a hair lower than the main street so junctions don't flicker
      const y = 0.002 + i * 0.0004;
      roads.push(flat(...rect(road, road.from - road.w / 2, road.to + road.w / 2, road.c - road.w / 2, road.c + road.w / 2), y, 6));
      for (const [a, b] of segmentsOf(road, 1.5)) {
        // dashed centre line and edge lines
        for (let s = a + 2; s + 3 < b; s += 6) paint.push(flat(...rect(road, s, s + 3, road.c - 0.06, road.c + 0.06), 0.013, 1));
        for (const e of [-1, 1]) paint.push(flat(...rect(road, a, b, road.c + e * (road.w / 2 - 0.35) - 0.06, road.c + e * (road.w / 2 - 0.35) + 0.06), 0.013, 1));
      }
      // footpaths both sides (Beach Road's sea side is the promenade, drawn by the beach)
      for (const [a, b] of segmentsOf(road, 2.5)) {
        for (const e of [-1, 1]) {
          if (road.id === 'coast' && e === -1) continue;
          const inner = road.c + e * (road.w / 2);
          const outer = inner + e * 2.5;
          paths.push(flat(...rect(road, a, b, Math.min(inner, outer), Math.max(inner, outer)), 0.02, 2.5));
        }
        // a lamp every 32 m on one side
        for (let s = a + 8; s < b - 4; s += 32) {
          const c = road.c + (road.w / 2 + 0.6) * (road.axis === 'x' ? -1 : 1);
          const [x, z] = road.axis === 'x' ? [s, c] : [c, s];
          const toward = road.axis === 'x' ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(-1, 0, 0);
          const pole = new THREE.CylinderGeometry(0.06, 0.09, 7, 8);
          pole.translate(x, 3.5, z);
          poles.push(pole);
          const arm = new THREE.BoxGeometry(road.axis === 'x' ? 0.08 : 1.4, 0.08, road.axis === 'x' ? 1.4 : 0.08);
          arm.translate(x + toward.x * 0.7, 6.9, z + toward.z * 0.7);
          poles.push(arm);
          const lamp = new THREE.BoxGeometry(road.axis === 'x' ? 0.3 : 0.6, 0.08, road.axis === 'x' ? 0.6 : 0.3);
          lamp.translate(x + toward.x * 1.4, 6.85, z + toward.z * 1.4);
          lamps.push(lamp);
        }
      }
    });
    const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    return {
      roads: merge(roads),
      paint: merge(paint),
      paths: merge(paths),
      poles: merge(poles),
      lamps: merge(lamps),
      ground: flat(GROUND.x0, GROUND.x1, GROUND.z0, GROUND.z1, -0.01, 4),
    };
  }, []);

  const mats = useMemo(
    () => ({
      paint: new THREE.MeshStandardMaterial({ color: '#efeee8', roughness: 0.6 }),
      metal: new THREE.MeshStandardMaterial({ color: '#5d6166', roughness: 0.45, metalness: 0.7 }),
      lamp: new THREE.MeshStandardMaterial({ color: '#d9dde0', emissive: '#ffe7c2', emissiveIntensity: 0, roughness: 0.3 }),
    }),
    []
  );
  const wetting = useMemo(() => [asphalt, paving, soil], [asphalt, paving, soil]);
  useFrame(() => {
    applyWetness(wetting, world.wet);
    mats.lamp.emissiveIntensity = world.night * 4;
  });

  return (
    <group>
      <mesh geometry={geo.ground} material={soil} receiveShadow />
      <mesh geometry={geo.roads} material={asphalt} receiveShadow />
      <mesh geometry={geo.paint} material={mats.paint} receiveShadow />
      <mesh geometry={geo.paths} material={paving} receiveShadow />
      <mesh geometry={geo.poles} material={mats.metal} castShadow />
      <mesh geometry={geo.lamps} material={mats.lamp} />
      <Hills />

      <RigidBody type="fixed" colliders={false}>
        {/* the ground (the beach has its own sloping sand) */}
        <CuboidCollider args={[(GROUND.x1 - GROUND.x0) / 2, 0.5, (GROUND.z1 - GROUND.z0) / 2]} position={[(GROUND.x0 + GROUND.x1) / 2, -0.5, (GROUND.z0 + GROUND.z1) / 2]} />
        {/* the edges of town */}
        <CuboidCollider args={[0.5, 8, (BOUNDS.maxZ - BOUNDS.minZ) / 2 + 20]} position={[BOUNDS.maxX + 0.5, 8, (BOUNDS.minZ + BOUNDS.maxZ) / 2]} />
        <CuboidCollider args={[(BOUNDS.maxX - BOUNDS.minX) / 2 + 20, 8, 0.5]} position={[(BOUNDS.minX + BOUNDS.maxX) / 2, 8, BOUNDS.minZ - 0.5]} />
        <CuboidCollider args={[(BOUNDS.maxX - BOUNDS.minX) / 2 + 20, 8, 0.5]} position={[(BOUNDS.minX + BOUNDS.maxX) / 2, 8, BOUNDS.maxZ + 0.5]} />
      </RigidBody>
    </group>
  );
}

/** Green Western Ghats foothills beyond the town on three sides (just scenery). */
function Hills() {
  const geometry = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    const add = (x: number, z: number, r: number, h: number) => {
      const g = new THREE.ConeGeometry(r, h, 12, 1, true);
      g.translate(x, h / 2 - 2, z);
      parts.push(g);
    };
    for (let x = -200; x <= 320; x += 55) {
      add(x, BOUNDS.minZ - 70 - ((x * 7) % 30), 70 + ((x * 13) % 30), 28 + ((x * 3) % 18));
      add(x + 20, BOUNDS.maxZ + 70 + ((x * 5) % 30), 70 + ((x * 11) % 30), 26 + ((x * 7) % 20));
    }
    for (let z = -260; z <= 300; z += 60) add(BOUNDS.maxX + 80 + ((z * 3) % 30), z, 80 + ((z * 7) % 30), 34 + ((z * 5) % 20));
    return mergeGeometries(parts.map((g) => g.toNonIndexed()))!;
  }, []);
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#4f6b3a" roughness={1} flatShading />
    </mesh>
  );
}
