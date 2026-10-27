import * as THREE from 'three';
import { Lamp, VirtualLight } from './Lamps';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text, useTexture } from '@react-three/drei';
import { CuboidCollider, CylinderCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, usePBR } from './materials';
import { ui, type Interactable } from './interact';
import { world } from './state';
import { Receptionist } from './Receptionist';

const FONT = `${import.meta.env.BASE_URL}fonts/Poppins-SemiBold.ttf`;
const FLOOR = 0.3;
const CEIL = 4.5;

/*
 * Ground floor of the Electrosparkzz building.
 *   lobby      z  −0.3 … −5     full width, behind the glass front
 *   arcade     z  −5   … −15.9  corridor x −3.2 … 3.2, two shops each side
 *   back       z −15.9 … −19.7  kept clear for the stairs to the library
 */
const SHOP_DEPTH = 8.5; // along x
const CORRIDOR = 3.2; // half width
const SHOPS = [
  { unit: 'G-01', side: -1, z0: -5.0, z1: -10.45 },
  { unit: 'G-02', side: -1, z0: -10.45, z1: -15.9 },
  { unit: 'G-03', side: 1, z0: -5.0, z1: -10.45 },
  { unit: 'G-04', side: 1, z0: -10.45, z1: -15.9 },
] as const;

export function Interior() {
  return (
    <group>
      <Lobby />
      {SHOPS.map((s) => (
        <Shop key={s.unit} {...s} />
      ))}
      <LibrarySign />
      <ArcadeLights />
    </group>
  );
}

/* ── Lobby ─────────────────────────────────────────────────────── */

function Lobby() {
  const wood = usePBR('wood_floor', [2, 1], { tint: '#d9b48c' });
  const logo = useTexture(`${import.meta.env.BASE_URL}es-mark.png`);
  logo.colorSpace = THREE.SRGBColorSpace;
  const white = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f7f4ef', roughness: 0.35 }), []);
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2530', roughness: 0.4, metalness: 0.3 }), []);
  const board = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f1b26', roughness: 0.3, metalness: 0.2 }), []);
  const glow = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd8ec', emissiveIntensity: 1.4, toneMapped: false }), []);
  const screen = useMemo(() => new THREE.MeshStandardMaterial({ map: logo, color: '#ffffff', emissive: '#ffffff', emissiveMap: logo, emissiveIntensity: 0.8, roughness: 0.2 }), [logo]);

  return (
    <group>
      {/* Reception desk on the left of the entrance: a tall front counter with the logo,
          and a lower work surface behind it for Meera's computer */}
      <group position={[-6.5, FLOOR, -2.8]}>
        <mesh position={[0, 0.47, 0.25]} castShadow receiveShadow material={white}>
          <boxGeometry args={[3.2, 0.94, 0.3]} />
        </mesh>
        <mesh position={[0, 0.97, 0.22]} castShadow material={wood}>
          <boxGeometry args={[3.4, 0.06, 0.5]} />
        </mesh>
        <mesh position={[0, 0.52, 0.41]}>
          <planeGeometry args={[1.4, 0.65]} />
          <meshStandardMaterial map={logo} transparent roughness={0.4} />
        </mesh>
        <mesh position={[0, 0.06, 0.42]} material={glow}>
          <boxGeometry args={[3.0, 0.03, 0.02]} />
        </mesh>
        {/* work surface and its side panels */}
        <mesh position={[0, 0.74, -0.25]} castShadow receiveShadow material={white}>
          <boxGeometry args={[3.2, 0.04, 0.7]} />
        </mesh>
        {[-1.58, 1.58].map((x) => (
          <mesh key={x} position={[x, 0.37, -0.25]} castShadow material={white}>
            <boxGeometry args={[0.04, 0.74, 0.7]} />
          </mesh>
        ))}
        {/* monitor, keyboard, mouse and a little plant */}
        <group position={[-0.75, 0.76, -0.25]} rotation-y={0.35}>
          <mesh position={[0, 0.01, 0]} material={dark}>
            <boxGeometry args={[0.22, 0.02, 0.16]} />
          </mesh>
          <mesh position={[0, 0.14, 0.02]} material={dark}>
            <boxGeometry args={[0.04, 0.26, 0.03]} />
          </mesh>
          <mesh position={[0, 0.34, 0]} castShadow material={dark}>
            <boxGeometry args={[0.62, 0.38, 0.03]} />
          </mesh>
          <mesh position={[0, 0.34, -0.016]} rotation-y={Math.PI} material={screen}>
            <planeGeometry args={[0.58, 0.34]} />
          </mesh>
        </group>
        <mesh position={[-0.25, 0.77, -0.48]} castShadow material={dark}>
          <boxGeometry args={[0.45, 0.02, 0.15]} />
        </mesh>
        <mesh position={[0.15, 0.77, -0.47]} material={dark}>
          <boxGeometry args={[0.06, 0.02, 0.1]} />
        </mesh>
        <group position={[1.1, 0.76, -0.1]} scale={0.45}>
          <Plant position={[0, 0, 0]} />
        </group>
      </group>
      <Receptionist position={[-6.5, FLOOR + 0.06, -3.75]} />

      {/* Floor directory, facing the entrance */}
      <group position={[4.6, FLOOR, -4.2]}>
        <mesh position={[0, 1.25, 0]} castShadow material={board}>
          <boxGeometry args={[1.5, 2.5, 0.12]} />
        </mesh>
        <mesh position={[0, 2.37, 0.065]} material={glow}>
          <boxGeometry args={[1.3, 0.025, 0.01]} />
        </mesh>
        <Text font={FONT} position={[0, 2.15, 0.07]} fontSize={0.13} letterSpacing={0.12} color="#ffffff" anchorX="center">
          ELECTROSPARKZZ
        </Text>
        <Text font={FONT} position={[-0.6, 1.8, 0.07]} fontSize={0.1} color="#ff8fbd" anchorX="left">
          FIRST FLOOR
        </Text>
        <Text font={FONT} position={[-0.6, 1.62, 0.07]} fontSize={0.09} color="#ffffff" anchorX="left" maxWidth={1.2}>
          Library & café · stairs at the back
        </Text>
        <Text font={FONT} position={[-0.6, 1.28, 0.07]} fontSize={0.1} color="#ff8fbd" anchorX="left">
          GROUND FLOOR
        </Text>
        {['G-01  ·  Coming soon', 'G-02  ·  Coming soon', 'G-03  ·  Coming soon', 'G-04  ·  Coming soon'].map((t, i) => (
          <Text key={t} font={FONT} position={[-0.6, 1.1 - i * 0.16, 0.07]} fontSize={0.085} color="#e9e4ef" anchorX="left">
            {t}
          </Text>
        ))}
        <Text font={FONT} position={[-0.6, 0.38, 0.07]} fontSize={0.075} color="#b9b0c4" anchorX="left">
          You are here
        </Text>
      </group>

      {/* Benches and plants */}
      {[[7.8, -1.6, 0], [-9.6, -4.4, Math.PI / 2]].map(([x, z, r], i) => (
        <Bench key={i} position={[x, FLOOR, z]} rotation={r} wood={wood} frame={dark} />
      ))}
      {[[-11, -0.9], [11, -0.9], [-3.6, -4.6], [3.6, -4.6], [10.9, -4.6]].map(([x, z]) => (
        <Plant key={`${x}${z}`} position={[x, FLOOR, z]} />
      ))}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[1.7, 0.6, 0.55]} position={[-6.5, FLOOR + 0.6, -2.85]} />
        <CuboidCollider args={[0.75, 1.25, 0.1]} position={[4.6, FLOOR + 1.25, -4.2]} />
      </RigidBody>
    </group>
  );
}

function Bench({ position, rotation, wood, frame }: { position: [number, number, number]; rotation: number; wood: THREE.Material; frame: THREE.Material }) {
  return (
    <group position={position} rotation-y={rotation}>
      <mesh position={[0, 0.45, 0]} castShadow receiveShadow material={wood}>
        <boxGeometry args={[1.8, 0.06, 0.45]} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.22, 0]} castShadow material={frame}>
          <boxGeometry args={[0.06, 0.44, 0.4]} />
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.9, 0.24, 0.24]} position={[0, 0.24, 0]} />
      </RigidBody>
    </group>
  );
}

/** Broad, glossy indoor-plant leaves (drawn once, shared by every plant). */
let leafMaterial: THREE.MeshStandardMaterial | null = null;
function getLeafMaterial() {
  if (!leafMaterial) {
    const map = canvasTexture(128, 256, (g) => {
      g.clearRect(0, 0, 128, 256);
      const grad = g.createLinearGradient(0, 0, 128, 0);
      grad.addColorStop(0, '#2f6b2f');
      grad.addColorStop(0.5, '#4d9a44');
      grad.addColorStop(1, '#2f6b2f');
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(64, 250);
      g.bezierCurveTo(-6, 190, 6, 40, 64, 4);
      g.bezierCurveTo(122, 40, 134, 190, 64, 250);
      g.fill();
      g.strokeStyle = 'rgba(210, 235, 170, 0.75)';
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(64, 250);
      g.lineTo(64, 10);
      g.stroke();
      g.lineWidth = 1.4;
      for (let y = 40; y < 235; y += 18) {
        g.beginPath();
        g.moveTo(64, y + 12);
        g.quadraticCurveTo(40, y + 4, 22, y - 8);
        g.moveTo(64, y + 12);
        g.quadraticCurveTo(88, y + 4, 106, y - 8);
        g.stroke();
      }
    });
    leafMaterial = new THREE.MeshStandardMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.45 });
  }
  return leafMaterial;
}

/** One leaf on its stalk, arching outwards and drooping at the tip. */
function leafGeometry(length: number) {
  const g = new THREE.PlaneGeometry(length * 0.5, length, 2, 8);
  g.translate(0, length / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / length;
    p.setZ(i, -t * t * length * 0.55 + Math.abs(p.getX(i)) * 0.35); // droop, slight V fold
  }
  g.computeVertexNormals();
  return g;
}

/** A potted indoor plant: a glazed pot with a fan of broad leaves on stalks. */
function Plant({ position }: { position: [number, number, number] }) {
  const { leaves, stems } = useMemo(() => {
    const leafParts: THREE.BufferGeometry[] = [];
    const stemParts: THREE.BufferGeometry[] = [];
    const count = 13;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + Math.random() * 0.4;
      const tilt = 0.35 + Math.random() * 0.55;
      const stemLen = 0.35 + Math.random() * 0.45;
      const stem = new THREE.CylinderGeometry(0.008, 0.012, stemLen, 5);
      stem.translate(0, stemLen / 2, 0);
      stem.rotateX(tilt * 0.6);
      stem.rotateY(a);
      stemParts.push(stem);
      const leaf = leafGeometry(0.42 + Math.random() * 0.2);
      leaf.rotateX(tilt);
      leaf.translate(0, 0, 0);
      const tip = new THREE.Vector3(0, stemLen, 0).applyAxisAngle(new THREE.Vector3(1, 0, 0), tilt * 0.6);
      leaf.translate(0, tip.y, tip.z);
      leaf.rotateY(a);
      leafParts.push(leaf);
    }
    return { leaves: mergeGeometries(leafParts)!, stems: mergeGeometries(stemParts)! };
  }, []);
  return (
    <group position={position}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.28, 0.22, 0.6, 24]} />
        <meshStandardMaterial color="#ebe5da" roughness={0.18} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <cylinderGeometry args={[0.26, 0.26, 0.02, 24]} />
        <meshStandardMaterial color="#4a3426" roughness={1} />
      </mesh>
      <group position={[0, 0.58, 0]}>
        <mesh geometry={stems} castShadow>
          <meshStandardMaterial color="#5b7f3a" roughness={0.7} />
        </mesh>
        <mesh geometry={leaves} material={getLeafMaterial()} castShadow />
      </group>
      <RigidBody type="fixed" colliders={false}>
        <CylinderCollider args={[0.6, 0.3]} position={[0, 0.6, 0]} />
      </RigidBody>
    </group>
  );
}

/* ── Shops ─────────────────────────────────────────────────────── */

/** The vinyl "coming soon" banner tied onto each shutter. */
function bannerTexture(variant: number) {
  const palettes = [
    ['#f97316', '#ec4899'],
    ['#ec4899', '#8b5cf6'],
    ['#0ea5e9', '#8b5cf6'],
    ['#f59e0b', '#ef4444'],
  ];
  const [a, b] = palettes[variant % palettes.length];
  return canvasTexture(1024, 448, (g) => {
    const grad = g.createLinearGradient(0, 0, 1024, 448);
    grad.addColorStop(0, a);
    grad.addColorStop(1, b);
    g.fillStyle = grad;
    g.fillRect(0, 0, 1024, 448);
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 10;
    g.strokeRect(22, 22, 980, 404);
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.font = '800 128px Poppins, "Arial Black", sans-serif';
    g.fillText('COMING', 512, 190);
    g.fillText('SOON', 512, 320);
    g.font = '600 40px Poppins, Arial, sans-serif';
    g.fillText('✦  something new is opening here  ✦', 512, 395);
  });
}

function Shop({ unit, side, z0, z1 }: { unit: string; side: -1 | 1; z0: number; z1: number }) {
  const plaster = usePBR('painted_plaster_wall', [3, 1.5], { tint: '#f7f3ee', normalScale: 0.35 });
  const shutterTex = usePBR('painted_metal_shutter', [2.2, 1.6], { tint: '#c9ced4' });
  const metal = useMemo(() => new THREE.MeshStandardMaterial({ color: '#8d939a', roughness: 0.35, metalness: 0.8 }), []);
  const fascia = useMemo(() => new THREE.MeshStandardMaterial({ color: '#25212e', roughness: 0.35, metalness: 0.5 }), []);
  const strip = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffe1f0', emissiveIntensity: 1.6, toneMapped: false }), []);
  const index = Number(unit.slice(-1));
  const banner = useMemo(() => bannerTexture(index), [index]);
  const lock = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.3, metalness: 0.9 }), []);

  const width = Math.abs(z1 - z0);
  const cz = (z0 + z1) / 2;
  const frontX = side * CORRIDOR; // shop front line, facing the corridor
  const cx = side * (CORRIDOR + SHOP_DEPTH / 2);
  const face = -side; // the shop front faces towards the corridor centre
  const shutterW = width - 0.9;
  const shutterH = 3.0;

  // Rattle the shutter a little when someone knocks
  const shutter = useRef<THREE.Group>(null);
  const knock = useRef(0);
  useFrame((_, dt) => {
    if (!shutter.current) return;
    knock.current = Math.max(knock.current - dt * 2.5, 0);
    shutter.current.position.x = frontX + face * 0.04 + Math.sin(knock.current * 60) * 0.012 * knock.current;
  });

  const interact: Interactable = useMemo(
    () => ({
      label: `Shop ${unit} · coming soon`,
      reach: 4.5,
      onUse: () => {
        knock.current = 1;
        ui.showCard({
          emoji: '🛍️',
          title: `Shop ${unit} · Coming soon`,
          text: 'The shutter is down for now. Something new is getting ready to open here at Electrosparkzz, so do come back and peek again.',
        });
      },
    }),
    [unit]
  );

  return (
    <group>
      {/* the shop's walls (its inside stays hidden behind the shutter) */}
      <mesh position={[cx, FLOOR + (CEIL - FLOOR) / 2, cz]} castShadow receiveShadow material={plaster}>
        <boxGeometry args={[SHOP_DEPTH, CEIL - FLOOR, width - 0.02]} />
      </mesh>
      {/* pilasters either side of the shutter */}
      {[z0 - side * 0, z1].map((z, i) => (
        <mesh key={i} position={[frontX + face * 0.08, FLOOR + (CEIL - FLOOR) / 2, z + (i === 0 ? -0.2 : 0.2) * Math.sign(z1 - z0)]} castShadow material={plaster}>
          <boxGeometry args={[0.2, CEIL - FLOOR, 0.4]} />
        </mesh>
      ))}

      {/* the rolling shutter, its box and guide rails */}
      <group ref={shutter} position={[frontX + face * 0.04, 0, 0]} userData={{ interact }}>
        <mesh position={[0, FLOOR + shutterH / 2, cz]} rotation-y={face * Math.PI / 2} receiveShadow material={shutterTex}>
          <planeGeometry args={[shutterW, shutterH]} />
        </mesh>
        <mesh position={[face * 0.012, FLOOR + 1.7, cz]} rotation-y={face * Math.PI / 2}>
          <planeGeometry args={[Math.min(shutterW - 0.6, 3.2), 1.4]} />
          <meshStandardMaterial map={banner} roughness={0.6} />
        </mesh>
        {/* padlock on the bottom rail */}
        <mesh position={[face * 0.03, FLOOR + 0.12, cz + 0.6]} material={lock}>
          <boxGeometry args={[0.04, 0.11, 0.09]} />
        </mesh>
        <mesh position={[0, FLOOR + 0.05, cz]} material={metal}>
          <boxGeometry args={[0.06, 0.08, shutterW]} />
        </mesh>
      </group>
      <mesh position={[frontX + face * 0.14, FLOOR + shutterH + 0.2, cz]} castShadow material={metal}>
        <boxGeometry args={[0.32, 0.4, shutterW + 0.3]} />
      </mesh>
      {[cz - shutterW / 2 - 0.05, cz + shutterW / 2 + 0.05].map((z) => (
        <mesh key={z} position={[frontX + face * 0.05, FLOOR + shutterH / 2, z]} material={metal}>
          <boxGeometry args={[0.1, shutterH, 0.08]} />
        </mesh>
      ))}

      {/* fascia with only the unit number and a light strip */}
      <mesh position={[frontX + face * 0.08, CEIL - 0.45, cz]} material={fascia}>
        <boxGeometry args={[0.12, 0.7, width - 0.1]} />
      </mesh>
      <mesh position={[frontX + face * 0.15, CEIL - 0.79, cz]} material={strip}>
        <boxGeometry args={[0.02, 0.025, width - 0.4]} />
      </mesh>
      <Text font={FONT} position={[frontX + face * 0.15, CEIL - 0.45, cz]} rotation-y={face * Math.PI / 2} fontSize={0.26} letterSpacing={0.12} color="#ffffff" anchorX="center" anchorY="middle">
        {unit}
      </Text>

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[SHOP_DEPTH / 2, (CEIL - FLOOR) / 2, width / 2]} position={[cx, FLOOR + (CEIL - FLOOR) / 2, cz]} />
      </RigidBody>
    </group>
  );
}

/* ── Sign pointing to the library stairs ──────────────────────── */

function LibrarySign() {
  const board = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2238', roughness: 0.35, metalness: 0.3 }), []);
  const rod = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9aa0a6', roughness: 0.3, metalness: 0.9 }), []);
  return (
    <group position={[0, CEIL, -7.2]}>
      {[-0.6, 0.6].map((x) => (
        <mesh key={x} position={[x, -0.3, 0]} material={rod}>
          <cylinderGeometry args={[0.01, 0.01, 0.6, 6]} />
        </mesh>
      ))}
      <mesh position={[0, -0.78, 0]} castShadow material={board}>
        <boxGeometry args={[1.9, 0.42, 0.05]} />
      </mesh>
      {[1, -1].map((f) => (
        <group key={f} rotation-y={f === 1 ? 0 : Math.PI}>
          <Text font={FONT} position={[0, -0.72, 0.03]} fontSize={0.13} letterSpacing={0.14} color="#ffd38f" anchorX="center" anchorY="middle">
            LIBRARY · FIRST FLOOR
          </Text>
          <Text font={FONT} position={[0, -0.88, 0.03]} fontSize={0.075} color="#e9e4ef" anchorX="center" anchorY="middle">
            stairs at the back of the arcade
          </Text>
        </group>
      ))}
    </group>
  );
}

/* ── Lights along the arcade ──────────────────────────────────── */

function ArcadeLights() {
  const panel = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff3e2', emissiveIntensity: 1.3 }), []);
  const lights = useRef<(VirtualLight | null)[]>([]);
  useFrame(() => {
    lights.current.forEach((l) => l && (l.intensity = 7 + world.night * 4));
  });
  return (
    <group>
      {[-7].map((z) => (
        <mesh key={z} position={[0, CEIL - 0.03, z]} rotation-x={Math.PI / 2} material={panel}>
          <planeGeometry args={[2.4, 0.5]} />
        </mesh>
      ))}
      {[[0, -7.5], [0, -16]].map(([x, z], i) => (
        <Lamp key={i} ref={(l) => (lights.current[i] = l)} position={[x, CEIL - 0.6, z]} color="#fff0dc" distance={14} decay={1.4} />
      ))}
      {[[-2.2, -15.5], [2.2, -15.5]].map(([x, z]) => (
        <mesh key={x} position={[x, CEIL - 0.03, z]} rotation-x={Math.PI / 2} material={panel}>
          <planeGeometry args={[0.8, 2.4]} />
        </mesh>
      ))}
    </group>
  );
}
