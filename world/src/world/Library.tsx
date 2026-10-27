import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { canvasTexture, glassMaterial, usePBR } from './materials';
import { ui, type Book, type Interactable } from './interact';
import { BUILDING, world } from './state';
import { STAIRWELL } from './Building';
import { seatInteract } from './seats';

const FONT = `${import.meta.env.BASE_URL}fonts/Poppins-SemiBold.ttf`;
const FLOOR = 4.8;
const CEIL = 8.69;
const INNER = { x0: BUILDING.minX + 0.3, x1: BUILDING.maxX - 0.3, z0: BUILDING.minZ + 0.3, z1: BUILDING.maxZ - 0.3 };

/** The four books in the one unlocked cupboard. */
export const BOOKS: Book[] = [
  { id: 'electrosparkzz', title: 'Electrosparkzz', subtitle: 'We’re building something lovely', url: '/book.html', colors: ['#ffc9de', '#d9c9ff'], emoji: '✨' },
  { id: 'triply', title: 'Triply', subtitle: 'Discover More. Travel Smarter.', url: '/triply.html', colors: ['#bfe6ff', '#c9f2e2'], emoji: '✈️' },
  { id: 'herai', title: 'HERAI', subtitle: 'Intelligence Designed Around Her.', url: '/herai.html', colors: ['#ecd2ff', '#ffd0e5'], emoji: '🌸' },
  { id: 'glazy', title: 'Glazy', subtitle: 'A private little world for two', url: '/glazy.html', colors: ['#ffcade', '#ffe1cc'], emoji: '💗' },
];

// Cupboards along both side walls; the one at the spotlight is open
const CUPBOARD_Z = [-3.0, -5.4, -7.8, -10.2, -12.6, -15.0, -17.4];
const FEATURED = { side: -1, z: -7.8 };

export function Library() {
  return (
    <group>
      <Room />
      {CUPBOARD_Z.flatMap((z) =>
        [-1, 1].map((side) => {
          const featured = side === FEATURED.side && z === FEATURED.z;
          if (side === -1 && z > -4) return null; // the café counter stands here
          return <Cupboard key={`${side}${z}`} side={side as -1 | 1} z={z} featured={featured} seed={Math.round(z * 10) * side} />;
        })
      )}
      <ReadingTable />
      <Pendants />
    </group>
  );
}

/* ── The room ──────────────────────────────────────────────────── */

function Room() {
  const floor = usePBR('wood_floor', [6, 5], { tint: '#e2c39e' });
  const paint = usePBR('painted_plaster_wall', [6, 1.5], { tint: '#f3e7d8', normalScale: 0.3 });
  const ceiling = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f7f3ec', roughness: 0.95 }), []);
  const skirting = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b4a33', roughness: 0.6 }), []);
  const rug = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        roughness: 1,
        map: canvasTexture(256, 160, (g) => {
          g.fillStyle = '#8c3b4a';
          g.fillRect(0, 0, 256, 160);
          g.strokeStyle = '#e7c9a0';
          g.lineWidth = 6;
          g.strokeRect(12, 12, 232, 136);
          g.lineWidth = 2;
          g.strokeRect(24, 24, 208, 112);
          g.fillStyle = '#e7c9a0';
          for (let i = 0; i < 5; i++) {
            g.beginPath();
            g.arc(48 + i * 40, 80, 9, 0, Math.PI * 2);
            g.fill();
          }
        }),
      }),
    []
  );

  // floor boards around the stairwell
  const parts: [number, number, number, number][] = [
    [INNER.x0, STAIRWELL.x0, INNER.z0, INNER.z1],
    [STAIRWELL.x1, INNER.x1, INNER.z0, INNER.z1],
    [STAIRWELL.x0, STAIRWELL.x1, STAIRWELL.z1, INNER.z1],
    [STAIRWELL.x0, STAIRWELL.x1, INNER.z0, STAIRWELL.z0],
  ];
  const H = CEIL - FLOOR;

  return (
    <group>
      {parts.map(([x0, x1, z0, z1], i) => (
        <mesh key={i} position={[(x0 + x1) / 2, FLOOR + 0.005, (z0 + z1) / 2]} rotation-x={-Math.PI / 2} receiveShadow material={floor}>
          <planeGeometry args={[x1 - x0, z1 - z0]} />
        </mesh>
      ))}
      <mesh position={[0, CEIL, -10]} rotation-x={Math.PI / 2} material={ceiling}>
        <planeGeometry args={[INNER.x1 - INNER.x0, INNER.z1 - INNER.z0]} />
      </mesh>

      {/* warm painted walls with a wooden skirting */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[s * (INNER.x1 - 0.005), FLOOR + H / 2, -10]} rotation-y={-s * Math.PI / 2} material={paint} receiveShadow>
            <planeGeometry args={[INNER.z1 - INNER.z0, H]} />
          </mesh>
          <mesh position={[s * (INNER.x1 - 0.02), FLOOR + 0.06, -10]} material={skirting}>
            <boxGeometry args={[0.03, 0.12, INNER.z1 - INNER.z0]} />
          </mesh>
        </group>
      ))}
      <mesh position={[0, FLOOR + H / 2, INNER.z0 + 0.005]} material={paint} receiveShadow>
        <planeGeometry args={[INNER.x1 - INNER.x0, H]} />
      </mesh>
      {/* front: wall below and above the window band (the street shows through the glass) */}
      <mesh position={[0, FLOOR + 0.25, INNER.z1 - 0.06]} rotation-y={Math.PI} material={paint}>
        <planeGeometry args={[INNER.x1 - INNER.x0, 0.5]} />
      </mesh>
      <mesh position={[0, (8.4 + CEIL) / 2, INNER.z1 - 0.06]} rotation-y={Math.PI} material={paint}>
        <planeGeometry args={[INNER.x1 - INNER.x0, CEIL - 8.4]} />
      </mesh>
      {/* a low wooden window ledge */}
      <mesh position={[0, FLOOR + 0.52, INNER.z1 - 0.2]} castShadow receiveShadow material={skirting}>
        <boxGeometry args={[INNER.x1 - INNER.x0, 0.05, 0.32]} />
      </mesh>

      <mesh position={[0, FLOOR + 0.012, -5.6]} rotation-x={-Math.PI / 2} material={rug} receiveShadow>
        <planeGeometry args={[4.2, 2.6]} />
      </mesh>

      <RigidBody type="fixed" colliders={false}>
        {/* keep visitors off the window glass */}
        <CuboidCollider args={[(INNER.x1 - INNER.x0) / 2, 0.8, 0.25]} position={[0, FLOOR + 0.8, INNER.z1 - 0.2]} />
      </RigidBody>
    </group>
  );
}

/* ── Cupboards ─────────────────────────────────────────────────── */

const CW = 2.0; // width
const CH = 2.5; // height
const CD = 0.5; // depth
const SHELVES = [0.12, 0.6, 1.08, 1.56, 2.04];
const SPINE_COLORS = ['#7a2e3a', '#23395b', '#2f5233', '#b5862c', '#e8dcc4', '#1f1f24', '#6b3f69', '#a2462d', '#3f6f7a', '#c9b79c'];

function rng(seed: number) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function Cupboard({ side, z, featured, seed }: { side: -1 | 1; z: number; featured: boolean; seed: number }) {
  const wood = usePBR('wood_floor', [1, 1.2], { tint: '#7a5236' });
  const glass = useMemo(glassMaterial, []);
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9a227', roughness: 0.25, metalness: 0.95 }), []);
  const back = useMemo(() => new THREE.MeshStandardMaterial({ color: '#4a3324', roughness: 0.8 }), []);

  const x = side * (INNER.x1 - CD / 2 - 0.02);
  const facing = side === -1 ? Math.PI / 2 : -Math.PI / 2; // front (+z local) faces into the room

  // Book spines: one instanced mesh per cupboard
  const spines = useMemo(() => {
    const r = rng(seed + 7);
    const items: { pos: [number, number, number]; size: [number, number, number]; tilt: number; color: string }[] = [];
    SHELVES.forEach((y, shelf) => {
      if (featured && shelf === 2) return; // the four face-out books live here
      let u = -CW / 2 + 0.08;
      while (u < CW / 2 - 0.12) {
        const w = 0.022 + r() * 0.04;
        const h = 0.24 + r() * 0.15;
        const d = 0.17 + r() * 0.08;
        const tilt = u > CW / 2 - 0.35 && r() < 0.5 ? 0.18 : 0;
        items.push({ pos: [u + w / 2, y + 0.03 + h / 2, -CD / 2 + 0.05 + d / 2], size: [w, h, d], tilt, color: SPINE_COLORS[Math.floor(r() * SPINE_COLORS.length)] });
        u += w + 0.003 + (r() < 0.06 ? 0.08 : 0);
      }
    });
    return items;
  }, [seed, featured]);

  const spineRef = useRef<THREE.InstancedMesh>(null);
  const spineGeo = useMemo(() => new THREE.BoxGeometry(1, 1, 1), []);
  const spineMat = useMemo(() => new THREE.MeshStandardMaterial({ roughness: 0.75 }), []);
  const fillSpines = (mesh: THREE.InstancedMesh | null) => {
    (spineRef as React.MutableRefObject<THREE.InstancedMesh | null>).current = mesh;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    spines.forEach((b, i) => {
      q.setFromEuler(new THREE.Euler(0, 0, b.tilt));
      m.compose(new THREE.Vector3(...b.pos), q, new THREE.Vector3(...b.size));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, new THREE.Color(b.color).multiplyScalar(0.85 + Math.random() * 0.25));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };

  // Glass doors: locked ones stay shut; the featured one swings open as you come close
  const leftDoor = useRef<THREE.Group>(null);
  const rightDoor = useRef<THREE.Group>(null);
  const open = useRef(0);
  useFrame((_, dt) => {
    if (!featured) return;
    const p = world.player;
    const near = Math.abs(p.y - FLOOR) < 1.5 && Math.hypot(p.x - x, p.z - z) < 3.6;
    open.current += ((near ? 1 : 0) - open.current) * Math.min(dt * 2.2, 1);
    const a = open.current * 1.75;
    if (leftDoor.current) leftDoor.current.rotation.y = -a;
    if (rightDoor.current) rightDoor.current.rotation.y = a;
  });

  const lockedInfo: Interactable = useMemo(
    () => ({
      label: 'Locked · coming soon',
      onUse: () =>
        ui.showCard({
          emoji: '🔒',
          title: 'Locked for now',
          text: 'This bookcase is waiting for new stories. As Electrosparkzz grows, more cupboards will open. For now, find the one with the light on.',
        }),
    }),
    []
  );

  const door = (sign: -1 | 1) => (
    <group ref={sign === -1 ? leftDoor : rightDoor} position={[sign * (CW / 2 - 0.02), CH / 2, CD / 2 + 0.01]}>
      <group position={[-sign * (CW / 4 - 0.01), 0, 0]}>
        <mesh material={glass}>
          <boxGeometry args={[CW / 2 - 0.12, CH - 0.2, 0.012]} />
        </mesh>
        {/* frame */}
        {[[0, (CH - 0.1) / 2, CW / 2 - 0.04, 0.06], [0, -(CH - 0.1) / 2, CW / 2 - 0.04, 0.06]].map(([fx, fy, fw, fh], i) => (
          <mesh key={i} position={[fx, fy, 0]} material={wood}>
            <boxGeometry args={[fw, fh, 0.035]} />
          </mesh>
        ))}
        {[-1, 1].map((e) => (
          <mesh key={e} position={[e * (CW / 4 - 0.04), 0, 0]} material={wood}>
            <boxGeometry args={[0.05, CH - 0.1, 0.035]} />
          </mesh>
        ))}
        {/* handle near the middle */}
        <mesh position={[-sign * (CW / 4 - 0.1), 0.05, 0.03]} material={brass}>
          <boxGeometry args={[0.02, 0.16, 0.02]} />
        </mesh>
      </group>
    </group>
  );

  return (
    <group position={[x, FLOOR, z]} rotation-y={facing}>
      <group userData={featured ? undefined : { interact: lockedInfo }}>
        {/* carcass */}
        <mesh position={[0, CH / 2, -CD / 2 + 0.01]} material={back}>
          <boxGeometry args={[CW, CH, 0.02]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} position={[s * (CW / 2 - 0.02), CH / 2, 0]} castShadow receiveShadow material={wood}>
            <boxGeometry args={[0.04, CH, CD]} />
          </mesh>
        ))}
        <mesh position={[0, CH - 0.02, 0]} castShadow material={wood}>
          <boxGeometry args={[CW + 0.06, 0.06, CD + 0.04]} />
        </mesh>
        <mesh position={[0, 0.05, 0]} material={wood}>
          <boxGeometry args={[CW, 0.1, CD]} />
        </mesh>
        {SHELVES.slice(1).map((y) => (
          <mesh key={y} position={[0, y, 0]} receiveShadow material={wood}>
            <boxGeometry args={[CW - 0.06, 0.03, CD - 0.04]} />
          </mesh>
        ))}
        <instancedMesh ref={fillSpines} args={[spineGeo, spineMat, spines.length]} castShadow receiveShadow />
        {door(-1)}
        {door(1)}
        {!featured && (
          <group position={[0, CH / 2 - 0.1, CD / 2 + 0.05]}>
            {/* padlock through the handles, with a paper tag */}
            <mesh material={brass}>
              <boxGeometry args={[0.07, 0.08, 0.03]} />
            </mesh>
            <mesh position={[0, 0.06, 0]} rotation-x={Math.PI / 2} material={brass}>
              <torusGeometry args={[0.025, 0.006, 6, 12, Math.PI]} />
            </mesh>
            <mesh position={[0.07, -0.1, 0.005]} rotation-z={0.15}>
              <planeGeometry args={[0.12, 0.07]} />
              <meshStandardMaterial color="#f3ead8" roughness={0.9} side={THREE.DoubleSide} />
            </mesh>
            <Text font={FONT} position={[0.07, -0.1, 0.012]} rotation-z={0.15} fontSize={0.016} color="#6b5440" anchorX="center" anchorY="middle">
              coming soon
            </Text>
          </group>
        )}
      </group>

      {featured && <FeaturedShelf />}

      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[CW / 2, CH / 2, CD / 2 + 0.05]} position={[0, CH / 2, 0]} />
      </RigidBody>
    </group>
  );
}

/** The open cupboard: a spotlight, an "open" plaque and the four books face-out. */
function FeaturedShelf() {
  const plaque = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2238', roughness: 0.3, metalness: 0.4 }), []);
  const spot = useRef<THREE.SpotLight>(null);
  const target = useMemo(() => new THREE.Object3D(), []);
  return (
    <group>
      <primitive object={target} position={[0, 1.2, 0]} />
      <spotLight ref={spot} position={[0, CH + 1.0, 1.6]} target={target} angle={0.55} penumbra={0.6} intensity={6} distance={7} decay={1.8} color="#ffe2b8" castShadow={false} />
      <mesh position={[0, CH + 0.18, CD / 2 - 0.05]} material={plaque}>
        <boxGeometry args={[0.9, 0.26, 0.03]} />
      </mesh>
      <Text font={FONT} position={[0, CH + 0.18, CD / 2 - 0.03]} fontSize={0.09} letterSpacing={0.18} color="#ffd38f" anchorX="center" anchorY="middle">
        OPEN · 4 BOOKS
      </Text>
      {BOOKS.map((b, i) => (
        <ShelfBook key={b.id} book={b} slot={i} />
      ))}
    </group>
  );
}

/* ── A book you can take ───────────────────────────────────────── */

function coverTexture(book: Book) {
  return canvasTexture(320, 448, (g) => {
    const grad = g.createLinearGradient(0, 0, 320, 448);
    grad.addColorStop(0, book.colors[0]);
    grad.addColorStop(1, book.colors[1]);
    g.fillStyle = grad;
    g.fillRect(0, 0, 320, 448);
    // little dots like the site
    g.fillStyle = 'rgba(255,255,255,0.45)';
    for (let y = 10; y < 448; y += 18) for (let x = 10; x < 320; x += 18) g.fillRect(x, y, 2, 2);
    g.strokeStyle = 'rgba(255,255,255,0.8)';
    g.lineWidth = 6;
    g.strokeRect(14, 14, 292, 420);
    g.textAlign = 'center';
    g.font = '86px serif';
    g.fillText(book.emoji, 160, 170);
    g.fillStyle = '#2b2238';
    g.font = '700 50px Fredoka, Poppins, Arial, sans-serif';
    g.fillText(book.title, 160, 260, 280);
    g.fillStyle = '#5b4f69';
    g.font = '600 20px Nunito, Arial, sans-serif';
    const words = book.subtitle.split(' ');
    let line = '';
    let y = 300;
    for (const w of words) {
      if (g.measureText(line + w).width > 250) {
        g.fillText(line.trim(), 160, y);
        line = '';
        y += 26;
      }
      line += w + ' ';
    }
    g.fillText(line.trim(), 160, y);
    g.fillStyle = '#7d6f8c';
    g.font = '700 16px Nunito, Arial, sans-serif';
    g.fillText('ELECTROSPARKZZ', 160, 412);
  });
}

/** A book's materials: box faces +x, −x, +y, −y, +z (front cover), −z (back). */
const coverCache = new Map<string, THREE.Material[]>();
export function coverMaterials(book: Book): THREE.Material[] {
  let mats = coverCache.get(book.id);
  if (!mats) {
    const cover = new THREE.MeshStandardMaterial({ map: coverTexture(book), roughness: 0.45 });
    const paper = new THREE.MeshStandardMaterial({ color: '#f5efe2', roughness: 0.9 });
    const spine = new THREE.MeshStandardMaterial({ color: book.colors[1], roughness: 0.5 });
    mats = [paper, spine, paper, paper, cover, spine];
    coverCache.set(book.id, mats);
  }
  return mats;
}

const BOOK_W = 0.24;
const BOOK_H = 0.34;
const BOOK_D = 0.04;

function ShelfBook({ book, slot }: { book: Book; slot: number }) {
  const group = useRef<THREE.Group>(null);
  const mats = useMemo(() => coverMaterials(book), [book]);

  // where it stands on the shelf (cupboard space)
  const home = useMemo(() => {
    const u = -CW / 2 + 0.3 + slot * ((CW - 0.6) / 3);
    return { pos: new THREE.Vector3(u, SHELVES[2] + 0.03 + BOOK_H / 2, -0.02), rot: new THREE.Euler(-0.12, 0, 0) };
  }, [slot]);

  const lift = useRef(0);
  const opened = useRef(false);
  const tmp = useMemo(
    () => ({ world: new THREE.Vector3(), local: new THREE.Vector3(), q: new THREE.Quaternion(), qHome: new THREE.Quaternion(), qParent: new THREE.Quaternion(), fwd: new THREE.Vector3() }),
    []
  );

  useFrame(({ camera }, dt) => {
    const g = group.current;
    if (!g || !g.parent) return;
    const state = ui.get();
    g.visible = state.carrying?.id !== book.id;
    const mine = state.book?.id === book.id && state.carrying?.id !== book.id;
    lift.current += ((mine ? 1 : 0) - lift.current) * Math.min(dt * 3.2, 1);
    if (mine && lift.current > 0.93 && !opened.current) {
      opened.current = true;
      ui.openReader();
    }
    if (!mine) opened.current = false;

    // target: half a metre in front of your eyes, facing you
    camera.getWorldDirection(tmp.fwd);
    tmp.world.copy(camera.position).addScaledVector(tmp.fwd, 0.55).add(new THREE.Vector3(0, -0.04, 0));
    tmp.local.copy(tmp.world);
    g.parent.worldToLocal(tmp.local);
    g.parent.getWorldQuaternion(tmp.qParent);
    tmp.q.copy(tmp.qParent).invert().multiply(camera.quaternion);

    const t = THREE.MathUtils.smoothstep(lift.current, 0, 1);
    // slide forward off the shelf first, then float up to you
    const out = home.pos.clone().add(new THREE.Vector3(0, 0.02, 0.35 * Math.min(t * 3, 1)));
    g.position.copy(out).lerp(tmp.local, Math.max((t - 0.15) / 0.85, 0));
    tmp.qHome.setFromEuler(home.rot);
    g.quaternion.copy(tmp.qHome).slerp(tmp.q, t);
  });

  const interact: Interactable = useMemo(
    () => ({
      label: `Read “${book.title}”`,
      reach: 3.2,
      onUse: () => {
        const s = ui.get();
        if (!s.book && !s.carrying) ui.takeBook(book);
        else if (s.carrying) ui.toast('You’re already carrying a book. Put it back first.');
      },
    }),
    [book]
  );

  return (
    <group ref={group} position={home.pos} rotation={home.rot} userData={{ interact }}>
      <mesh material={mats} castShadow>
        <boxGeometry args={[BOOK_W, BOOK_H, BOOK_D]} />
      </mesh>
    </group>
  );
}

/* ── Reading table and lights ─────────────────────────────────── */

function ReadingTable() {
  const wood = usePBR('wood_floor', [1.5, 0.6], { tint: '#8a5d3b' });
  const brass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b8922e', roughness: 0.3, metalness: 0.9 }), []);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1f6b4a', emissive: '#ffcf8a', emissiveIntensity: 0.25, roughness: 0.3, metalness: 0.2, side: THREE.DoubleSide }), []);
  const cushion = useMemo(() => new THREE.MeshStandardMaterial({ color: '#7d2f3d', roughness: 0.9 }), []);
  useFrame(() => {
    shade.emissiveIntensity = 0.35 + world.night * 0.8;
  });
  const z = -5.6;
  return (
    <group position={[0, FLOOR, z]}>
      <mesh position={[0, 0.76, 0]} castShadow receiveShadow material={wood}>
        <boxGeometry args={[2.6, 0.06, 1.1]} />
      </mesh>
      {[[-1.2, -0.45], [1.2, -0.45], [-1.2, 0.45], [1.2, 0.45]].map(([lx, lz]) => (
        <mesh key={`${lx}${lz}`} position={[lx, 0.37, lz]} castShadow material={wood}>
          <boxGeometry args={[0.07, 0.74, 0.07]} />
        </mesh>
      ))}
      {/* banker's lamps */}
      {[-0.75, 0.75].map((lx) => (
        <group key={lx} position={[lx, 0.79, 0]}>
          <mesh position={[0, 0.01, 0]} material={brass}>
            <cylinderGeometry args={[0.08, 0.09, 0.02, 16]} />
          </mesh>
          <mesh position={[0, 0.18, 0]} material={brass}>
            <cylinderGeometry args={[0.01, 0.01, 0.34, 8]} />
          </mesh>
          <mesh position={[0, 0.36, 0.04]} rotation-z={Math.PI / 2} material={shade}>
            <cylinderGeometry args={[0.07, 0.07, 0.34, 16, 1, true, 0, Math.PI]} />
          </mesh>
        </group>
      ))}
      {/* chairs (click one to sit at the table) */}
      {[[-0.7, -0.85, 0], [0.7, -0.85, 0], [-0.7, 0.85, Math.PI], [0.7, 0.85, Math.PI]].map(([cx, cz, r]) => (
        <group
          key={`${cx}${cz}`}
          position={[cx, 0, cz]}
          rotation-y={r}
          userData={{
            interact: seatInteract(
              'Sit at the reading table',
              new THREE.Vector3(cx, FLOOR + 0.5, z + cz),
              r === 0 ? Math.PI : 0,
              new THREE.Vector3(cx, FLOOR, z + cz * 1.9)
            ),
          }}
        >
          <mesh position={[0, 0.46, 0]} castShadow material={cushion}>
            <boxGeometry args={[0.46, 0.08, 0.44]} />
          </mesh>
          <mesh position={[0, 0.8, -0.2]} castShadow material={wood}>
            <boxGeometry args={[0.46, 0.6, 0.05]} />
          </mesh>
          {[[-0.2, -0.18], [0.2, -0.18], [-0.2, 0.18], [0.2, 0.18]].map(([lx, lz]) => (
            <mesh key={`${lx}${lz}`} position={[lx, 0.22, lz]} material={wood}>
              <boxGeometry args={[0.04, 0.44, 0.04]} />
            </mesh>
          ))}
        </group>
      ))}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[1.35, 0.4, 0.6]} position={[0, 0.4, 0]} />
        <CuboidCollider args={[1.0, 0.45, 0.25]} position={[0, 0.45, -0.85]} />
        <CuboidCollider args={[1.0, 0.45, 0.25]} position={[0, 0.45, 0.85]} />
      </RigidBody>
    </group>
  );
}

/** Warm pendant lamps hanging from the library ceiling. */
function Pendants() {
  const spots = useMemo(() => [[-5.5, -4], [5.5, -4], [-5.5, -11], [5.5, -11], [0, -3], [-5.5, -17], [5.5, -17]], []);
  const shade = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.4, metalness: 0.6, side: THREE.DoubleSide }), []);
  const bulb = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffd59a', emissiveIntensity: 2.5, toneMapped: false }), []);
  const lights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    lights.current.forEach((l) => l && (l.intensity = 5 + world.night * 5));
  });
  return (
    <group>
      {/* one soft fill for the back half of the room */}
      <pointLight ref={(l) => (lights.current[2] = l)} position={[0, CEIL - 1.4, -13]} color="#ffdcae" distance={16} decay={1.3} />
      {spots.map(([x, z], i) => (
        <group key={i} position={[x, CEIL, z]}>
          <mesh position={[0, -0.5, 0]}>
            <cylinderGeometry args={[0.005, 0.005, 1, 4]} />
            <meshBasicMaterial color="#222" />
          </mesh>
          <mesh position={[0, -1.08, 0]} material={shade} castShadow>
            <coneGeometry args={[0.28, 0.22, 24, 1, true]} />
          </mesh>
          <mesh position={[0, -1.17, 0]} material={bulb}>
            <sphereGeometry args={[0.06, 12, 8]} />
          </mesh>
          {i < 2 && <pointLight ref={(l) => (lights.current[i] = l)} position={[0, -1.3, 0]} color="#ffdcae" distance={11} decay={1.5} />}
        </group>
      ))}
    </group>
  );
}
