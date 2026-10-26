import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { canvasTexture } from './materials';
import type { DrinkKind } from './interact';

/*
 * The drinks, at real size (metres):
 *   chai    – Kerala tea in a small glass tumbler, milky-brown with froth
 *   coffee  – South Indian filter coffee in a steel tumbler standing in its dabarah
 *   cold    – cold coffee in a tall glass with ice and a straw
 * `level` 0…1 is how much is left.
 */
const steel = new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.18, metalness: 1 });
const glass = new THREE.MeshStandardMaterial({ color: '#dfeaf0', roughness: 0.05, metalness: 0, transparent: true, opacity: 0.32, depthWrite: false });

export function Cup({ kind, level = 1, steam = true }: { kind: DrinkKind; level?: number; steam?: boolean }) {
  const chai = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b07a4f', roughness: 0.35 }), []);
  const froth = useMemo(() => new THREE.MeshStandardMaterial({ color: '#e9d6b8', roughness: 0.8 }), []);
  const cold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#a7774f', roughness: 0.3, transparent: true, opacity: 0.92 }), []);
  const l = Math.max(level, 0);

  if (kind === 'chai') {
    const h = 0.085;
    return (
      <group>
        <mesh position={[0, h / 2, 0]} material={glass}>
          <cylinderGeometry args={[0.032, 0.026, h, 20, 1, true]} />
        </mesh>
        <mesh position={[0, 0.003, 0]} material={glass}>
          <cylinderGeometry args={[0.026, 0.026, 0.006, 20]} />
        </mesh>
        {l > 0 && (
          <>
            <mesh position={[0, (h * 0.85 * l) / 2 + 0.004, 0]} material={chai}>
              <cylinderGeometry args={[0.026 + 0.0055 * l * 0.85, 0.025, h * 0.85 * l, 20]} />
            </mesh>
            <mesh position={[0, h * 0.85 * l + 0.005, 0]} rotation-x={-Math.PI / 2} material={froth}>
              <circleGeometry args={[0.026 + 0.0055 * l * 0.85, 20]} />
            </mesh>
          </>
        )}
        {steam && l > 0 && <Steam y={h} />}
      </group>
    );
  }

  if (kind === 'coffee') {
    const h = 0.09;
    return (
      <group>
        {/* the dabarah (wide bowl) */}
        <mesh position={[0, 0.022, 0]} material={steel} castShadow>
          <cylinderGeometry args={[0.058, 0.04, 0.044, 28, 1, true]} />
        </mesh>
        <mesh position={[0, 0.001, 0]} material={steel}>
          <cylinderGeometry args={[0.04, 0.04, 0.002, 28]} />
        </mesh>
        <mesh position={[0, 0.044, 0]} rotation-x={Math.PI / 2} material={steel}>
          <torusGeometry args={[0.058, 0.003, 6, 28]} />
        </mesh>
        {/* the tumbler standing in it */}
        <mesh position={[0, 0.015 + h / 2, 0]} material={steel} castShadow>
          <cylinderGeometry args={[0.033, 0.027, h, 28, 1, true]} />
        </mesh>
        <mesh position={[0, 0.015 + h, 0]} rotation-x={Math.PI / 2} material={steel}>
          <torusGeometry args={[0.033, 0.0025, 6, 28]} />
        </mesh>
        {l > 0 && (
          <mesh position={[0, 0.015 + h * (0.35 + 0.6 * l), 0]} rotation-x={-Math.PI / 2} material={froth}>
            <circleGeometry args={[0.031, 24]} />
          </mesh>
        )}
        <mesh position={[0, 0.016, 0]} material={steel}>
          <cylinderGeometry args={[0.027, 0.027, 0.002, 20]} />
        </mesh>
        {steam && l > 0 && <Steam y={0.015 + h} />}
      </group>
    );
  }

  // cold coffee
  const h = 0.15;
  return (
    <group>
      <mesh position={[0, h / 2, 0]} material={glass}>
        <cylinderGeometry args={[0.036, 0.03, h, 22, 1, true]} />
      </mesh>
      {l > 0 && (
        <mesh position={[0, (h * 0.85 * l) / 2 + 0.004, 0]} material={cold}>
          <cylinderGeometry args={[0.034, 0.029, h * 0.85 * l, 22]} />
        </mesh>
      )}
      {l > 0.3 &&
        [0, 1, 2].map((i) => (
          <mesh key={i} position={[Math.cos(i * 2.1) * 0.015, h * 0.85 * l - 0.008, Math.sin(i * 2.1) * 0.015]} rotation={[i, i * 2, 0]}>
            <boxGeometry args={[0.016, 0.016, 0.016]} />
            <meshStandardMaterial color="#eef6fb" roughness={0.05} transparent opacity={0.7} />
          </mesh>
        ))}
      <mesh position={[0.012, h * 0.7, 0]} rotation-z={-0.18}>
        <cylinderGeometry args={[0.0035, 0.0035, h * 1.05, 8]} />
        <meshStandardMaterial color="#ff7aa8" roughness={0.5} />
      </mesh>
    </group>
  );
}

let steamTex: THREE.Texture | null = null;
function getSteam() {
  steamTex ??= canvasTexture(64, 64, (g) => {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
    grad.addColorStop(0, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  });
  return steamTex;
}

/** Wisps of steam rising from a hot drink. */
export function Steam({ y }: { y: number }) {
  const puffs = useRef<(THREE.Sprite | null)[]>([]);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    puffs.current.forEach((s, i) => {
      if (!s) return;
      const k = (t * 0.35 + i / 4) % 1;
      s.position.set(Math.sin(t * 1.3 + i * 2) * 0.015 * k, y + k * 0.22, 0);
      s.scale.setScalar(0.04 + k * 0.1);
      (s.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.45;
    });
  });
  return (
    <>
      {[0, 1, 2, 3].map((i) => (
        <sprite key={i} ref={(s) => (puffs.current[i] = s)}>
          <spriteMaterial map={getSteam()} transparent depthWrite={false} opacity={0} />
        </sprite>
      ))}
    </>
  );
}

export const DRINKS: Record<DrinkKind, { name: string; emoji: string; blurb: string }> = {
  chai: { name: 'Kerala chai', emoji: '🍵', blurb: 'strong tea boiled with milk, poured from a height for that frothy top' },
  coffee: { name: 'Filter coffee', emoji: '☕', blurb: 'South Indian filter coffee, cooled between the tumbler and dabarah' },
  cold: { name: 'Cold coffee', emoji: '🧋', blurb: 'chilled coffee shaken with milk and ice' },
};
