import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import { canvasTexture } from './materials';
import { noRaycast } from './merge';
import { getMeta, groundAt } from './map';
import { world } from './state';

/*
 * Trains on the Mangaluru–Kasaragod–Kanhangad line: an electric locomotive (WAP-7 colours)
 * and a rake of blue coaches, running along the real tracks (meta.railLines) at express
 * speed whenever you're within reach of the railway, every minute or two.
 */

const COACHES = 12;
const LOCO = 20.6;
const COACH = 23.4;
const SPEED = 24; // m/s (about 85 km/h)
const NEAR = 1600;

interface Line {
  pts: [number, number][];
  at: number[];
  total: number;
}

function lines(): Line[] {
  const raw = (getMeta() as { railLines?: [number, number][][] } | null)?.railLines ?? [];
  return raw.map((pts) => {
    const at = [0];
    for (let i = 1; i < pts.length; i++) at.push(at[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    return { pts, at, total: at[at.length - 1] };
  });
}

/** Where the line is `s` metres along it. */
function pointAt(l: Line, s: number, out: { x: number; z: number }) {
  s = Math.max(0, Math.min(l.total, s));
  let lo = 0;
  let hi = l.at.length - 1;
  while (hi - lo > 1) {
    const m = (lo + hi) >> 1;
    if (l.at[m] <= s) lo = m;
    else hi = m;
  }
  const a = l.pts[lo];
  const b = l.pts[Math.min(lo + 1, l.pts.length - 1)];
  const f = Math.min(1, (s - l.at[lo]) / (l.at[lo + 1] - l.at[lo] || 1));
  out.x = a[0] + (b[0] - a[0]) * f;
  out.z = a[1] + (b[1] - a[1]) * f;
  return out;
}

/** The nearest point of a line to (x, z): metres along it and how far off. */
function nearest(l: Line, x: number, z: number) {
  let best = Infinity;
  let at = 0;
  for (let i = 0; i < l.pts.length; i += 2) {
    const d = Math.hypot(l.pts[i][0] - x, l.pts[i][1] - z);
    if (d < best) {
      best = d;
      at = l.at[i];
    }
  }
  return { at, d: best };
}

const mats = {
  bogie: new THREE.MeshStandardMaterial({ color: '#1d1e20', roughness: 0.8 }),
  roof: new THREE.MeshStandardMaterial({ color: '#7d8186', roughness: 0.6, metalness: 0.4 }),
  white: new THREE.MeshStandardMaterial({ color: '#eceae4', roughness: 0.45 }),
  red: new THREE.MeshStandardMaterial({ color: '#b3202a', roughness: 0.4 }),
  glass: new THREE.MeshStandardMaterial({ color: '#16212a', roughness: 0.1, metalness: 0.4 }),
  head: new THREE.MeshStandardMaterial({ color: '#fff7e0', emissive: '#fff1c9', emissiveIntensity: 1 }),
};

function coachSide() {
  return canvasTexture(1024, 160, (g) => {
    g.fillStyle = '#1d4f91';
    g.fillRect(0, 0, 1024, 160);
    g.fillStyle = '#e9d9a6';
    g.fillRect(0, 34, 1024, 8);
    g.fillRect(0, 112, 1024, 6);
    // windows with their bars, and a door at each end
    for (let x = 90; x < 930; x += 54) {
      g.fillStyle = '#1a2229';
      g.fillRect(x, 50, 38, 44);
      g.fillStyle = 'rgba(200,200,200,0.5)';
      for (let b = x + 6; b < x + 38; b += 7) g.fillRect(b, 50, 2, 44);
    }
    g.fillStyle = '#163c70';
    g.fillRect(20, 40, 46, 110);
    g.fillRect(958, 40, 46, 110);
    g.fillStyle = '#e9d9a6';
    g.font = '700 18px Arial, sans-serif';
    g.fillText('INDIAN RAILWAYS', 420, 140);
  });
}

function Bogies({ length }: { length: number }) {
  return (
    <>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (length / 2 - 3.2), 0.55, 0]}>
          <mesh material={mats.bogie}>
            <boxGeometry args={[3.0, 0.7, 2.4]} />
          </mesh>
          {[-0.9, 0.9].flatMap((x) =>
            [-0.76, 0.76].map((z) => (
              <mesh key={`${x}${z}`} position={[x, -0.1, z]} rotation-x={Math.PI / 2} material={mats.bogie}>
                <cylinderGeometry args={[0.46, 0.46, 0.14, 14]} />
              </mesh>
            ))
          )}
        </group>
      ))}
    </>
  );
}

function Coach({ side }: { side: THREE.Material }) {
  return (
    <group>
      <Bogies length={COACH - 0.7} />
      <mesh position={[0, 2.45, 0]} material={mats.bogie} castShadow>
        <boxGeometry args={[COACH - 0.8, 2.9, 3.1]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 2.5, s * 1.56]} rotation-y={s === 1 ? 0 : Math.PI} material={side}>
          <planeGeometry args={[COACH - 0.9, 2.6]} />
        </mesh>
      ))}
      <RoundedBox args={[COACH - 0.8, 0.5, 3.1]} radius={0.24} smoothness={3} position={[0, 3.95, 0]} material={mats.roof} castShadow />
    </group>
  );
}

function Loco() {
  return (
    <group>
      <Bogies length={LOCO} />
      <mesh position={[0, 2.5, 0]} material={mats.white} castShadow>
        <boxGeometry args={[LOCO - 2.6, 3.0, 3.05]} />
      </mesh>
      {/* the cabs at both ends: sloped noses, windscreens, headlights */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * (LOCO / 2 - 1.3), 0, 0]}>
          <mesh position={[0, 2.5, 0]} material={mats.white}>
            <boxGeometry args={[2.6, 3.0, 3.05]} />
          </mesh>
          <mesh position={[s * 1.05, 3.35, 0]} rotation-z={-s * 0.32} material={mats.glass}>
            <boxGeometry args={[0.6, 1.1, 2.7]} />
          </mesh>
          <mesh position={[s * 1.31, 1.6, 0]} material={mats.red}>
            <boxGeometry args={[0.04, 0.9, 3.0]} />
          </mesh>
          <mesh position={[s * 1.33, 4.0, 0]} material={mats.head}>
            <boxGeometry args={[0.05, 0.22, 0.4]} />
          </mesh>
        </group>
      ))}
      {/* red bands along the sides, roof and pantograph */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[0, 1.7, s * 1.535]} material={mats.red}>
          <boxGeometry args={[LOCO - 0.2, 0.5, 0.02]} />
        </mesh>
      ))}
      <RoundedBox args={[LOCO - 0.4, 0.4, 3.0]} radius={0.18} smoothness={3} position={[0, 4.1, 0]} material={mats.roof} castShadow />
      <group position={[-3, 4.4, 0]}>
        <mesh rotation-z={0.5} position={[0.5, 0.45, 0]} material={mats.bogie}>
          <boxGeometry args={[1.4, 0.06, 0.06]} />
        </mesh>
        <mesh position={[1.1, 0.8, 0]} material={mats.bogie}>
          <boxGeometry args={[0.1, 0.05, 1.6]} />
        </mesh>
      </group>
    </group>
  );
}

export function Train() {
  const side = useMemo(() => new THREE.MeshStandardMaterial({ map: coachSide(), roughness: 0.45 }), []);
  const cars = useRef<(THREE.Group | null)[]>([]);
  const root = useRef<THREE.Group>(null);
  const run = useRef<{ line: Line; s: number; dir: number; end: number } | null>(null);
  const wait = useRef(8);
  const all = useRef<Line[] | null>(null);
  const a = useMemo(() => ({ x: 0, z: 0 }), []);
  const b = useMemo(() => ({ x: 0, z: 0 }), []);
  // (previews: ?debug can move the train)
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esTrain: run, esTrainWait: wait });
  const offsets = useMemo(() => [LOCO / 2, ...Array.from({ length: COACHES }, (_, i) => LOCO + 0.7 + i * (COACH + 0.7) + COACH / 2)], []);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    if (!root.current) return;
    if (!all.current?.length) {
      all.current = lines();
      if (!all.current.length) return;
    }
    const p = world.player;
    const r = run.current;
    if (!r) {
      root.current.visible = false;
      wait.current -= dt;
      if (wait.current > 0) return;
      wait.current = 3;
      // the nearest line, if you're near the railway
      let pick: { line: Line; at: number; d: number } | null = null;
      for (const line of all.current) {
        const n = nearest(line, p.x, p.z);
        if (!pick || n.d < pick.d) pick = { line, ...n };
      }
      if (!pick || pick.d > NEAR) return;
      // (up trains on one line, down trains on the other)
      const dir = all.current.indexOf(pick.line) % 2 ? -1 : 1;
      const start = Math.max(0, Math.min(pick.line.total, pick.at - dir * 1400));
      run.current = { line: pick.line, s: start, dir, end: pick.at + dir * 1800 };
      return;
    }
    r.s += r.dir * SPEED * dt;
    const past = r.dir > 0 ? r.s > r.end || r.s > r.line.total : r.s < r.end || r.s < 0;
    if (past) {
      run.current = null;
      wait.current = 45 + Math.random() * 60;
      return;
    }
    root.current.visible = true;
    offsets.forEach((o, i) => {
      const g = cars.current[i];
      if (!g) return;
      const c = r.s - r.dir * o;
      pointAt(r.line, c + r.dir * 8, a);
      pointAt(r.line, c - r.dir * 8, b);
      const x = (a.x + b.x) / 2;
      const z = (a.z + b.z) / 2;
      g.position.set(x, groundAt(x, z) + 0.12, z);
      g.rotation.y = Math.atan2(-(a.z - b.z), a.x - b.x);
    });
  });

  return (
    <group ref={root} visible={false}>
      {offsets.map((_, i) => (
        <group key={i} ref={(g) => (cars.current[i] = g)} raycast={noRaycast}>
          {i === 0 ? <Loco /> : <Coach side={side} />}
        </group>
      ))}
    </group>
  );
}
