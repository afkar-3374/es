import * as THREE from 'three';
import { useMemo } from 'react';
import { CylinderCollider, RigidBody } from '@react-three/rapier';
import { game, useGameValue } from './store';
import { ITEMS, SOURCES, type Source } from './catalog';
import type { Interactable } from '../world/interact';
import { FOOTPATH_H } from '../world/Street';

/*
 * Things to pick: coconut palms (the palms drawn in App), mango trees, hibiscus and
 * jasmine shrubs, and marigold beds. Each shows how many are left on it: the flowers
 * and fruit you can see are the ones still there, and they grow back over time.
 */

// a small seeded wobble, so the same bush looks the same for everyone
const rnd = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

const GREEN = new THREE.MeshStandardMaterial({ color: '#2f6b2a', roughness: 0.9, flatShading: true });
const LEAF = new THREE.MeshStandardMaterial({ color: '#3f7d2a', roughness: 0.85, flatShading: true });
const BARK = new THREE.MeshStandardMaterial({ color: '#6b4a2e', roughness: 1 });
const SOIL = new THREE.MeshStandardMaterial({ color: '#5c3a1e', roughness: 1 });
/** Invisible, but the crosshair can aim at it: see-through to the ray, so it's the first thing hit. */
const ZONE = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });

const flowerMat = (() => {
  const cache: Record<string, THREE.MeshStandardMaterial> = {};
  return (color: string) => (cache[color] ??= new THREE.MeshStandardMaterial({ color, roughness: 0.6, emissive: color, emissiveIntensity: 0.12 }));
})();

/** What you see when you aim at one of these. The label reads the stock as it is now. */
function pickable(src: Source): Interactable {
  const item = ITEMS[src.item];
  return {
    get label() {
      const left = game.get().stock[src.id] ?? 0;
      return left > 0 ? `Pick ${item.emoji} ${item.name.toLowerCase()} (${left} left)` : `${item.emoji} Nothing left here yet`;
    },
    onUse: () => game.pick(src.id),
    reach: 4.5,
  };
}

/** Every harvest source in town. `palms` is the set of palms actually drawn (some are left out by the road gaps). */
export function Harvest({ palms }: { palms: { x: number; z: number }[] }) {
  const drawn = (s: Source) => palms.some((p) => p.x === s.x && p.z === s.z);
  return (
    <group>
      {SOURCES.filter((s) => s.kind !== 'palm').map((s) => (
        <Plant key={s.id} src={s} />
      ))}
      {SOURCES.filter((s) => s.kind === 'palm' && drawn(s)).map((s) => (
        <PalmZone key={s.id} src={s} />
      ))}
    </group>
  );
}

/** A coconut palm: the palm is drawn elsewhere, this is just the spot you pick from. */
function PalmZone({ src }: { src: Source }) {
  const item = useMemo(() => pickable(src), [src]);
  return (
    <mesh position={[src.x, 5, src.z]} material={ZONE} userData={{ interact: item }}>
      <cylinderGeometry args={[1.6, 1.6, 10, 10]} />
    </mesh>
  );
}

function Plant({ src }: { src: Source }) {
  const have = useGameValue((s) => s.stock[src.id] ?? 0);
  const item = useMemo(() => pickable(src), [src]);
  const color = src.color ?? '#ffffff';
  return (
    <group position={[src.x, FOOTPATH_H, src.z]}>
      {src.kind === 'mango' && <Mango have={have} color={color} item={item} />}
      {src.kind === 'shrub' && <Shrub have={have} max={src.max} color={color} item={item} />}
      {src.kind === 'bed' && <Bed have={have} max={src.max} color={color} item={item} />}
    </group>
  );
}

function Mango({ have, color, item }: { have: number; color: string; item: Interactable }) {
  const fruit = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.5 }), [color]);
  return (
    <group>
      <mesh position={[0, 1.2, 0]} material={BARK} castShadow>
        <cylinderGeometry args={[0.11, 0.17, 2.4, 8]} />
      </mesh>
      <mesh position={[0, 3.0, 0]} material={LEAF} castShadow userData={{ interact: item }}>
        <icosahedronGeometry args={[1.35, 1]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => {
        const a = (i / 4) * Math.PI * 2 + 0.6;
        return (
          <mesh key={i} position={[Math.cos(a) * 1.05, 2.25 + rnd(i) * 0.3, Math.sin(a) * 1.05]} material={fruit} visible={i < have} castShadow>
            <sphereGeometry args={[0.13, 10, 8]} />
          </mesh>
        );
      })}
      <CollisionTrunk />
      {/* the picking zone around the whole tree */}
      <mesh position={[0, 2.1, 0]} material={ZONE} userData={{ interact: item }}>
        <cylinderGeometry args={[1.5, 1.5, 4.2, 10]} />
      </mesh>
    </group>
  );
}

/** A solid trunk you can't walk through (the tree itself is picked from a bit away). */
function CollisionTrunk() {
  return (
    <RigidBody type="fixed" colliders={false}>
      <CylinderCollider args={[1.2, 0.2]} position={[0, 1.2, 0]} />
    </RigidBody>
  );
}

function Shrub({ have, max, color, item }: { have: number; max: number; color: string; item: Interactable }) {
  const flower = flowerMat(color);
  return (
    <group>
      <mesh position={[0, 0.45, 0]} material={GREEN} castShadow>
        <icosahedronGeometry args={[0.6, 1]} />
      </mesh>
      {Array.from({ length: max }, (_, i) => (
        <mesh key={i} position={[(rnd(i * 2 + 1) - 0.5) * 0.9, 0.5 + rnd(i * 3 + 7) * 0.5, (rnd(i * 5 + 3) - 0.5) * 0.9]} material={flower} visible={i < have}>
          <sphereGeometry args={[0.085, 8, 6]} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.4, 0.5]} position={[0, 0.4, 0]} />
      </RigidBody>
      <mesh position={[0, 0.7, 0]} material={ZONE} userData={{ interact: item }}>
        <cylinderGeometry args={[0.9, 0.9, 1.4, 10]} />
      </mesh>
    </group>
  );
}

function Bed({ have, max, color, item }: { have: number; max: number; color: string; item: Interactable }) {
  const flower = flowerMat(color);
  const cols = 3;
  return (
    <group>
      <mesh position={[0, 0.05, 0]} material={SOIL} receiveShadow>
        <boxGeometry args={[1.7, 0.1, 1.0]} />
      </mesh>
      {Array.from({ length: max }, (_, i) => (
        <mesh key={i} position={[((i % cols) - 1) * 0.5, 0.16, (Math.floor(i / cols) - 0.5) * 0.45]} material={flower} visible={i < have}>
          <sphereGeometry args={[0.1, 8, 6]} />
        </mesh>
      ))}
      <mesh position={[0, 0.5, 0]} material={ZONE} userData={{ interact: item }}>
        <boxGeometry args={[1.9, 1.0, 1.2]} />
      </mesh>
    </group>
  );
}
