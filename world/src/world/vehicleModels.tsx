import * as THREE from 'three';
import { forwardRef, useLayoutEffect, useMemo, useRef } from 'react';
import { mergeStatic } from './merge';
import { RoundedBox } from '@react-three/drei';
import { canvasTexture } from './materials';

/*
 * Vehicles at real size. Every model faces +x (forward), y is up, +z is its right-hand
 * side. Wheels are tagged `userData.wheel = radius` so they can be spun.
 */
/** (bus: traffic only) */
export type VehicleKind = 'car' | 'auto' | 'bike' | 'cycle' | 'bus';

export const SPECS: Record<VehicleKind, {
  name: string;
  emoji: string;
  /** half extents for the collider */
  half: [number, number, number];
  /** where your eyes are when riding (model space) */
  eye: [number, number, number];
  /** top speed m/s, acceleration m/s², how fast it turns rad/s */
  top: number;
  accel: number;
  turn: number;
  /** seat height for a rider model */
  seat: number;
}> = {
  car: { name: 'Car', emoji: '🚗', half: [1.95, 0.75, 0.86], eye: [-0.05, 1.18, 0.36], top: 16, accel: 3.2, turn: 0.75, seat: 0.5 },
  auto: { name: 'Auto rickshaw', emoji: '🛺', half: [1.33, 0.88, 0.66], eye: [0.15, 1.42, 0], top: 12, accel: 2.4, turn: 1.0, seat: 0.82 },
  bike: { name: 'Superbike', emoji: '🏍️', half: [1.02, 0.58, 0.36], eye: [-0.12, 1.38, 0], top: 62, accel: 8.5, turn: 1.35, seat: 0.84 },
  bus: { name: 'Bus', emoji: '🚌', half: [5.45, 1.55, 1.25], eye: [4.6, 2.4, 0.7], top: 14, accel: 1.4, turn: 0.4, seat: 1.4 },
  cycle: { name: 'Bicycle', emoji: '🚲', half: [0.88, 0.55, 0.3], eye: [-0.25, 1.6, 0], top: 6, accel: 1.4, turn: 1.6, seat: 0.95 },
};

function plateTexture(text: string, commercial: boolean) {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = commercial ? '#f5c518' : '#ffffff';
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = '#111';
    g.lineWidth = 4;
    g.strokeRect(3, 3, 250, 58);
    g.fillStyle = '#111';
    g.font = '700 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, 128, 34);
  });
}

const plates = new Map<string, THREE.Texture>();
const plate = (text: string, commercial = false) => {
  const key = `${text}${commercial}`;
  if (!plates.has(key)) plates.set(key, plateTexture(text, commercial));
  return plates.get(key)!;
};

const mats = {
  tyre: new THREE.MeshStandardMaterial({ color: '#1b1b1d', roughness: 0.9 }),
  rim: new THREE.MeshStandardMaterial({ color: '#b9bdc2', roughness: 0.3, metalness: 0.9 }),
  chrome: new THREE.MeshStandardMaterial({ color: '#d9dde2', roughness: 0.15, metalness: 1 }),
  black: new THREE.MeshStandardMaterial({ color: '#1e1e22', roughness: 0.5 }),
  glass: new THREE.MeshStandardMaterial({ color: '#1d2a33', roughness: 0.05, metalness: 0.4, transparent: true, opacity: 0.55, envMapIntensity: 1.5 }),
  seat: new THREE.MeshStandardMaterial({ color: '#2a2422', roughness: 0.8 }),
  head: new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#fff1c9', emissiveIntensity: 0.2 }),
  tail: new THREE.MeshStandardMaterial({ color: '#c1121f', emissive: '#ff2a2a', emissiveIntensity: 0.25 }),
  /** tinted glass, solid (no see-through sorting troubles), glossy */
  tint: new THREE.MeshPhysicalMaterial({ color: '#16212a', roughness: 0.05, metalness: 0.3, clearcoat: 1, envMapIntensity: 1.8 }),
  trim: new THREE.MeshStandardMaterial({ color: '#2b2d31', roughness: 0.7 }),
};

/** Make headlights and tail lights glow (0 = day … 1 = night). */
export function setVehicleLights(night: number) {
  mats.head.emissiveIntensity = 0.2 + night * 3;
  mats.tail.emissiveIntensity = 0.25 + night * 1.6;
}

/* ── Car: a hatchback, its body drawn from a real side profile ───── */

/** An outline in the side view (x forward, y up) pushed out `depth` across, centred, softly rounded. */
function extrudeSide(points: (s: THREE.Shape) => void, depth: number, bevel: number) {
  const shape = new THREE.Shape();
  points(shape);
  const g = new THREE.ExtrudeGeometry(shape, { depth: depth - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 4, curveSegments: 14 });
  g.translate(0, 0, -(depth - bevel * 2) / 2);
  g.computeVertexNormals();
  return g;
}

const CAR_BODY = extrudeSide((s) => {
  s.moveTo(-1.93, 0.34);
  s.lineTo(-1.64, 0.34);
  // the wheel arches
  s.absarc(-1.25, 0.31, 0.39, Math.PI, 0, true);
  s.lineTo(0.86, 0.34);
  s.absarc(1.25, 0.31, 0.39, Math.PI, 0, true);
  s.lineTo(1.9, 0.34);
  // bumper, nose, the bonnet sloping up to the windscreen
  s.quadraticCurveTo(1.99, 0.36, 1.98, 0.56);
  s.quadraticCurveTo(1.97, 0.76, 1.84, 0.8);
  s.quadraticCurveTo(1.35, 0.88, 0.82, 0.98);
  // the shoulder line to the back, and the tailgate
  s.lineTo(-1.72, 1.04);
  s.quadraticCurveTo(-1.95, 1.0, -1.97, 0.78);
  s.lineTo(-1.95, 0.42);
  s.quadraticCurveTo(-1.95, 0.34, -1.93, 0.34);
}, 1.66, 0.07);

const CAR_GLASS = extrudeSide((s) => {
  s.moveTo(0.84, 0.96);
  // windscreen, roof, the hatch's glass
  s.quadraticCurveTo(0.45, 1.25, 0.12, 1.43);
  s.quadraticCurveTo(-0.6, 1.5, -1.3, 1.45);
  s.quadraticCurveTo(-1.62, 1.3, -1.74, 1.02);
  s.lineTo(0.84, 0.96);
}, 1.46, 0.04);

const CAR_ROOF = extrudeSide((s) => {
  s.moveTo(0.1, 1.43);
  s.quadraticCurveTo(-0.6, 1.5, -1.32, 1.45);
  s.lineTo(-1.3, 1.52);
  s.quadraticCurveTo(-0.6, 1.57, 0.08, 1.5);
  s.lineTo(0.1, 1.43);
}, 1.44, 0.05);

/** A wheel: tyre with a rounded shoulder, five-spoke alloy, hub. */
function Wheel({ r, w, position, rim = 0.62, spokes = 5 }: { r: number; w: number; position: [number, number, number]; rim?: number; spokes?: number }) {
  return (
    <group position={position} userData={{ wheel: r }}>
      <mesh rotation-x={Math.PI / 2} material={mats.tyre} castShadow>
        <cylinderGeometry args={[r * 0.96, r * 0.96, w, 24]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={`t${s}`} position={[0, 0, (s * w) / 2]} material={mats.tyre}>
          <torusGeometry args={[r * 0.84, r * 0.13, 8, 24]} />
        </mesh>
      ))}
      {[-1, 1].map((s) => (
        <group key={s} position={[0, 0, s * (w / 2 - 0.01)]}>
          <mesh rotation-x={Math.PI / 2} material={mats.black}>
            <cylinderGeometry args={[r * rim, r * rim, 0.02, 20]} />
          </mesh>
          {Array.from({ length: spokes }, (_, i) => (
            <mesh key={i} position={[0, 0, s * 0.012]} rotation-z={(i / spokes) * Math.PI * 2} material={mats.rim}>
              <boxGeometry args={[r * rim * 1.9, r * 0.13, 0.02]} />
            </mesh>
          ))}
          <mesh position={[0, 0, s * 0.02]} rotation-x={Math.PI / 2} material={mats.rim}>
            <cylinderGeometry args={[r * rim, r * rim, 0.006, 20, 1, true]} />
          </mesh>
          <mesh position={[0, 0, s * 0.022]} rotation-x={Math.PI / 2} material={mats.chrome}>
            <cylinderGeometry args={[r * 0.14, r * 0.16, 0.03, 12]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

export const Car = forwardRef<THREE.Group, { color: string; plateText?: string }>(function Car({ color, plateText = 'KL 14 A 2026' }, ref) {
  const paint = useMemo(() => new THREE.MeshPhysicalMaterial({ color, roughness: 0.28, metalness: 0.45, clearcoat: 1, clearcoatRoughness: 0.08, envMapIntensity: 1.4 }), [color]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate(plateText), roughness: 0.4 }), [plateText]);
  return (
    <group ref={ref}>
      <mesh geometry={CAR_BODY} material={paint} castShadow receiveShadow />
      <mesh geometry={CAR_GLASS} material={mats.tint} castShadow />
      <mesh geometry={CAR_ROOF} material={paint} castShadow />
      {[-1, 1].map((s) => (
        <group key={s}>
          {/* the middle pillar between the doors' windows */}
          <mesh position={[-0.42, 1.21, s * 0.73]} material={mats.black}>
            <boxGeometry args={[0.09, 0.5, 0.02]} />
          </mesh>
          {/* door seams, handles, the black trim along the sill */}
          {[0.78, -0.4, -1.45].map((x) => (
            <mesh key={x} position={[x, 0.68, s * 0.835]} material={mats.black}>
              <boxGeometry args={[0.012, 0.6, 0.01]} />
            </mesh>
          ))}
          {[0.05, -1.05].map((x) => (
            <mesh key={`h${x}`} position={[x, 0.86, s * 0.84]} material={mats.chrome}>
              <boxGeometry args={[0.16, 0.035, 0.02]} />
            </mesh>
          ))}
          <mesh position={[0, 0.39, s * 0.82]} material={mats.black}>
            <boxGeometry args={[1.6, 0.08, 0.04]} />
          </mesh>
          {/* mirrors */}
          <mesh position={[0.66, 1.03, s * 0.93]} material={paint}>
            <boxGeometry args={[0.16, 0.12, 0.2]} />
          </mesh>
          <mesh position={[0.6, 1.03, s * 0.93]} material={mats.chrome}>
            <boxGeometry args={[0.02, 0.09, 0.16]} />
          </mesh>
          {/* headlamps swept back into the wings, tail lamps wrapping round */}
          <mesh position={[1.88, 0.73, s * 0.6]} rotation-y={s * -0.25} material={mats.head}>
            <boxGeometry args={[0.12, 0.12, 0.36]} />
          </mesh>
          <mesh position={[1.92, 0.44, s * 0.62]} material={mats.head}>
            <cylinderGeometry args={[0.045, 0.045, 0.03, 12]} />
          </mesh>
          <mesh position={[-1.93, 0.86, s * 0.66]} material={mats.tail}>
            <boxGeometry args={[0.08, 0.18, 0.26]} />
          </mesh>
        </group>
      ))}
      {/* grille, bumpers, plates */}
      <mesh position={[1.95, 0.62, 0]} material={mats.black}>
        <boxGeometry args={[0.04, 0.13, 0.86]} />
      </mesh>
      <mesh position={[1.955, 0.645, 0]} material={mats.chrome}>
        <boxGeometry args={[0.03, 0.02, 0.8]} />
      </mesh>
      <mesh position={[1.96, 0.37, 0]} material={mats.trim}>
        <boxGeometry args={[0.06, 0.1, 1.6]} />
      </mesh>
      <mesh position={[-1.96, 0.42, 0]} material={mats.trim}>
        <boxGeometry args={[0.06, 0.14, 1.6]} />
      </mesh>
      <mesh position={[1.995, 0.5, 0]} rotation-y={Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.52, 0.12]} />
      </mesh>
      <mesh position={[-1.985, 0.6, 0]} rotation-y={-Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.52, 0.12]} />
      </mesh>
      {/* inside: dashboard and steering wheel on the right (Indian cars are right-hand drive) */}
      <mesh position={[0.62, 0.92, 0]} material={mats.black}>
        <boxGeometry args={[0.36, 0.12, 1.42]} />
      </mesh>
      <group position={[0.4, 0.95, 0.36]} rotation-z={0.45}>
        <mesh rotation-y={Math.PI / 2} material={mats.black}>
          <torusGeometry args={[0.17, 0.018, 8, 28]} />
        </mesh>
        <mesh rotation-z={Math.PI / 2} material={mats.black}>
          <cylinderGeometry args={[0.035, 0.035, 0.06, 12]} />
        </mesh>
      </group>
      {[-0.36, 0.36].map((z) => (
        <group key={z}>
          <mesh position={[-0.05, 0.62, z]} material={mats.seat}>
            <boxGeometry args={[0.5, 0.15, 0.5]} />
          </mesh>
          <mesh position={[-0.3, 0.95, z]} rotation-z={0.15} material={mats.seat}>
            <boxGeometry args={[0.12, 0.6, 0.48]} />
          </mesh>
        </group>
      ))}
      {[1.25, -1.25].flatMap((x) => [-0.71, 0.71].map((z) => <Wheel key={`${x}${z}`} r={0.31} w={0.2} position={[x, 0.31, z]} />))}
    </group>
  );
});

/* ── KSRTC bus (traffic): red and yellow, KASARAGOD on the board ─── */

function busSide() {
  return canvasTexture(1024, 256, (g) => {
    g.fillStyle = '#b3171d';
    g.fillRect(0, 0, 1024, 256);
    // window band
    g.fillStyle = '#f1e2b8';
    g.fillRect(0, 34, 1024, 92);
    g.fillStyle = '#1b2228';
    for (let x = 18; x < 1000; x += 92) g.fillRect(x, 42, 80, 76);
    g.fillStyle = '#f2c200';
    g.fillRect(0, 132, 1024, 14);
    g.fillRect(0, 222, 1024, 8);
    g.fillStyle = '#fff6dc';
    g.font = '900 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.fillText('KERALA RTC', 512, 200);
  });
}
function busBoard() {
  return canvasTexture(512, 96, (g) => {
    g.fillStyle = '#111';
    g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#ffb000';
    g.font = '900 54px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('KASARAGOD', 256, 50);
  });
}

export const Bus = forwardRef<THREE.Group, object>(function Bus(_, ref) {
  const side = useMemo(() => new THREE.MeshStandardMaterial({ map: busSide(), roughness: 0.45, metalness: 0.2 }), []);
  const red = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b3171d', roughness: 0.4, metalness: 0.2 }), []);
  const board = useMemo(() => new THREE.MeshStandardMaterial({ map: busBoard(), emissive: '#ffb000', emissiveIntensity: 0.2, emissiveMap: busBoard() }), []);
  return (
    <group ref={ref}>
      <RoundedBox args={[10.8, 2.7, 2.48]} radius={0.18} smoothness={3} position={[0, 1.85, 0]} castShadow receiveShadow material={red} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 1.85, s * 1.245]} rotation-y={s === 1 ? 0 : Math.PI} material={side}>
          <planeGeometry args={[10.4, 2.6]} />
        </mesh>
      ))}
      {/* windscreen, destination board, lights, bumper */}
      <mesh position={[5.405, 2.2, 0]} rotation-y={Math.PI / 2} material={mats.tint}>
        <planeGeometry args={[2.3, 1.3]} />
      </mesh>
      <mesh position={[5.41, 3.0, 0]} rotation-y={Math.PI / 2} material={board}>
        <planeGeometry args={[1.8, 0.32]} />
      </mesh>
      <mesh position={[-5.405, 2.3, 0]} rotation-y={-Math.PI / 2} material={mats.tint}>
        <planeGeometry args={[2.1, 0.9]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[5.41, 0.95, s * 0.95]} material={mats.head}>
            <boxGeometry args={[0.04, 0.2, 0.3]} />
          </mesh>
          <mesh position={[-5.41, 1.0, s * 1.0]} material={mats.tail}>
            <boxGeometry args={[0.04, 0.3, 0.2]} />
          </mesh>
        </group>
      ))}
      <mesh position={[5.42, 0.65, 0]} material={mats.trim}>
        <boxGeometry args={[0.1, 0.25, 2.4]} />
      </mesh>
      {[3.6, -3.0].flatMap((x) => [-1.08, 1.08].map((z) => <Wheel key={`${x}${z}`} r={0.5} w={0.3} rim={0.55} spokes={8} position={[x, 0.5, z]} />))}
    </group>
  );
});

/* ── Auto rickshaw (Kerala: black body, yellow canopy) ─────────── */

export const Auto = forwardRef<THREE.Group, { plateText?: string }>(function Auto({ plateText = 'KL 14 J 4321' }, ref) {
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.35, metalness: 0.3 }), []);
  const yellow = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f2c200', roughness: 0.5, side: THREE.DoubleSide }), []);
  const canvasTop = useMemo(() => new THREE.MeshStandardMaterial({ color: '#202020', roughness: 0.85, side: THREE.DoubleSide }), []);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate(plateText, true), roughness: 0.4 }), [plateText]);
  const roof = useMemo(() => {
    const shape = new THREE.Shape();
    shape.moveTo(-0.65, 0);
    shape.quadraticCurveTo(-0.66, 0.32, 0, 0.36);
    shape.quadraticCurveTo(0.66, 0.32, 0.65, 0);
    shape.lineTo(0.62, 0);
    shape.quadraticCurveTo(0.6, 0.28, 0, 0.32);
    shape.quadraticCurveTo(-0.6, 0.28, -0.62, 0);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 2.0, bevelEnabled: false, curveSegments: 10 });
    g.rotateY(Math.PI / 2);
    g.translate(-1.15, 0, 0);
    return g;
  }, []);
  return (
    <group ref={ref}>
      {/* floor pan and rear body */}
      <RoundedBox args={[1.9, 0.42, 1.28]} radius={0.12} smoothness={3} position={[-0.25, 0.48, 0]} castShadow receiveShadow material={body} />
      {/* front cowl with headlight */}
      <RoundedBox args={[0.5, 0.95, 0.62]} radius={0.15} smoothness={3} position={[1.0, 0.72, 0]} castShadow material={body} />
      <mesh position={[1.26, 0.92, 0]} rotation-z={Math.PI / 2} material={mats.head}>
        <cylinderGeometry args={[0.09, 0.09, 0.04, 18]} />
      </mesh>
      {/* yellow lower front panel and stripe */}
      <mesh position={[0.6, 0.72, 0]} material={yellow}>
        <boxGeometry args={[0.04, 0.3, 1.26]} />
      </mesh>
      {/* windscreen */}
      <mesh position={[0.92, 1.45, 0]} rotation-z={-0.12} material={mats.glass}>
        <boxGeometry args={[0.03, 0.62, 1.2]} />
      </mesh>
      {/* canopy: yellow front band, black canvas roof */}
      <mesh geometry={roof} position={[0, 1.66, 0]} material={canvasTop} castShadow />
      <mesh position={[0.86, 1.78, 0]} material={yellow}>
        <boxGeometry args={[0.06, 0.18, 1.3]} />
      </mesh>
      <mesh position={[-1.13, 1.32, 0]} material={canvasTop}>
        <boxGeometry args={[0.04, 0.7, 1.24]} />
      </mesh>
      {[-0.62, 0.62].map((z) => (
        <group key={z}>
          <mesh position={[0.88, 1.2, z]} material={mats.chrome}>
            <cylinderGeometry args={[0.018, 0.018, 0.95, 8]} />
          </mesh>
          <mesh position={[-1.1, 1.2, z]} material={mats.chrome}>
            <cylinderGeometry args={[0.018, 0.018, 0.95, 8]} />
          </mesh>
        </group>
      ))}
      {/* handlebar and seats */}
      <mesh position={[0.62, 1.12, 0]} rotation-x={Math.PI / 2} material={mats.chrome}>
        <cylinderGeometry args={[0.015, 0.015, 0.7, 8]} />
      </mesh>
      <mesh position={[0.25, 0.82, 0]} material={mats.seat}>
        <boxGeometry args={[0.4, 0.1, 0.5]} />
      </mesh>
      <mesh position={[-0.55, 0.82, 0]} material={mats.seat}>
        <boxGeometry args={[0.45, 0.12, 1.15]} />
      </mesh>
      <mesh position={[-0.8, 1.05, 0]} material={mats.seat}>
        <boxGeometry args={[0.08, 0.4, 1.15]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[-1.16, 0.6, s * 0.45]} material={mats.tail}>
          <boxGeometry args={[0.03, 0.1, 0.1]} />
        </mesh>
      ))}
      <mesh position={[-1.215, 0.5, 0]} rotation-y={-Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.36, 0.1]} />
      </mesh>
      <mesh position={[1.27, 0.45, 0]} rotation-y={Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.3, 0.09]} />
      </mesh>
      <Wheel r={0.2} w={0.12} position={[1.0, 0.2, 0]} />
      <Wheel r={0.2} w={0.12} position={[-0.75, 0.2, -0.56]} />
      <Wheel r={0.2} w={0.12} position={[-0.75, 0.2, 0.56]} />
    </group>
  );
});

/* ── Superbike: a full-fairing sports bike ─────────────────────── */

export const Superbike = forwardRef<THREE.Group, { color: string; plateText?: string }>(function Superbike({ color, plateText = 'KL 14 S 1000' }, ref) {
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.18, metalness: 0.6, envMapIntensity: 1.4 }), [color]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate(plateText), roughness: 0.4 }), [plateText]);
  const metal = mats.rim;
  const tube = (a: [number, number, number], b: [number, number, number], r: number, m: THREE.Material, key: string) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return (
      <mesh key={key} position={va.clone().add(vb).multiplyScalar(0.5)} quaternion={q} material={m} castShadow>
        <cylinderGeometry args={[r, r, va.distanceTo(vb), 10]} />
      </mesh>
    );
  };
  return (
    <group ref={ref}>
      {/* front fairing: nose with twin headlights and a smoked screen */}
      <RoundedBox args={[0.5, 0.36, 0.42]} radius={0.12} smoothness={4} position={[0.62, 0.86, 0]} rotation-z={-0.38} castShadow material={paint} />
      <RoundedBox args={[0.34, 0.2, 0.3]} radius={0.08} smoothness={3} position={[0.86, 0.74, 0]} rotation-z={-0.5} castShadow material={paint} />
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0.97, 0.76, s * 0.075]} rotation-z={-0.5} material={mats.head}>
          <boxGeometry args={[0.03, 0.06, 0.1]} />
        </mesh>
      ))}
      <mesh position={[0.66, 1.08, 0]} rotation-z={-0.75} material={mats.glass}>
        <boxGeometry args={[0.3, 0.012, 0.3]} />
      </mesh>
      {/* side fairings down to the belly pan */}
      <RoundedBox args={[0.78, 0.42, 0.4]} radius={0.12} smoothness={4} position={[0.2, 0.58, 0]} castShadow material={paint} />
      <RoundedBox args={[0.7, 0.12, 0.3]} radius={0.05} smoothness={2} position={[0.12, 0.33, 0]} castShadow material={mats.black} />
      {/* tank, seat and the high tail */}
      <RoundedBox args={[0.5, 0.24, 0.36]} radius={0.1} smoothness={4} position={[0.12, 0.9, 0]} castShadow material={paint} />
      <RoundedBox args={[0.42, 0.08, 0.28]} radius={0.035} smoothness={2} position={[-0.3, 0.86, 0]} rotation-z={0.1} castShadow material={mats.seat} />
      <RoundedBox args={[0.5, 0.16, 0.22]} radius={0.06} smoothness={3} position={[-0.62, 0.92, 0]} rotation-z={0.22} castShadow material={paint} />
      <mesh position={[-0.88, 0.99, 0]} rotation-z={0.22} material={mats.tail}>
        <boxGeometry args={[0.03, 0.04, 0.16]} />
      </mesh>
      {/* plate on a hugger below the tail */}
      <mesh position={[-0.86, 0.72, 0]} rotation-y={-Math.PI / 2} rotation-x={-0.3} material={plateMat}>
        <planeGeometry args={[0.2, 0.08]} />
      </mesh>
      {/* engine block and the under-seat exhaust */}
      <RoundedBox args={[0.42, 0.32, 0.3]} radius={0.05} smoothness={2} position={[0.08, 0.44, 0]} material={mats.black} />
      {tube([0.0, 0.32, 0.12], [-0.55, 0.5, 0.17], 0.045, mats.chrome, 'pipe')}
      <mesh position={[-0.62, 0.53, 0.17]} rotation-z={Math.PI / 2 - 0.3} material={mats.black}>
        <cylinderGeometry args={[0.06, 0.055, 0.2, 14]} />
      </mesh>
      {/* upside-down forks, clip-on bars and mirrors */}
      {[-1, 1].map((s) => (
        <group key={s}>
          {tube([0.82, 0.33, s * 0.1], [0.58, 1.0, s * 0.1], 0.028, metal, `fork${s}`)}
          {tube([0.6, 1.0, s * 0.1], [0.55, 1.0, s * 0.3], 0.016, mats.black, `bar${s}`)}
          {tube([0.62, 1.05, s * 0.2], [0.66, 1.16, s * 0.27], 0.008, mats.black, `stalk${s}`)}
          <mesh position={[0.66, 1.17, s * 0.28]} material={paint}>
            <boxGeometry args={[0.04, 0.06, 0.12]} />
          </mesh>
          {/* swingarm */}
          {tube([0.02, 0.4, s * 0.12], [-0.68, 0.32, s * 0.1], 0.03, metal, `arm${s}`)}
        </group>
      ))}
      <mesh position={[-0.3, 0.6, 0]} rotation-z={0.9} material={mats.chrome}>
        <cylinderGeometry args={[0.03, 0.03, 0.4, 8]} />
      </mesh>
      {/* fat sports tyres with disc brakes */}
      <Wheel r={0.31} w={0.12} rim={0.72} position={[0.82, 0.31, 0]} />
      <Wheel r={0.32} w={0.19} rim={0.72} position={[-0.68, 0.32, 0]} />
      {[0.82, -0.68].map((x) => (
        <mesh key={x} position={[x, x > 0 ? 0.31 : 0.32, 0.075]} rotation-x={Math.PI / 2} material={mats.chrome} userData={{ wheel: x > 0 ? 0.31 : 0.32 }}>
          <cylinderGeometry args={[0.16, 0.16, 0.008, 22]} />
        </mesh>
      ))}
      <RoundedBox args={[0.4, 0.06, 0.16]} radius={0.03} smoothness={2} position={[0.82, 0.66, 0]} castShadow material={paint} />
    </group>
  );
});

/* ── Bicycle ──────────────────────────────────────────────────── */

export const Cycle = forwardRef<THREE.Group, { color: string }>(function Cycle({ color }, ref) {
  const frame = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 }), [color]);
  const tube = (a: [number, number, number], b: [number, number, number], r = 0.016, m: THREE.Material = frame, key?: string) => {
    const va = new THREE.Vector3(...a);
    const vb = new THREE.Vector3(...b);
    const mid = va.clone().add(vb).multiplyScalar(0.5);
    const len = va.distanceTo(vb);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), vb.clone().sub(va).normalize());
    return (
      <mesh key={key} position={mid} quaternion={q} material={m}>
        <cylinderGeometry args={[r, r, len, 8]} />
      </mesh>
    );
  };
  const bb: [number, number, number] = [0, 0.3, 0];
  const seatTop: [number, number, number] = [-0.18, 0.85, 0];
  const head: [number, number, number] = [0.5, 0.85, 0];
  const rear: [number, number, number] = [-0.55, 0.34, 0];
  const front: [number, number, number] = [0.6, 0.34, 0];
  return (
    <group ref={ref}>
      {tube(bb, seatTop, 0.017, frame, 'st')}
      {tube(bb, head, 0.018, frame, 'dt')}
      {tube(seatTop, head, 0.016, frame, 'tt')}
      {tube(bb, rear, 0.012, frame, 'cs')}
      {tube(seatTop, rear, 0.011, frame, 'ss')}
      {tube(head, front, 0.014, mats.chrome, 'fork')}
      {tube(head, [0.46, 1.02, 0], 0.014, mats.chrome, 'stem')}
      <mesh position={[0.46, 1.02, 0]} rotation-x={Math.PI / 2} material={mats.chrome}>
        <cylinderGeometry args={[0.012, 0.012, 0.56, 8]} />
      </mesh>
      {tube(seatTop, [-0.2, 0.95, 0], 0.012, mats.chrome, 'post')}
      <RoundedBox args={[0.26, 0.05, 0.12]} radius={0.02} smoothness={2} position={[-0.2, 0.97, 0]} material={mats.seat} />
      {/* wheels: thin tyres with spokes */}
      {[rear, front].map((p, i) => (
        <group key={i} position={p} userData={{ wheel: 0.34 }}>
          <mesh material={mats.tyre}>
            <torusGeometry args={[0.32, 0.02, 8, 36]} />
          </mesh>
          {Array.from({ length: 8 }, (_, k) => (
            <mesh key={k} rotation-z={(k / 8) * Math.PI} material={mats.rim}>
              <boxGeometry args={[0.62, 0.004, 0.004]} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
});

export function VehicleModel({ kind, color }: { kind: VehicleKind; color: string }) {
  const ref = useRef<THREE.Group>(null);
  // dozens of little parts become a handful of draw calls
  useLayoutEffect(() => (ref.current ? mergeStatic(ref.current) : undefined), [kind, color]);
  return (
    <group ref={ref}>
      {kind === 'car' ? <Car color={color} /> : kind === 'bus' ? <Bus /> : kind === 'auto' ? <Auto /> : kind === 'bike' ? <Superbike color={color} /> : <Cycle color={color} />}
    </group>
  );
}
