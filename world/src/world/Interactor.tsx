import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { taps, ui, type Interactable } from './interact';
import { isTouch } from '../player/input';

/** Finds what you're aiming at or tapping, and uses it. */
export function Interactor() {
  const { camera, scene } = useThree();
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const centre = useMemo(() => new THREE.Vector2(0, 0), []);
  const frame = useRef(0);

  const pick = (ndc: THREE.Vector2): Interactable | null => {
    ray.setFromCamera(ndc, camera);
    ray.far = 8;
    for (const hit of ray.intersectObjects(scene.children, true)) {
      let o: THREE.Object3D | null = hit.object;
      while (o && !o.userData.interact) o = o.parent;
      const item = o?.userData.interact as Interactable | undefined;
      if (item) return hit.distance <= (item.reach ?? 4.5) ? item : null;
      // the first solid thing in the way blocks the rest
      if ((hit.object as THREE.Mesh).isMesh && !(hit.object as THREE.Mesh).userData.seeThrough) {
        const m = (hit.object as THREE.Mesh).material as THREE.Material;
        if (!m.transparent) return null;
      }
    }
    return null;
  };

  useFrame(() => {
    // desktop: show what's under the crosshair (a few times a second is enough)
    if (!isTouch && ++frame.current % 6 === 0) ui.setHover(pick(centre)?.label ?? null);
    while (taps.length) {
      const t = taps.shift()!;
      pick(new THREE.Vector2(t.x, t.y))?.onUse();
    }
  });
  return null;
}
