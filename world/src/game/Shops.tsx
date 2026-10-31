import * as THREE from 'three';
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { canvasTexture } from '../world/materials';
import { FOOTPATH_H } from '../world/Street';
import { world } from '../world/state';
import { game } from './store';
import { ITEMS, SHOPS, type Shop } from './catalog';

/*
 * The shop stalls along the footpath in front of Electrosparkzz: a counter with goods
 * on it, a striped awning, a sign, and a shopkeeper behind the counter who greets you
 * when you come near. Walk up and use the counter to go in.
 */

const Z = 1.6;
const DEPTH = 2.2;
const GREET_RANGE = 6;
const WOOD = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.8 });
const WALL = new THREE.MeshStandardMaterial({ color: '#f3e7d3', roughness: 0.9 });
const POST = new THREE.MeshStandardMaterial({ color: '#5a3d24', roughness: 0.9 });
const SKIN = new THREE.MeshStandardMaterial({ color: '#c68642', roughness: 0.7 });
const HAIR = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 });
const TROUSERS = new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.9 });
const GOODS = ['#f59e0b', '#22c55e', '#60a5fa', '#f472b6', '#facc15', '#ef4444'];

export function Shops() {
  return (
    <group>
      {SHOPS.map((s) => (
        <Stall key={s.id} shop={s} />
      ))}
    </group>
  );
}

function Stall({ shop }: { shop: Shop }) {
  const awning = useMemo(() => stripes(shop.awning), [shop.awning]);
  const sign = useMemo(() => signboard(shop), [shop]);
  const open = useMemo(
    () => ({
      get label() {
        return `${shop.emoji} Visit ${shop.name}`;
      },
      onUse: () => game.openShop(shop.id),
      reach: 4.5,
    }),
    [shop]
  );
  const w = shop.w;
  const goods = (shop.stock ?? (shop.mart ? ['coconut', 'mango', 'jasmine'] : shop.service ? ['first_aid', 'tonic'] : [])).map((id) => ITEMS[id]);

  return (
    <RigidBody type="fixed" colliders={false} position={[shop.x, FOOTPATH_H, Z]}>
      {/* back wall: a solid thing, so you can't walk through the stall */}
      <mesh position={[0, 1.15, -DEPTH / 2 + 0.06]} material={WALL} castShadow receiveShadow>
        <boxGeometry args={[w, 2.3, 0.12]} />
      </mesh>
      <CuboidCollider args={[w / 2, 1.15, 0.06]} position={[0, 1.15, -DEPTH / 2 + 0.06]} />

      {/* posts at the front corners */}
      {[-w / 2 + 0.07, w / 2 - 0.07].map((x) => (
        <mesh key={x} position={[x, 1.3, DEPTH / 2 - 0.1]} material={POST} castShadow>
          <boxGeometry args={[0.12, 2.6, 0.12]} />
        </mesh>
      ))}

      <Keeper x={shop.x} color={shop.awning[0]} greet={shop.greet} />

      {/* the counter: aim at it (or tap it) to visit the shop */}
      <mesh position={[0, 0.475, 0.45]} material={WOOD} castShadow receiveShadow userData={{ interact: open }}>
        <boxGeometry args={[w - 0.1, 0.95, 0.75]} />
      </mesh>
      <CuboidCollider args={[(w - 0.1) / 2, 0.475, 0.375]} position={[0, 0.475, 0.45]} />

      {/* goods on the counter */}
      {goods.slice(0, Math.max(3, Math.floor(w))).map((g, i, all) => (
        <mesh key={g.id} position={[(i - (all.length - 1) / 2) * (w / (all.length + 0.5)), 1.05, 0.45]} castShadow>
          <boxGeometry args={[0.32, 0.22, 0.32]} />
          <meshStandardMaterial color={GOODS[i % GOODS.length]} roughness={0.6} />
        </mesh>
      ))}

      {/* the whole front of the stall is the place to aim at (see-through, so the goods still show) */}
      <mesh position={[0, 1.3, DEPTH / 2 - 0.2]} userData={{ interact: open }}>
        <boxGeometry args={[w, 2.6, 0.3]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* awning and sign */}
      <mesh position={[0, 2.5, DEPTH / 2 - 0.45]} castShadow>
        <boxGeometry args={[w + 0.3, 0.08, 1.4]} />
        <meshStandardMaterial map={awning} roughness={0.9} />
      </mesh>
      <mesh position={[0, 2.85, DEPTH / 2 + 0.02]} userData={{ interact: open }}>
        <planeGeometry args={[Math.max(w - 0.3, 1.8), 0.5]} />
        <meshBasicMaterial map={sign} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
    </RigidBody>
  );
}

/**
 * The shopkeeper: a simple figure behind the counter. When you come near, a speech
 * bubble says the shop's greeting, and the arm waves.
 */
function Keeper({ x, color, greet }: { x: number; color: string; greet: string }) {
  const shirt = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }), [color]);
  const arm = useRef<THREE.Group>(null);
  const [near, setNear] = useState(false);
  const was = useRef(false);
  useFrame(({ clock }) => {
    const d = Math.hypot(world.player.x - x, world.player.z - Z);
    const now = d < GREET_RANGE;
    if (now !== was.current) {
      was.current = now;
      setNear(now);
    }
    if (arm.current) arm.current.rotation.x = now ? -2.4 + Math.sin(clock.elapsedTime * 5) * 0.35 : 0.1;
  });
  return (
    <group position={[0, 0, -0.45]}>
      {[-0.1, 0.1].map((lx) => (
        <mesh key={lx} position={[lx, 0.4, 0]} material={TROUSERS} castShadow>
          <boxGeometry args={[0.17, 0.8, 0.18]} />
        </mesh>
      ))}
      <mesh position={[0, 1.13, 0]} material={shirt} castShadow>
        <boxGeometry args={[0.5, 0.7, 0.28]} />
      </mesh>
      <mesh position={[-0.36, 1.1, 0]} material={shirt} castShadow>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
      </mesh>
      <group ref={arm} position={[0.36, 1.4, 0]}>
        <mesh position={[0, -0.3, 0]} material={shirt} castShadow>
          <boxGeometry args={[0.12, 0.6, 0.12]} />
        </mesh>
      </group>
      <mesh position={[0, 1.67, 0]} material={SKIN} castShadow>
        <sphereGeometry args={[0.16, 14, 10]} />
      </mesh>
      <mesh position={[0, 1.76, -0.02]} material={HAIR}>
        <sphereGeometry args={[0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Html position={[0, 2.25, 0.2]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
        {near && <div className="say">“{greet}”</div>}
      </Html>
    </group>
  );
}

/** Awning stripes in the shop's two colours. */
function stripes([a, b]: [string, string]) {
  return canvasTexture(128, 16, (g) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = i % 2 ? b : a;
      g.fillRect((i * 128) / n, 0, 128 / n, 16);
    }
  });
}

/** The shop's name and emoji on a painted board. */
function signboard(shop: Shop) {
  return canvasTexture(512, 128, (g) => {
    g.fillStyle = '#2b2238';
    g.fillRect(0, 0, 512, 128);
    g.fillStyle = shop.awning[0];
    g.fillRect(0, 112, 512, 16);
    g.fillStyle = '#fff7f1';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = '600 52px "Poppins", "Nunito", sans-serif';
    g.fillText(`${shop.emoji}  ${shop.name}`, 256, 62, 500);
  });
}
