import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Cup } from './Cups';
import { useUi } from './interact';
import { coverMaterials } from './Library';

/**
 * What you're holding, seen in first person: your drink in the right hand (lifted to
 * your mouth for each sip) and the book you're carrying in the left.
 */
export function Held() {
  const { drink, carrying, sips, reading, riding } = useUi();
  const { camera } = useThree();
  const rig = useRef<THREE.Group>(null);
  const cup = useRef<THREE.Group>(null);
  const sipT = useRef(10);
  const lastSips = useRef(sips);

  useEffect(() => {
    if (sips !== lastSips.current) {
      lastSips.current = sips;
      sipT.current = 0;
    }
  }, [sips]);

  const bookMats = useMemo(() => (carrying ? coverMaterials(carrying) : null), [carrying]);

  useFrame((_, dt) => {
    const g = rig.current;
    if (!g) return;
    g.position.copy(camera.position);
    g.quaternion.copy(camera.quaternion);
    // the sip: lift to the mouth, tilt, hold, bring back down (1.4 s)
    sipT.current += dt;
    const c = cup.current;
    if (c) {
      const t = sipT.current;
      const up = t < 0.35 ? t / 0.35 : t < 1.0 ? 1 : t < 1.4 ? 1 - (t - 1.0) / 0.4 : 0;
      const e = up * up * (3 - 2 * up);
      c.position.set(THREE.MathUtils.lerp(0.21, 0.05, e), THREE.MathUtils.lerp(-0.26, -0.2, e), THREE.MathUtils.lerp(-0.48, -0.32, e));
      c.rotation.set(e * 0.55, THREE.MathUtils.lerp(-0.25, 0, e), THREE.MathUtils.lerp(0.08, 0.1, e));
    }
  });

  if (reading || riding) return null;
  return (
    <group ref={rig}>
      {drink && (
        <group ref={cup}>
          <Cup kind={drink.kind} level={drink.sipsLeft / 4} steam />
        </group>
      )}
      {carrying && bookMats && (
        <group position={[-0.24, -0.27, -0.42]} rotation={[-0.75, 0.35, 0.2]}>
          <mesh material={bookMats}>
            <boxGeometry args={[0.17, 0.24, 0.03]} />
          </mesh>
        </group>
      )}
    </group>
  );
}
