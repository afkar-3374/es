import * as THREE from 'three';
import { forwardRef, useLayoutEffect, useMemo, useRef } from 'react';
import { mergeStatic } from './merge';
import { RoundedBox } from '@react-three/drei';
import { canvasTexture } from './materials';

/*
 * Vehicles at real size. Every model faces +x (forward), y is up, +z is its right-hand
 * side. Wheels are tagged `userData.wheel = radius` so they can be spun.
 */
export type VehicleKind = 'car' | 'auto' | 'bike' | 'cycle';

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
};

/** Make headlights and tail lights glow (0 = day … 1 = night). */
export function setVehicleLights(night: number) {
  mats.head.emissiveIntensity = 0.2 + night * 3;
  mats.tail.emissiveIntensity = 0.25 + night * 1.6;
}

function Wheel({ r, w, position, rim = 0.6 }: { r: number; w: number; position: [number, number, number]; rim?: number }) {
  return (
    <group position={position} userData={{ wheel: r }}>
      <mesh rotation-x={Math.PI / 2} material={mats.tyre}>
        <cylinderGeometry args={[r, r, w, 22]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 0, (s * w) / 2 + s * 0.002]} rotation-x={Math.PI / 2} material={mats.rim}>
          <cylinderGeometry args={[r * rim, r * rim, 0.004, 18]} />
        </mesh>
      ))}
    </group>
  );
}

/* ── Car: a small hatchback ─────────────────────────────────────── */

export const Car = forwardRef<THREE.Group, { color: string; plateText?: string }>(function Car({ color, plateText = 'KL 14 A 2026' }, ref) {
  const paint = useMemo(() => new THREE.MeshStandardMaterial({ color, roughness: 0.25, metalness: 0.55, envMapIntensity: 1.3 }), [color]);
  const plateMat = useMemo(() => new THREE.MeshStandardMaterial({ map: plate(plateText), roughness: 0.4 }), [plateText]);
  return (
    <group ref={ref}>
      {/* lower body and bonnet */}
      <RoundedBox args={[3.85, 0.62, 1.7]} radius={0.16} smoothness={4} position={[0, 0.62, 0]} castShadow receiveShadow material={paint} />
      {/* cabin: pillars, roof and glass */}
      <RoundedBox args={[2.05, 0.08, 1.48]} radius={0.04} smoothness={2} position={[-0.3, 1.45, 0]} castShadow material={paint} />
      <mesh position={[-0.28, 1.17, 0]} material={mats.glass}>
        <boxGeometry args={[2.02, 0.5, 1.5]} />
      </mesh>
      {/* windscreen and rear glass, raked */}
      <mesh position={[0.86, 1.17, 0]} rotation-z={-0.62} material={mats.glass}>
        <boxGeometry args={[0.04, 0.62, 1.44]} />
      </mesh>
      {/* pillars */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[0.82, 1.17, s * 0.73]} rotation-z={-0.62} material={paint}>
            <boxGeometry args={[0.06, 0.62, 0.05]} />
          </mesh>
          <mesh position={[-1.27, 1.17, s * 0.73]} rotation-z={0.35} material={paint}>
            <boxGeometry args={[0.1, 0.58, 0.05]} />
          </mesh>
          <mesh position={[-0.25, 1.17, s * 0.745]} material={paint}>
            <boxGeometry args={[0.06, 0.52, 0.02]} />
          </mesh>
          {/* mirrors */}
          <mesh position={[0.62, 1.0, s * 0.92]} material={paint}>
            <boxGeometry args={[0.1, 0.1, 0.16]} />
          </mesh>
        </group>
      ))}
      {/* inside: dashboard and steering wheel on the right (Indian cars are right-hand drive) */}
      <mesh position={[0.66, 0.9, 0]} material={mats.black}>
        <boxGeometry args={[0.36, 0.1, 1.5]} />
      </mesh>
      {/* steering wheel, facing the driver and tilted like a real one */}
      <group position={[0.4, 0.93, 0.36]} rotation-z={0.45}>
        <mesh rotation-y={Math.PI / 2} material={mats.black}>
          <torusGeometry args={[0.17, 0.018, 8, 28]} />
        </mesh>
        <mesh rotation-z={Math.PI / 2} material={mats.black}>
          <cylinderGeometry args={[0.035, 0.035, 0.06, 12]} />
        </mesh>
      </group>
      <mesh position={[-0.05, 0.75, 0.36]} material={mats.seat}>
        <boxGeometry args={[0.5, 0.15, 0.5]} />
      </mesh>
      <mesh position={[-0.05, 0.75, -0.36]} material={mats.seat}>
        <boxGeometry args={[0.5, 0.15, 0.5]} />
      </mesh>
      {/* lights, grille, bumpers, plates */}
      {[-1, 1].map((s) => (
        <group key={s}>
          <mesh position={[1.92, 0.78, s * 0.58]} material={mats.head}>
            <boxGeometry args={[0.04, 0.13, 0.32]} />
          </mesh>
          <mesh position={[-1.92, 0.82, s * 0.62]} material={mats.tail}>
            <boxGeometry args={[0.04, 0.18, 0.22]} />
          </mesh>
        </group>
      ))}
      <mesh position={[1.93, 0.6, 0]} material={mats.black}>
        <boxGeometry args={[0.03, 0.14, 0.8]} />
      </mesh>
      <mesh position={[1.945, 0.42, 0]} rotation-y={Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.52, 0.12]} />
      </mesh>
      <mesh position={[-1.945, 0.55, 0]} rotation-y={-Math.PI / 2} material={plateMat}>
        <planeGeometry args={[0.52, 0.12]} />
      </mesh>
      {[1.25, -1.25].flatMap((x) => [-0.72, 0.72].map((z) => <Wheel key={`${x}${z}`} r={0.3} w={0.2} position={[x, 0.3, z]} />))}
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
      {kind === 'car' ? <Car color={color} /> : kind === 'auto' ? <Auto /> : kind === 'bike' ? <Superbike color={color} /> : <Cycle color={color} />}
    </group>
  );
}
