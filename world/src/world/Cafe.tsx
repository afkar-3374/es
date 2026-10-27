import * as THREE from 'three';
import { Lamp, VirtualLight } from './Lamps';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox, Text } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { canvasTexture, usePBR } from './materials';
import { ui, type DrinkKind, type Interactable } from './interact';
import { seatInteract } from './seats';
import { applyFace, applyPose, instancePerson, SMILE, STANDING, usePersonSource } from './people';
import { Cup, DRINKS } from './Cups';
import { world } from './state';

const FONT = `${import.meta.env.BASE_URL}fonts/Poppins-SemiBold.ttf`;
const FLOOR = 4.8;

/*
 * The library café, by the front window on the left. A counter along the side wall
 * with Anu the barista behind it, an espresso machine and a chai kettle, a menu
 * board, and two little bistro tables at the glass.
 *   counter front x = −9.3, from z −4.0 to −1.1; Anu stands at x −10.6
 */
const COUNTER_X = -9.55;
const Z0 = -4.0;
const Z1 = -1.1;

export function Cafe() {
  return (
    <group>
      <Counter />
      <BackCounter />
      <MenuBoard />
      <Barista />
      <BistroTable x={-7.3} z={-1.5} />
      <BistroTable x={-6.9} z={-3.4} />
      <CafeLights />
    </group>
  );
}

let pending = false;
function order(kind: DrinkKind) {
  const s = ui.get();
  if (s.drink) {
    ui.toast('Finish the one in your hand first!');
    return;
  }
  if (pending) return;
  pending = true;
  const d = DRINKS[kind];
  ui.toast(`Anu is making your ${d.name.toLowerCase()}…`);
  baristaBusy.until = performance.now() + 2600;
  setTimeout(() => {
    pending = false;
    ui.takeDrink({ kind, name: d.name, emoji: d.emoji, sipsLeft: 4, from: 'cafe' });
    ui.showCard({
      emoji: d.emoji,
      title: `Here’s your ${d.name.toLowerCase()}!`,
      text: `${d.name}: ${d.blurb}. Take a sip with the ☕ button (or press Q). Find a cosy seat if you like.`,
    });
  }, 2600);
}

const menu: Interactable = {
  label: 'Order a drink from Anu',
  reach: 3.6,
  onUse: () =>
    ui.showCard({
      emoji: '☕',
      title: 'What would you like?',
      text: 'Anu smiles: “Everything is on the house today. Tea or coffee?”',
      actions: (Object.keys(DRINKS) as DrinkKind[]).map((k) => ({ label: `${DRINKS[k].emoji} ${DRINKS[k].name}`, run: () => order(k) })),
    }),
};

/** Shared with the barista so she can look busy while making your drink. */
const baristaBusy = { until: 0 };

function Counter() {
  const wood = usePBR('wood_floor', [1.2, 0.5], { tint: '#8a5d3b' });
  const front = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f6f73', roughness: 0.7 }), []);
  const top = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f2efe9', roughness: 0.25 }), []);
  const len = Z1 - Z0;
  const cz = (Z0 + Z1) / 2;
  return (
    <group userData={{ interact: menu }}>
      {/* counter body with vertical wood slats */}
      <mesh position={[COUNTER_X, FLOOR + 0.5, cz]} castShadow receiveShadow material={front}>
        <boxGeometry args={[0.6, 1.0, len]} />
      </mesh>
      {Array.from({ length: 14 }, (_, i) => (
        <mesh key={i} position={[COUNTER_X + 0.305, FLOOR + 0.5, Z0 + 0.12 + (i * (len - 0.24)) / 13]} material={wood}>
          <boxGeometry args={[0.02, 0.92, 0.09]} />
        </mesh>
      ))}
      <mesh position={[COUNTER_X - 0.02, FLOOR + 1.03, cz]} castShadow receiveShadow material={top}>
        <boxGeometry args={[0.72, 0.05, len + 0.1]} />
      </mesh>
      {/* glass jar of biscuits, a tip jar and a little sign on the counter */}
      <mesh position={[COUNTER_X + 0.1, FLOOR + 1.14, Z0 + 0.45]} castShadow>
        <cylinderGeometry args={[0.09, 0.09, 0.18, 20]} />
        <meshStandardMaterial color="#e6f0f5" transparent opacity={0.4} roughness={0.05} />
      </mesh>
      {[0, 1, 2, 3, 4].map((i) => (
        <mesh key={i} position={[COUNTER_X + 0.1 + Math.cos(i * 1.3) * 0.04, FLOOR + 1.07 + i * 0.025, Z0 + 0.45 + Math.sin(i * 1.3) * 0.04]} rotation-x={Math.PI / 2}>
          <cylinderGeometry args={[0.035, 0.035, 0.012, 16]} />
          <meshStandardMaterial color="#d9a35f" roughness={0.9} />
        </mesh>
      ))}
      <group position={[COUNTER_X + 0.15, FLOOR + 1.06, Z1 - 0.5]} rotation-y={Math.PI / 2}>
        <mesh position={[0, 0.09, 0]} rotation-x={-0.25} castShadow>
          <boxGeometry args={[0.3, 0.18, 0.01]} />
          <meshStandardMaterial color="#2b2238" roughness={0.6} />
        </mesh>
        <Text font={FONT} position={[0, 0.1, 0.012]} rotation-x={-0.25} fontSize={0.035} color="#ffd38f" anchorX="center" anchorY="middle">
          ORDER HERE
        </Text>
      </group>
      {/* a cup waiting on the counter while your drink is being made */}
      <PendingCup />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.36, 0.55, len / 2 + 0.05]} position={[COUNTER_X, FLOOR + 0.55, cz]} />
        {/* keep visitors out from behind the counter */}
        <CuboidCollider args={[1.1, 0.8, 0.05]} position={[-10.6, FLOOR + 0.8, Z0 - 0.05]} />
      </RigidBody>
    </group>
  );
}

function PendingCup() {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.visible = performance.now() < baristaBusy.until;
  });
  return (
    <group ref={group} position={[COUNTER_X + 0.15, FLOOR + 1.055, (Z0 + Z1) / 2]} visible={false} userData={{ keep: true }}>
      <Cup kind="coffee" level={1} />
    </group>
  );
}

/** Against the wall: espresso machine, chai kettle, cups and a grinder. */
function BackCounter() {
  const wood = usePBR('wood_floor', [1, 0.4], { tint: '#6b4a33' });
  const steel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfd3d8', roughness: 0.2, metalness: 1 }), []);
  const red = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b3302f', roughness: 0.35, metalness: 0.4 }), []);
  const black = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1d1d20', roughness: 0.4 }), []);
  const x = -11.35;
  return (
    <group>
      <mesh position={[x, FLOOR + 0.45, -2.55]} castShadow receiveShadow material={wood}>
        <boxGeometry args={[0.6, 0.9, 2.9]} />
      </mesh>
      <mesh position={[x, FLOOR + 0.92, -2.55]} castShadow material={black}>
        <boxGeometry args={[0.64, 0.04, 2.95]} />
      </mesh>
      {/* espresso machine */}
      <group position={[x + 0.02, FLOOR + 0.94, -3.2]}>
        <RoundedBox args={[0.45, 0.42, 0.62]} radius={0.04} smoothness={3} position={[0, 0.21, 0]} castShadow material={red} />
        <mesh position={[0, 0.43, 0]} material={steel}>
          <boxGeometry args={[0.46, 0.02, 0.63]} />
        </mesh>
        {[-0.14, 0.14].map((z) => (
          <group key={z} position={[0.24, 0.24, z]}>
            <mesh rotation-z={Math.PI / 2} material={steel}>
              <cylinderGeometry args={[0.035, 0.035, 0.06, 16]} />
            </mesh>
            <mesh position={[0.06, -0.02, 0]} rotation-z={Math.PI / 2 + 0.3} material={black}>
              <cylinderGeometry args={[0.012, 0.012, 0.14, 8]} />
            </mesh>
          </group>
        ))}
        {[0, 1, 2].map((i) => (
          <mesh key={i} position={[0, 0.47, -0.18 + i * 0.12]}>
            <cylinderGeometry args={[0.03, 0.025, 0.06, 14]} />
            <meshStandardMaterial color="#f4f1ea" roughness={0.3} />
          </mesh>
        ))}
      </group>
      {/* chai kettle on a little stove, and a grinder */}
      <group position={[x + 0.05, FLOOR + 0.94, -2.1]}>
        <mesh position={[0, 0.03, 0]} material={black}>
          <boxGeometry args={[0.3, 0.06, 0.3]} />
        </mesh>
        <mesh position={[0, 0.15, 0]} castShadow material={steel}>
          <cylinderGeometry args={[0.09, 0.11, 0.18, 22]} />
        </mesh>
        <mesh position={[0, 0.26, 0]} material={steel}>
          <sphereGeometry args={[0.09, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        </mesh>
        <mesh position={[0.12, 0.18, 0]} rotation-z={-0.9} material={steel}>
          <cylinderGeometry args={[0.01, 0.018, 0.13, 8]} />
        </mesh>
      </group>
      <group position={[x + 0.02, FLOOR + 0.94, -1.5]}>
        <mesh position={[0, 0.12, 0]} castShadow material={black}>
          <boxGeometry args={[0.16, 0.24, 0.16]} />
        </mesh>
        <mesh position={[0, 0.3, 0]} castShadow>
          <coneGeometry args={[0.08, 0.14, 18, 1, true]} />
          <meshStandardMaterial color="#e6f0f5" transparent opacity={0.45} side={THREE.DoubleSide} />
        </mesh>
      </group>
      {/* a shelf of glass tumblers above */}
      <mesh position={[-11.55, FLOOR + 1.75, -2.55]} castShadow material={wood}>
        <boxGeometry args={[0.28, 0.04, 2.6]} />
      </mesh>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-11.55, FLOOR + 1.81, -3.6 + i * 0.26]}>
          <cylinderGeometry args={[0.032, 0.026, 0.085, 14]} />
          <meshStandardMaterial color="#dfeaf0" transparent opacity={0.35} roughness={0.05} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.32, 0.5, 1.5]} position={[x, FLOOR + 0.5, -2.55]} />
      </RigidBody>
    </group>
  );
}

/** A chalkboard menu on the side wall. */
function MenuBoard() {
  const tex = useMemo(
    () =>
      canvasTexture(512, 384, (g) => {
        g.fillStyle = '#23302b';
        g.fillRect(0, 0, 512, 384);
        g.strokeStyle = '#c9a36b';
        g.lineWidth = 14;
        g.strokeRect(7, 7, 498, 370);
        g.fillStyle = '#ffffff';
        g.textAlign = 'center';
        g.font = '700 46px Poppins, Arial, sans-serif';
        g.fillText('Library Café', 256, 72);
        g.font = '600 20px Poppins, Arial, sans-serif';
        g.fillStyle = '#f6d7a7';
        g.fillText('~ everything on the house today ~', 256, 106);
        const items: [string, string][] = [
          ['Kerala chai', '🍵'],
          ['Filter coffee', '☕'],
          ['Cold coffee', '🧋'],
        ];
        g.textAlign = 'left';
        items.forEach(([name], i) => {
          g.fillStyle = '#ffffff';
          g.font = '600 34px Poppins, Arial, sans-serif';
          g.fillText(name, 64, 172 + i * 62);
          g.fillStyle = '#9fd3b9';
          g.textAlign = 'right';
          g.fillText('free', 450, 172 + i * 62);
          g.textAlign = 'left';
          g.strokeStyle = 'rgba(255,255,255,0.25)';
          g.lineWidth = 2;
          g.setLineDash([4, 6]);
          g.beginPath();
          g.moveTo(64, 186 + i * 62);
          g.lineTo(450, 186 + i * 62);
          g.stroke();
          g.setLineDash([]);
        });
        g.fillStyle = '#f6d7a7';
        g.font = '600 22px Poppins, Arial, sans-serif';
        g.textAlign = 'center';
        g.fillText('ask Anu at the counter ♥', 256, 356);
      }),
    []
  );
  return (
    <mesh position={[-11.68, FLOOR + 2.55, -2.55]} rotation-y={Math.PI / 2} userData={{ interact: menu }}>
      <planeGeometry args={[1.6, 1.2]} />
      <meshStandardMaterial map={tex} roughness={0.85} />
    </mesh>
  );
}

/** Anu, behind the counter: stands, breathes, looks at you and bustles when making a drink. */
function Barista() {
  const source = usePersonSource('barista');
  const { model, bones, base } = useMemo(() => {
    const { model, bones } = instancePerson(source, true);
    applyPose(model, bones, STANDING);
    applyFace(bones, SMILE);
    const base: Record<string, THREE.Euler> = {};
    for (const n of ['Bip01_Head', 'Bip01_Spine1', 'Bip01_L_Forearm', 'Bip01_R_Forearm']) base[n] = bones[n].rotation.clone();
    return { model, bones, base };
  }, [source]);
  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esBarista: bones });
  }, [bones]);

  const group = useRef<THREE.Group>(null);
  const look = useRef(0);
  const tmp = useMemo(() => new THREE.Vector3(), []);
  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const g = group.current;
    if (!g) return;
    bones.Bip01_Spine1.rotation.z = base.Bip01_Spine1.z + Math.sin(t * 1.5) * 0.012;
    g.worldToLocal(tmp.copy(world.player));
    const near = Math.hypot(tmp.x, tmp.z) < 6 && tmp.z > 0 && Math.abs(world.player.y - FLOOR) < 1.5;
    const busy = performance.now() < baristaBusy.until;
    const target = busy ? -0.9 : near ? THREE.MathUtils.clamp(Math.atan2(tmp.x, tmp.z), -0.9, 0.9) : Math.sin(t * 0.2) * 0.2;
    look.current += (target - look.current) * Math.min(dt * 3, 1);
    bones.Bip01_Head.rotation.x = base.Bip01_Head.x + look.current;
    // working hands while she makes a drink
    const w = busy ? 1 : 0;
    bones.Bip01_L_Forearm.rotation.z = base.Bip01_L_Forearm.z - w * 1.1 + Math.sin(t * 7) * 0.12 * w;
    bones.Bip01_R_Forearm.rotation.z = base.Bip01_R_Forearm.z - w * 1.1 + Math.sin(t * 7 + 2) * 0.12 * w;
  });

  return (
    <group ref={group} position={[-10.65, FLOOR, -2.55]} rotation-y={Math.PI / 2} userData={{ interact: menu }}>
      <primitive object={model} />
    </group>
  );
}

function BistroTable({ x, z }: { x: number; z: number }) {
  const top = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f1ec', roughness: 0.3 }), []);
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.4, metalness: 0.7 }), []);
  const seat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d9a441', roughness: 0.8 }), []);
  return (
    <group position={[x, FLOOR, z]}>
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow material={top}>
        <cylinderGeometry args={[0.34, 0.34, 0.03, 28]} />
      </mesh>
      <mesh position={[0, 0.37, 0]} material={metal}>
        <cylinderGeometry args={[0.025, 0.025, 0.72, 10]} />
      </mesh>
      <mesh position={[0, 0.015, 0]} material={metal}>
        <cylinderGeometry args={[0.2, 0.22, 0.03, 20]} />
      </mesh>
      {/* a small vase with a flower */}
      <mesh position={[0, 0.81, 0]}>
        <cylinderGeometry args={[0.025, 0.03, 0.11, 14]} />
        <meshStandardMaterial color="#9fd3e6" transparent opacity={0.6} roughness={0.1} />
      </mesh>
      <mesh position={[0, 0.92, 0]}>
        <sphereGeometry args={[0.03, 10, 8]} />
        <meshStandardMaterial color="#ff8fb8" roughness={0.6} />
      </mesh>
      {/* two chairs, either side along x; click to sit */}
      {[-1, 1].map((s) => {
        const cx = s * 0.6;
        return (
          <group
            key={s}
            position={[cx, 0, 0]}
            rotation-y={s * Math.PI / 2}
            userData={{ interact: seatInteract('Sit at the café table', new THREE.Vector3(x + cx, FLOOR + 0.48, z), s === -1 ? -Math.PI / 2 : Math.PI / 2, new THREE.Vector3(x + cx * 1.9, FLOOR, z)) }}
          >
            <mesh position={[0, 0.46, 0]} castShadow material={seat}>
              <cylinderGeometry args={[0.2, 0.2, 0.05, 22]} />
            </mesh>
            {[[-0.13, -0.13], [0.13, -0.13], [-0.13, 0.13], [0.13, 0.13]].map(([lx, lz]) => (
              <mesh key={`${lx}${lz}`} position={[lx, 0.22, lz]} material={metal}>
                <cylinderGeometry args={[0.012, 0.012, 0.44, 6]} />
              </mesh>
            ))}
            <mesh position={[0, 0.72, -0.18]} rotation-x={0.12} castShadow material={metal}>
              <torusGeometry args={[0.17, 0.012, 6, 18, Math.PI]} />
            </mesh>
          </group>
        );
      })}
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.4, 0.36]} position={[0, 0.4, 0]} />
        <CuboidCollider args={[0.22, 0.3, 0.22]} position={[-0.6, 0.3, 0]} />
        <CuboidCollider args={[0.22, 0.3, 0.22]} position={[0.6, 0.3, 0]} />
      </RigidBody>
    </group>
  );
}

/** Two warm pendant lights over the counter. */
function CafeLights() {
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f6f73', roughness: 0.4, metalness: 0.3, side: THREE.DoubleSide }), []);
  const bulb = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffcf8a', emissiveIntensity: 2.2, toneMapped: false }), []);
  const light = useRef<VirtualLight>(null);
  useFrame(() => {
    if (light.current) light.current.intensity = 3.5 + world.night * 3;
  });
  return (
    <group>
      {[-3.3, -1.8].map((z) => (
        <group key={z} position={[COUNTER_X - 0.1, 8.69, z]}>
          <mesh position={[0, -0.75, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 1.5, 4]} />
            <meshBasicMaterial color="#222" />
          </mesh>
          <mesh position={[0, -1.55, 0]} material={shade}>
            <sphereGeometry args={[0.16, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2]} />
          </mesh>
          <mesh position={[0, -1.57, 0]} material={bulb}>
            <sphereGeometry args={[0.045, 10, 8]} />
          </mesh>
        </group>
      ))}
      <Lamp ref={light} position={[COUNTER_X, FLOOR + 2.4, -2.55]} color="#ffd29a" distance={6} decay={1.6} />
    </group>
  );
}
