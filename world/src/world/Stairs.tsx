import * as THREE from 'three';
import { useMemo } from 'react';
import { CuboidCollider, ConvexHullCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Text } from '@react-three/drei';
import { glassMaterial, usePBR } from './materials';
import { STAIRWELL } from './Building';

/*
 * A straight staircase in the middle of the arcade. You walk to the back, turn round
 * and climb towards the front of the building, arriving upstairs facing the windows.
 *   foot: z = −17.2 at the ground floor (y 0.3)
 *   top:  z = −10.0 at the first floor (y 4.8)
 */
const FONT = `${import.meta.env.BASE_URL}fonts/Poppins-SemiBold.ttf`;
const BOTTOM = 0.3;
const TOP = 4.8;
const Z_FOOT = -17.2; // leaves a 2.5 m landing at the back to step on from
const Z_TOP = STAIRWELL.z1;
const HALF = 1.0; // half width of the steps
const RISERS = 26;
const RISE = (TOP - BOTTOM) / RISERS;
const RUN = (Z_TOP - Z_FOOT) / RISERS;

export function Stairs() {
  const wood = usePBR('wood_floor', [1, 0.2], { tint: '#c99a6e' });
  const cladding = usePBR('wood_floor', [1, 1]);
  const riserMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.6 }), []);
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4d7db', roughness: 0.2, metalness: 0.9 }), []);
  const glass = useMemo(glassMaterial, []);

  const { treads, risers } = useMemo(() => {
    const t: THREE.BufferGeometry[] = [];
    const r: THREE.BufferGeometry[] = [];
    for (let i = 0; i < RISERS; i++) {
      const y = BOTTOM + RISE * (i + 1);
      const z = Z_FOOT + RUN * i;
      const tread = new THREE.BoxGeometry(HALF * 2, 0.04, RUN + 0.03);
      tread.translate(0, y - 0.02, z + RUN / 2 + 0.015);
      t.push(tread);
      const riser = new THREE.BoxGeometry(HALF * 2 - 0.01, RISE, 0.02);
      riser.translate(0, y - RISE / 2 - 0.02, z + 0.01);
      r.push(riser);
    }
    return { treads: mergeGeometries(t)!, risers: mergeGeometries(r)! };
  }, []);

  // The solid wedge under the steps, as seen from the arcade
  const sides = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(Z_FOOT, BOTTOM);
    shape.lineTo(Z_TOP, TOP);
    shape.lineTo(Z_TOP, BOTTOM);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: HALF * 2 + 0.16, bevelEnabled: false });
    // the shape is drawn in (z, y) and extruded along its own z: map it to world (x, y, z)
    g.applyMatrix4(new THREE.Matrix4().set(0, 0, 1, -(HALF + 0.08), 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 2.5, uv.getY(i) / 2.5);
    g.computeVertexNormals();
    return g;
  }, []);

  // Glass balustrades along both sides of the flight, with a steel handrail on top
  const slope = Math.atan2(TOP - BOTTOM, Z_TOP - Z_FOOT);
  const flightLen = Math.hypot(TOP - BOTTOM, Z_TOP - Z_FOOT);
  const midY = (BOTTOM + TOP) / 2;
  const midZ = (Z_FOOT + Z_TOP) / 2;

  const hull = useMemo(
    () =>
      new Float32Array([
        -HALF - 0.08, BOTTOM, Z_FOOT,
        HALF + 0.08, BOTTOM, Z_FOOT,
        -HALF - 0.08, BOTTOM, Z_TOP,
        HALF + 0.08, BOTTOM, Z_TOP,
        -HALF - 0.08, TOP, Z_TOP,
        HALF + 0.08, TOP, Z_TOP,
      ]),
    []
  );

  return (
    <group>
      <mesh geometry={treads} material={wood} castShadow receiveShadow />
      <mesh geometry={risers} material={riserMat} receiveShadow />
      {/* the wedge under the steps, clad in warm wood, with a sign on both sides */}
      <mesh geometry={sides} castShadow receiveShadow>
        <meshStandardMaterial map={cladding.map} normalMap={cladding.normalMap} roughnessMap={cladding.roughnessMap} color="#c08a5c" side={THREE.DoubleSide} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (HALF + 0.09), 2.6, Z_TOP - 1.6]} rotation-y={s * Math.PI / 2}>
          <Text font={FONT} fontSize={0.34} letterSpacing={0.16} color="#fff4e0" anchorX="center" anchorY="middle">
            LIBRARY
          </Text>
          <Text font={FONT} position={[0, -0.36, 0]} fontSize={0.15} letterSpacing={0.3} color="#ffe2c4" anchorX="center" anchorY="middle">
            UPSTAIRS
          </Text>
        </group>
      ))}

      {[-1, 1].map((s) => (
        <group key={s} position={[s * (HALF + 0.03), midY + 0.55, midZ]} rotation-x={-slope}>
          <mesh material={glass}>
            <boxGeometry args={[0.02, 1.0, flightLen]} />
          </mesh>
          <mesh position={[0, 0.52, 0]} material={steel} castShadow>
            <boxGeometry args={[0.05, 0.05, flightLen + 0.1]} />
          </mesh>
        </group>
      ))}

      {/* Upstairs: a glass railing around the stairwell (open towards the front) */}
      <StairwellRail glass={glass} steel={steel} />

      <RigidBody type="fixed" colliders={false}>
        {/* walk up the slope; the wedge also stops you walking underneath */}
        <ConvexHullCollider args={[hull]} />
        {/* balustrades */}
        {[-1, 1].map((s) => (
          <CuboidCollider key={s} args={[0.05, 0.6, flightLen / 2]} position={[s * (HALF + 0.05), midY + 0.6, midZ]} rotation={[-slope, 0, 0]} />
        ))}
      </RigidBody>
    </group>
  );
}

function StairwellRail({ glass, steel }: { glass: THREE.Material; steel: THREE.Material }) {
  const y = TOP + 0.55;
  const len = STAIRWELL.z1 - STAIRWELL.z0;
  const midZ = (STAIRWELL.z0 + STAIRWELL.z1) / 2;
  const segments: { x: number; z: number; w: number; d: number }[] = [
    // the two long sides; the front end (z1) is where the stairs arrive, so it stays open
    { x: STAIRWELL.x0 - 0.03, z: midZ, w: 0.02, d: len },
    { x: STAIRWELL.x1 + 0.03, z: midZ, w: 0.02, d: len },
    { x: 0, z: STAIRWELL.z0 - 0.03, w: STAIRWELL.x1 - STAIRWELL.x0 + 0.08, d: 0.02 },
  ];
  return (
    <group>
      {segments.map((g, i) => (
        <group key={i}>
          <mesh position={[g.x, y, g.z]} material={glass}>
            <boxGeometry args={[g.w, 1.0, g.d]} />
          </mesh>
          <mesh position={[g.x, y + 0.52, g.z]} material={steel} castShadow>
            <boxGeometry args={[Math.max(g.w, 0.05), 0.05, Math.max(g.d, 0.05)]} />
          </mesh>
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        {segments.map((g, i) => (
          <CuboidCollider key={i} args={[Math.max(g.w, 0.1) / 2, 0.6, Math.max(g.d, 0.1) / 2]} position={[g.x, y, g.z]} />
        ))}
      </RigidBody>
    </group>
  );
}
