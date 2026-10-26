import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { canvasTexture, usePBR } from './materials';
import { ui, useUi, type Interactable } from './interact';
import { Cup, DRINKS } from './Cups';
import { seatInteract } from './seats';
import { world } from './state';

/*
 * The cosy corner by the library's front window: an armchair to sit in and watch the
 * street, a beanbag with a sleeping cat, an arc lamp, a cup of tea still steaming,
 * and rain running down the glass when it rains in Kasaragod.
 */
const ROOM_FLOOR = 4.8;
const DECK = 0.2; // a low raised nook by the floor-to-ceiling window
const FLOOR = ROOM_FLOOR + DECK;
const CHAIR = new THREE.Vector3(7.6, FLOOR, -1.75);
const PLATFORM = { x0: 4.4, x1: 10.6, z0: -4.2, z1: -0.75 };

export function ReadingCorner() {
  return (
    <group>
      <Platform />
      <CornerRug />
      <Armchair />
      <Beanbag />
      <SleepingCat />
      <SideTable />
      <ArcLamp />
      <BigPlant position={[10.0, FLOOR, -1.1]} />
      <WindowRain />
    </group>
  );
}

/** A warm wooden platform with a two-step front, like a raised reading nook. */
function Platform() {
  const deck = usePBR('wood_floor', [3, 2], { tint: '#b98457' });
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: '#5a3a24', roughness: 0.6 }), []);
  const w = PLATFORM.x1 - PLATFORM.x0;
  const d = PLATFORM.z1 - PLATFORM.z0;
  const cx = (PLATFORM.x0 + PLATFORM.x1) / 2;
  const cz = (PLATFORM.z0 + PLATFORM.z1) / 2;
  const stepW = w * 0.6;
  return (
    <group>
      <mesh position={[cx, ROOM_FLOOR + DECK / 2, cz]} castShadow receiveShadow material={deck}>
        <boxGeometry args={[w, DECK, d]} />
      </mesh>
      {/* edge trim */}
      <mesh position={[cx, ROOM_FLOOR + DECK - 0.02, PLATFORM.z0 - 0.01]} material={trim}>
        <boxGeometry args={[w, 0.05, 0.04]} />
      </mesh>
      <mesh position={[PLATFORM.x0 - 0.01, ROOM_FLOOR + DECK - 0.02, cz]} material={trim}>
        <boxGeometry args={[0.04, 0.05, d]} />
      </mesh>
      {/* one wide step up from the room */}
      <mesh position={[cx, ROOM_FLOOR + DECK / 4, PLATFORM.z0 - 0.18]} castShadow receiveShadow material={deck}>
        <boxGeometry args={[stepW, DECK / 2, 0.36]} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[w / 2, DECK / 2, d / 2]} position={[cx, ROOM_FLOOR + DECK / 2, cz]} />
        <CuboidCollider args={[stepW / 2, DECK / 4, 0.18]} position={[cx, ROOM_FLOOR + DECK / 4, PLATFORM.z0 - 0.18]} />
      </RigidBody>
    </group>
  );
}

function CornerRug() {
  const tex = useMemo(
    () =>
      canvasTexture(256, 256, (g) => {
        g.fillStyle = '#efe3cf';
        g.beginPath();
        g.arc(128, 128, 126, 0, Math.PI * 2);
        g.fill();
        for (let r = 118; r > 10; r -= 14) {
          g.strokeStyle = r % 28 === 6 ? '#c98c6b' : '#d9c3a5';
          g.lineWidth = 5;
          g.beginPath();
          g.arc(128, 128, r, 0, Math.PI * 2);
          g.stroke();
        }
      }),
    []
  );
  return (
    <mesh position={[7.0, FLOOR + 0.013, -2.4]} rotation-x={-Math.PI / 2} receiveShadow>
      <circleGeometry args={[1.9, 48]} />
      <meshStandardMaterial map={tex} roughness={1} transparent />
    </mesh>
  );
}

/** A deep armchair facing the window. Click it to sit and look out at the street. */
function Armchair() {
  const fabric = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f6f73', roughness: 0.95 }), []);
  const wood = usePBR('wood_floor', [0.3, 0.3], { tint: '#5a3a24' });
  // sit facing the window (π = towards +z, the street)
  const sit: Interactable = useMemo(
    () => seatInteract('Sit in the armchair', new THREE.Vector3(CHAIR.x, FLOOR + 0.45, CHAIR.z - 0.05), Math.PI, new THREE.Vector3(CHAIR.x - 0.9, FLOOR, CHAIR.z - 0.9), 0.67),
    []
  );
  return (
    <group position={CHAIR} userData={{ interact: sit }}>
      <RoundedBox args={[0.95, 0.22, 0.85]} radius={0.06} smoothness={3} position={[0, 0.38, 0.02]} castShadow receiveShadow material={fabric} />
      <RoundedBox args={[0.95, 0.75, 0.22]} radius={0.08} smoothness={3} position={[0, 0.8, -0.36]} rotation-x={-0.12} castShadow material={fabric} />
      {[-1, 1].map((s) => (
        <RoundedBox key={s} args={[0.18, 0.42, 0.85]} radius={0.07} smoothness={3} position={[s * 0.52, 0.52, 0.0]} castShadow material={fabric} />
      ))}
      <RoundedBox args={[1.2, 0.14, 0.88]} radius={0.04} smoothness={2} position={[0, 0.22, 0]} castShadow material={fabric} />
      {[[-0.5, -0.36], [0.5, -0.36], [-0.5, 0.36], [0.5, 0.36]].map(([x, z]) => (
        <mesh key={`${x}${z}`} position={[x, 0.07, z]} castShadow material={wood}>
          <cylinderGeometry args={[0.025, 0.018, 0.14, 8]} />
        </mesh>
      ))}
      {/* a soft throw cushion */}
      <RoundedBox args={[0.42, 0.34, 0.12]} radius={0.06} smoothness={3} position={[0.18, 0.68, -0.22]} rotation={[-0.3, 0.2, 0.1]} castShadow>
        <meshStandardMaterial color="#e8b04b" roughness={0.95} />
      </RoundedBox>
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.62, 0.5, 0.48]} position={[0, 0.5, 0]} />
      </RigidBody>
    </group>
  );
}

function Beanbag() {
  const geometry = useMemo(() => {
    const g = new THREE.SphereGeometry(0.55, 32, 20);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i);
      let y = p.getY(i);
      let z = p.getZ(i);
      y = y < 0 ? y * 0.35 : y * 0.62; // flat bottom, slumped top
      const dent = Math.exp(-((x + 0.05) ** 2 + (z - 0.05) ** 2) / 0.08) * 0.16; // where someone sat
      if (y > 0) y -= dent;
      x *= 1 + Math.sin(z * 9) * 0.015;
      z *= 1 + Math.sin(x * 7) * 0.015;
      p.setXYZ(i, x, y, z);
    }
    g.computeVertexNormals();
    return g;
  }, []);
  return (
    <group position={[5.5, FLOOR + 0.19, -1.8]}>
      <mesh geometry={geometry} castShadow receiveShadow>
        <meshStandardMaterial color="#d9a441" roughness={0.9} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.25, 0.55]} position={[0, 0.05, 0]} />
      </RigidBody>
    </group>
  );
}

/** A ginger tabby curled up asleep on the beanbag, breathing slowly. */
function SleepingCat() {
  const fur = useMemo(
    () =>
      canvasTexture(256, 128, (g) => {
        g.fillStyle = '#d98a3d';
        g.fillRect(0, 0, 256, 128);
        for (let x = 0; x < 256; x += 22) {
          g.fillStyle = 'rgba(140, 70, 20, 0.55)';
          g.beginPath();
          g.ellipse(x + 8, 64, 5, 60, 0.2, 0, Math.PI * 2);
          g.fill();
        }
        for (let i = 0; i < 900; i++) {
          g.fillStyle = `rgba(255,${200 + Math.random() * 40},150,0.12)`;
          g.fillRect(Math.random() * 256, Math.random() * 128, 1, 3);
        }
      }),
    []
  );
  const body = useRef<THREE.Mesh>(null);
  const furMat = useMemo(() => new THREE.MeshStandardMaterial({ map: fur, roughness: 0.95 }), [fur]);
  const purr: Interactable = useMemo(
    () => ({
      label: 'Pet the cat',
      reach: 2.8,
      onUse: () => ui.showCard({ emoji: '🐈', title: 'Purrr…', text: 'Mittu opens one eye, stretches a paw, and goes straight back to sleep. This is clearly the best seat in the library.' }),
    }),
    []
  );
  useFrame(({ clock }) => {
    if (body.current) body.current.scale.y = 0.12 * (1 + Math.sin(clock.elapsedTime * 1.4) * 0.035);
  });
  return (
    <group position={[5.5, FLOOR + 0.42, -1.8]} rotation-y={0.6} userData={{ interact: purr }}>
      {/* curled body */}
      <mesh ref={body} scale={[0.24, 0.12, 0.2]} castShadow material={furMat}>
        <sphereGeometry args={[1, 24, 16]} />
      </mesh>
      {/* head tucked in, with ears */}
      <group position={[0.17, 0.04, 0.1]} rotation-y={-0.5}>
        <mesh scale={[0.085, 0.075, 0.08]} castShadow material={furMat}>
          <sphereGeometry args={[1, 18, 12]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.0, 0.07, s * 0.045]} rotation-x={s * 0.35} castShadow material={furMat}>
            <coneGeometry args={[0.025, 0.05, 4]} />
          </mesh>
        ))}
        {/* closed eyes */}
        {[-1, 1].map((s) => (
          <mesh key={s} position={[0.075, 0.015, s * 0.028]} rotation-z={Math.PI / 2}>
            <boxGeometry args={[0.003, 0.018, 0.004]} />
            <meshBasicMaterial color="#3a2414" />
          </mesh>
        ))}
      </group>
      {/* tail wrapped round the front */}
      <mesh position={[0, -0.03, 0]} rotation-x={Math.PI / 2} castShadow material={furMat}>
        <torusGeometry args={[0.2, 0.032, 10, 24, Math.PI * 1.1]} />
      </mesh>
    </group>
  );
}

/** A little side table with a steaming cup of tea and two books. */
function SideTable() {
  const wood = usePBR('wood_floor', [0.4, 0.4], { tint: '#7a5236' });
  return (
    <group position={[8.75, FLOOR, -1.85]}>
      <mesh position={[0, 0.55, 0]} castShadow receiveShadow material={wood}>
        <cylinderGeometry args={[0.3, 0.3, 0.04, 32]} />
      </mesh>
      <mesh position={[0, 0.27, 0]} castShadow material={wood}>
        <cylinderGeometry args={[0.03, 0.04, 0.52, 10]} />
      </mesh>
      <mesh position={[0, 0.02, 0]} material={wood}>
        <cylinderGeometry args={[0.18, 0.2, 0.03, 20]} />
      </mesh>
      {/* a glass of chai you can pick up and drink */}
      <TableTea />
      {/* two books, one on the other */}
      <mesh position={[0.1, 0.59, -0.08]} rotation-y={0.3} castShadow>
        <boxGeometry args={[0.2, 0.035, 0.27]} />
        <meshStandardMaterial color="#23395b" roughness={0.7} />
      </mesh>
      <mesh position={[0.1, 0.625, -0.07]} rotation-y={-0.15} castShadow>
        <boxGeometry args={[0.18, 0.03, 0.24]} />
        <meshStandardMaterial color="#7a2e3a" roughness={0.7} />
      </mesh>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.3, 0.32]} position={[0, 0.3, 0]} />
      </RigidBody>
    </group>
  );
}

/** An arc floor lamp leaning over the armchair, with a warm glow. */
function ArcLamp() {
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b8922e', roughness: 0.3, metalness: 0.9 }), []);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f2e6d0', emissive: '#ffcf8a', emissiveIntensity: 0.6, roughness: 0.8, side: THREE.DoubleSide }), []);
  const light = useRef<THREE.PointLight>(null);
  const arc = useMemo(() => {
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.05, 0), new THREE.Vector3(0.05, 2.6, 0.2), new THREE.Vector3(-0.95, 2.05, 0.75));
    return new THREE.TubeGeometry(curve, 32, 0.018, 8, false);
  }, []);
  useFrame(() => {
    shade.emissiveIntensity = 0.5 + world.night * 1.2;
    if (light.current) light.current.intensity = 2.5 + world.night * 3.5;
  });
  return (
    <group position={[8.55, FLOOR, -2.5]}>
      <mesh position={[0, 0.03, 0]} castShadow material={brass}>
        <cylinderGeometry args={[0.2, 0.22, 0.05, 28]} />
      </mesh>
      <mesh geometry={arc} castShadow material={brass} />
      <mesh position={[-0.95, 1.98, 0.75]} material={shade} castShadow>
        <coneGeometry args={[0.22, 0.2, 28, 1, true]} />
      </mesh>
      <pointLight ref={light} position={[-0.95, 1.85, 0.75]} color="#ffcf8a" distance={5} decay={1.6} />
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.3, 0.2]} position={[0, 0.3, 0]} />
      </RigidBody>
    </group>
  );
}

/** A tall leafy plant in a woven basket. */
function BigPlant({ position }: { position: [number, number, number] }) {
  const leaves = useMemo(() => {
    const parts: THREE.BufferGeometry[] = [];
    for (let i = 0; i < 22; i++) {
      const leaf = new THREE.PlaneGeometry(0.22, 0.34, 1, 4);
      leaf.translate(0, 0.17, 0);
      leaf.rotateX(-0.6 - Math.random() * 0.5);
      leaf.rotateY(Math.random() * Math.PI * 2);
      leaf.translate(0, 0.5 + Math.random() * 1.1, 0);
      parts.push(leaf);
    }
    return parts;
  }, []);
  const leafMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2f6b35', roughness: 0.6, side: THREE.DoubleSide }), []);
  return (
    <group position={position}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.2, 0.44, 20]} />
        <meshStandardMaterial color="#b58a5a" roughness={1} />
      </mesh>
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.015, 0.02, 1.2, 6]} />
        <meshStandardMaterial color="#5b4a2f" />
      </mesh>
      {leaves.map((g, i) => (
        <mesh key={i} geometry={g} material={leafMat} castShadow />
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.5, 0.28]} position={[0, 0.5, 0]} />
      </RigidBody>
    </group>
  );
}

/* ── Rain running down the window glass ──────────────────────────── */

interface Drop {
  x: number;
  y: number;
  r: number;
  v: number;
}

function WindowRain() {
  const W = 1024;
  const H = 256;
  const { texture, ctx, drops } = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d')!;
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    const drops: Drop[] = Array.from({ length: 260 }, () => ({ x: Math.random() * W, y: Math.random() * H, r: 1 + Math.random() * 3, v: 0 }));
    return { texture, ctx, drops };
  }, []);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  const last = useRef(0);

  useFrame(({ clock }, dt) => {
    const rain = world.rain;
    if (mat.current) mat.current.opacity = Math.min(rain * 1.4, 0.9);
    if (rain <= 0.01) return;
    const t = clock.elapsedTime;
    if (t - last.current < 1 / 20) return; // 20 updates a second is plenty
    last.current = t;
    ctx.clearRect(0, 0, W, H);
    for (const d of drops) {
      // big drops slide down, small ones cling to the glass
      if (d.r > 2.2) d.v = Math.min(d.v + dt * 40 * rain, 60);
      d.y += d.v * (1 / 20);
      if (d.y > H + 6 || Math.random() < 0.002 * rain) {
        d.x = Math.random() * W;
        d.y = Math.random() * H * 0.4;
        d.r = 1 + Math.random() * 3;
        d.v = 0;
      }
      if (d.v > 5) {
        ctx.strokeStyle = 'rgba(220,232,245,0.25)';
        ctx.lineWidth = d.r * 0.6;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y - d.v * 0.6);
        ctx.lineTo(d.x, d.y);
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(230,240,250,0.55)';
      ctx.beginPath();
      ctx.ellipse(d.x, d.y, d.r * 0.8, d.r, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillRect(d.x - d.r * 0.3, d.y - d.r * 0.5, 1, 1);
    }
    texture.needsUpdate = true;
  });

  return (
    <mesh position={[0, 6.85, -0.36]} rotation-y={Math.PI}>
      <planeGeometry args={[22.4, 3.1]} />
      <meshBasicMaterial ref={mat} map={texture} transparent opacity={0} depthWrite={false} toneMapped={false} />
    </mesh>
  );
}

/** The chai on the side table: take it and it's in your hand; it comes back fresh when you finish. */
function TableTea() {
  const { drink } = useUi();
  const interact: Interactable = useMemo(
    () => ({
      label: 'Have the chai',
      reach: 3,
      onUse: () => {
        if (ui.get().drink) return ui.toast('You already have a drink in your hand.');
        ui.takeDrink({ kind: 'chai', name: DRINKS.chai.name, emoji: DRINKS.chai.emoji, sipsLeft: 4, from: 'corner' });
        ui.toast('A warm glass of Kerala chai. Press ☕ Sip (or Q) to drink.');
      },
    }),
    []
  );
  if (drink?.from === 'corner') return null;
  return (
    <group position={[-0.08, 0.57, 0.08]} userData={{ interact }}>
      <mesh position={[0, 0.005, 0]}>
        <cylinderGeometry args={[0.06, 0.055, 0.01, 24]} />
        <meshStandardMaterial color="#f4f1ea" roughness={0.25} />
      </mesh>
      <group position={[0, 0.01, 0]}>
        <Cup kind="chai" />
      </group>
    </group>
  );
}
