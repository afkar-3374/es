import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture } from './materials';
import { noRaycast } from './merge';
import { getMeta, groundAt } from './map';
import { useReal } from './real';

/*
 * Bus stops where Kasaragod really has them (OpenStreetMap): a shelter with a sheet roof,
 * a bench and a blue BUS STOP board, its back to the road's edge. Buses in the traffic stop
 * at them (Traffic.tsx).
 */

/** Shown within this far of the camera */
const NEAR = 650;
const MAX = 60;

const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0) => {
  const g = new THREE.BoxGeometry(sx, sy, sz);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return g;
};

// the shelter in its own space: x along the road, z away from it
const STEEL = mergeGeometries([
  ...[-2.1, 2.1].flatMap((x) => [box(0.08, 2.7, 0.08, x, 1.35, 0.25), box(0.08, 2.5, 0.08, x, 1.25, 1.85)]),
  box(0.06, 2.6, 0.06, 2.9, 1.3, 0.1),
]);
const ROOF = box(4.7, 0.08, 2.5, 0, 2.66, 1.05, -0.08);
const BENCH = mergeGeometries([box(3.6, 0.06, 0.42, 0, 0.46, 1.55), ...[-1.5, 0, 1.5].map((x) => box(0.06, 0.46, 0.36, x, 0.23, 1.55))]);
const WALL = box(4.3, 1.8, 0.08, 0, 1.25, 1.9);
const BOARD = new THREE.PlaneGeometry(0.75, 0.5).translate(2.9, 2.35, 0.14);

export function BusStops() {
  const real = useReal();
  const mats = useMemo(() => {
    const sign = canvasTexture(192, 128, (g) => {
      g.fillStyle = '#1d4ed8';
      g.fillRect(0, 0, 192, 128);
      g.strokeStyle = '#fff';
      g.lineWidth = 5;
      g.strokeRect(6, 6, 180, 116);
      g.fillStyle = '#fff';
      g.textAlign = 'center';
      g.font = '900 30px Arial, sans-serif';
      g.fillText('BUS STOP', 96, 52);
      g.font = '700 26px sans-serif';
      g.fillText('ബസ് സ്റ്റോപ്പ്', 96, 96);
    });
    return {
      steel: new THREE.MeshStandardMaterial({ color: '#8a9096', metalness: 0.6, roughness: 0.45 }),
      roof: new THREE.MeshStandardMaterial({ color: '#2f6f9f', metalness: 0.4, roughness: 0.5, side: THREE.DoubleSide }),
      bench: new THREE.MeshStandardMaterial({ color: '#c7c2b8', roughness: 0.8 }),
      wall: new THREE.MeshStandardMaterial({ color: '#e8d9a8', roughness: 0.9 }),
      board: new THREE.MeshStandardMaterial({ map: sign, roughness: 0.5, side: THREE.DoubleSide }),
    };
  }, []);
  const parts = useMemo(
    () =>
      [
        [STEEL, mats.steel],
        [ROOF, mats.roof],
        [BENCH, mats.bench],
        [WALL, mats.wall],
        [BOARD, mats.board],
      ].map(([g, m]) => {
        const mesh = new THREE.InstancedMesh(g as THREE.BufferGeometry, m as THREE.Material, MAX);
        mesh.count = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.raycast = noRaycast;
        mesh.frustumCulled = false;
        return mesh;
      }),
    [mats]
  );
  useEffect(() => () => parts.forEach((p) => p.dispose()), [parts]);

  const last = useRef({ x: 1e9, z: 1e9, t: 0 });
  const m = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame(({ camera, clock }) => {
    const l = last.current;
    const { x, z } = camera.position;
    // again when you've moved, and now and then (for ground that has just loaded)
    if (Math.hypot(x - l.x, z - l.z) < 40 && clock.elapsedTime - l.t < 3) return;
    Object.assign(l, { x, z, t: clock.elapsedTime });
    const stops = getMeta()?.busStops ?? [];
    let n = 0;
    for (const [sx, sz, a] of stops) {
      if (n >= MAX) break;
      if (Math.abs(sx - x) > NEAR || Math.abs(sz - z) > NEAR) continue;
      q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, -a / 1000);
      m.compose(new THREE.Vector3(sx, groundAt(sx, sz), sz), q, new THREE.Vector3(1, 1, 1));
      for (const p of parts) p.setMatrixAt(n, m);
      n++;
    }
    for (const p of parts) {
      p.count = n;
      p.instanceMatrix.needsUpdate = true;
    }
  });
  return (
    <group visible={!real}>
      {parts.map((p, i) => (
        <primitive key={i} object={p} />
      ))}
    </group>
  );
}
