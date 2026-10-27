import * as THREE from 'three';
import { forwardRef, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';

/*
 * Lamps share a few real lights. Every pixel pays for every light in the scene, so instead
 * of a dozen point lights we keep four and hand them to the lamps nearest the camera.
 * The number of lights never changes (changing it would recompile every shader).
 * A Lamp looks like a PointLight to its owner: set .intensity, .color etc. as usual.
 */

export class VirtualLight extends THREE.Object3D {
  readonly isVirtualLight = true;
  intensity = 1;
  color = new THREE.Color('#ffffff');
  distance = 10;
  decay = 2;
}

const lamps = new Set<VirtualLight>();
const POOL = 4;

type LampProps = { position: [number, number, number]; color?: THREE.ColorRepresentation; intensity?: number; distance?: number; decay?: number };

/** A point light that borrows one of the shared lights when it's among the nearest. */
export const Lamp = forwardRef<VirtualLight, LampProps>(function Lamp({ position, color = '#ffffff', intensity = 1, distance = 10, decay = 2 }, ref) {
  const light = useMemo(() => new VirtualLight(), []);
  useEffect(() => {
    light.color.set(color);
    light.distance = distance;
    light.decay = decay;
  }, [light, color, distance, decay]);
  useEffect(() => {
    light.intensity = intensity;
  }, [light, intensity]);
  useEffect(() => {
    lamps.add(light);
    return () => void lamps.delete(light);
  }, [light]);
  return <primitive object={light} position={position} ref={ref} />;
});

/** The shared lights themselves (mount once). */
export function LampPool() {
  const real = useRef<(THREE.PointLight | null)[]>([]);
  const camera = useThree((s) => s.camera);
  const scratch = useMemo(() => ({ list: [] as { l: VirtualLight; d: number; at: THREE.Vector3 }[], at: [] as THREE.Vector3[] }), []);
  useFrame(() => {
    const list = scratch.list;
    list.length = 0;
    let k = 0;
    for (const l of lamps) {
      if (l.intensity <= 0.01) continue;
      const at = (scratch.at[k] ??= new THREE.Vector3());
      k++;
      l.getWorldPosition(at);
      const d = at.distanceTo(camera.position);
      // a lamp far beyond its reach can't light anything you see up close
      if (d > l.distance + 60) continue;
      // brighter, wider lamps matter more
      list.push({ l, d: d - l.distance * 0.5, at });
    }
    list.sort((a, b) => a.d - b.d);
    for (let i = 0; i < POOL; i++) {
      const r = real.current[i];
      if (!r) continue;
      const pick = list[i];
      if (!pick) {
        r.intensity = 0;
        continue;
      }
      r.position.copy(pick.at);
      r.color.copy(pick.l.color);
      r.intensity = pick.l.intensity;
      r.distance = pick.l.distance;
      r.decay = pick.l.decay;
    }
  });
  return (
    <>
      {Array.from({ length: POOL }, (_, i) => (
        <pointLight key={i} ref={(l) => (real.current[i] = l)} intensity={0} distance={10} position={[0, -50, 0]} />
      ))}
    </>
  );
}
