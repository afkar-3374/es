import * as THREE from 'three';
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { world } from '../world/state';
import { ui, type Interactable } from '../world/interact';
import { FOOTPATH_H } from '../world/Street';
import { game } from './store';
import { sfx } from './sfx';
import { BOTS, botPose, markTipped, tippedToday, type Bot } from './bots';

const SKIN = new THREE.MeshStandardMaterial({ color: '#b87333', roughness: 0.7 });
const HAIR = new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.9 });
const TROUSERS = new THREE.MeshStandardMaterial({ color: '#3b3f48', roughness: 0.9 });
const TIP = 5;
const TALK_RANGE = 14;

/** The town's bots, walking the north footpath. */
export function Bots() {
  return (
    <group>
      {BOTS.map((b) => (
        <Bot key={b.id} bot={b} />
      ))}
    </group>
  );
}

function Bot({ bot }: { bot: Bot }) {
  const group = useRef<THREE.Group>(null);
  const legL = useRef<THREE.Mesh>(null);
  const legR = useRef<THREE.Mesh>(null);
  const [near, setNear] = useState(false);
  const [say, setSay] = useState<string | null>(null);
  const near0 = useRef(false);
  const shirt = useMemo(() => new THREE.MeshStandardMaterial({ color: bot.shirt, roughness: 0.8 }), [bot.shirt]);
  const talk = useRef<number>(0);

  const hi = useMemo<Interactable>(
    () => ({
      get label() {
        return tippedToday(bot.id) ? `👋 Say hi to ${bot.name} (bot)` : `👋 Say hi to ${bot.name} · tip ${TIP} pts`;
      },
      onUse: () => {
        setSay(bot.greet);
        talk.current = performance.now();
        if (!tippedToday(bot.id)) {
          markTipped(bot.id);
          game.addPoints(TIP);
          sfx.buy();
          ui.toast(`${bot.name} gave you a tip: +${TIP} points 🪙`);
        }
      },
      reach: 4.5,
    }),
    [bot]
  );

  useFrame(() => {
    const pose = botPose(bot);
    const g = group.current;
    if (!g) return;
    g.position.set(pose.x, FOOTPATH_H, pose.z);
    g.rotation.y = pose.dir > 0 ? Math.PI / 2 : -Math.PI / 2;
    // legs swing as it walks
    const swing = Math.sin(pose.step * Math.PI * 2) * 0.45;
    if (legL.current) legL.current.rotation.x = swing;
    if (legR.current) legR.current.rotation.x = -swing;
    const d = Math.hypot(world.player.x - pose.x, world.player.z - pose.z);
    const now = d < TALK_RANGE;
    if (now !== near0.current) {
      near0.current = now;
      setNear(now);
    }
    if (say && performance.now() - talk.current > 4500) setSay(null);
  });

  return (
    <group ref={group}>
      <mesh ref={legL} position={[-0.1, 0.4, 0]} material={TROUSERS} castShadow>
        <boxGeometry args={[0.17, 0.8, 0.18]} />
      </mesh>
      <mesh ref={legR} position={[0.1, 0.4, 0]} material={TROUSERS} castShadow>
        <boxGeometry args={[0.17, 0.8, 0.18]} />
      </mesh>
      <mesh position={[0, 1.13, 0]} material={shirt} castShadow userData={{ interact: hi }}>
        <boxGeometry args={[0.5, 0.7, 0.28]} />
      </mesh>
      <mesh position={[-0.36, 1.1, 0]} material={shirt} castShadow>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
      </mesh>
      <mesh position={[0.36, 1.1, 0]} material={shirt} castShadow>
        <boxGeometry args={[0.12, 0.6, 0.12]} />
      </mesh>
      <mesh position={[0, 1.67, 0]} material={SKIN} castShadow userData={{ interact: hi }}>
        <sphereGeometry args={[0.16, 14, 10]} />
      </mesh>
      <mesh position={[0, 1.76, -0.02]} material={HAIR}>
        <sphereGeometry args={[0.17, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
      </mesh>
      <Html position={[0, 2.2, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
        {say ? <div className="say bot-say">“{say}”</div> : near ? <div className="bot-tag">{bot.name} · bot</div> : null}
      </Html>
    </group>
  );
}
