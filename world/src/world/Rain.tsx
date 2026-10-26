import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { insideBuilding, world } from './state';

const MAX_DROPS = 2400;
const RADIUS = 28;
const TOP = 22;

/** Rain streaks around the visitor; none fall through the building's roof. */
export function Rain({ intensity, wind }: { intensity: number; wind: number }) {
  const count = Math.round(MAX_DROPS * Math.min(Math.max(intensity, 0), 1));
  const { geometry, drops } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX_DROPS * 6), 3));
    const d = new Float32Array(MAX_DROPS * 4); // x, y, z, speed
    for (let i = 0; i < MAX_DROPS; i++) {
      d[i * 4] = (Math.random() * 2 - 1) * RADIUS;
      d[i * 4 + 1] = Math.random() * TOP;
      d[i * 4 + 2] = (Math.random() * 2 - 1) * RADIUS;
      d[i * 4 + 3] = 14 + Math.random() * 6;
    }
    return { geometry: g, drops: d };
  }, []);
  const lines = useRef<THREE.LineSegments>(null);

  useFrame((_, dt) => {
    if (!lines.current || count === 0) return;
    const step = Math.min(dt, 0.05);
    const p = world.player;
    const slant = wind * 0.02;
    const pos = geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < count; i++) {
      let x = drops[i * 4];
      let y = drops[i * 4 + 1];
      let z = drops[i * 4 + 2];
      const v = drops[i * 4 + 3];
      y -= v * step;
      x += slant * step * 4;
      const wx = p.x + x;
      const wz = p.z + z;
      // landed, drifted away, or would be falling indoors: start again at the top
      if (y < 0 || Math.abs(x) > RADIUS || insideBuilding(wx, wz, 0.3) && y < 10) {
        x = (Math.random() * 2 - 1) * RADIUS;
        z = (Math.random() * 2 - 1) * RADIUS;
        y = TOP * (0.6 + Math.random() * 0.4);
      }
      drops[i * 4] = x;
      drops[i * 4 + 1] = y;
      drops[i * 4 + 2] = z;
      const len = 0.35 + v * 0.02;
      pos[i * 6] = p.x + x;
      pos[i * 6 + 1] = y;
      pos[i * 6 + 2] = p.z + z;
      pos[i * 6 + 3] = p.x + x - slant * 0.06;
      pos[i * 6 + 4] = y + len;
      pos[i * 6 + 5] = p.z + z;
    }
    geometry.setDrawRange(0, count * 2);
    geometry.attributes.position.needsUpdate = true;
  });

  if (count === 0) return null;
  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <lineBasicMaterial color="#c9d6e3" transparent opacity={0.38} depthWrite={false} />
    </lineSegments>
  );
}
