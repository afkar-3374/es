import * as THREE from 'three';
import { useLayoutEffect, useRef } from 'react';
import { mergeStatic } from './merge';

/** Draws everything inside with as few draw calls as it can (see mergeStatic). */
export function Merged({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useLayoutEffect(() => (group.current ? mergeStatic(group.current) : undefined), []);
  return <group ref={group}>{children}</group>;
}
