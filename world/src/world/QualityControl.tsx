import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { PerformanceMonitor } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { quality } from './quality';
import { world } from './state';

/** Keeps the frame rate up: watches it and moves the quality level (in auto mode). */
export function QualityControl() {
  return (
    <>
      <PerformanceMonitor bounds={(refresh) => (refresh > 90 ? [60, 85] : [50, 59])} flipflops={2} onDecline={() => quality.step(-1)} onIncline={() => quality.step(1)} onFallback={() => quality.step(-1)} />
      <ShadowPacer />
    </>
  );
}

/**
 * Shadows barely change from one frame to the next, so they're drawn every few frames (and
 * straight away once you've moved on, since the sun follows you). That's a big saving on
 * every device, and most of the time nobody can tell.
 */
function ShadowPacer() {
  const gl = useThree((s) => s.gl);
  const frame = useRef(0);
  const at = useRef(new THREE.Vector2(Infinity, Infinity));
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    return () => {
      gl.shadowMap.autoUpdate = true;
    };
  }, [gl]);
  useFrame(() => {
    const p = world.player;
    const moved = Math.abs(p.x - at.current.x) + Math.abs(p.z - at.current.y) > 0.5;
    if (moved || ++frame.current % 3 === 0) {
      at.current.set(p.x, p.z);
      gl.shadowMap.needsUpdate = true;
    }
  });
  return null;
}
