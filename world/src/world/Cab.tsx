import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { VehicleModel, SPECS } from './vehicleModels';
import { cab, ROAD_SPEED, useCab, type Route } from './cab';
import { canvasTexture } from './materials';
import { ui } from './interact';
import { world } from './state';
import { input } from '../player/input';
import { engine } from '../audio/sfx';

/*
 * The cab you booked: a yellow taxi that drives the route by itself, keeping left as in
 * India, slowing for bends and junctions. You sit in the front passenger seat (the
 * driver is on the right) and can look around; fast travel speeds it up.
 */

const TAXI_YELLOW = '#f2c230';
const spec = SPECS.car;
// the front passenger seat: the driver's seat mirrored to the left
const EYE = new THREE.Vector3(spec.eye[0], spec.eye[1], -spec.eye[2]);

/** Where the route is `s` metres along: position and heading. */
function along(route: Route, s: number, out: { x: number; z: number; dx: number; dz: number; cls: number }) {
  const { pts, at } = route;
  s = Math.max(0, Math.min(route.total, s));
  // binary search for the segment
  let lo = 0;
  let hi = at.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (at[mid] <= s) lo = mid;
    else hi = mid;
  }
  const a = pts[lo];
  const b = pts[Math.min(lo + 1, pts.length - 1)];
  const L = at[Math.min(lo + 1, at.length - 1)] - at[lo] || 1;
  const f = Math.min(1, (s - at[lo]) / L);
  out.x = a[0] + (b[0] - a[0]) * f;
  out.z = a[1] + (b[1] - a[1]) * f;
  const dl = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  out.dx = (b[0] - a[0]) / dl;
  out.dz = (b[1] - a[1]) / dl;
  out.cls = route.cls[Math.min(lo + 1, route.cls.length - 1)];
  return out;
}

function TaxiSign() {
  const tex = useMemo(
    () =>
      canvasTexture(128, 40, (g) => {
        g.fillStyle = '#111';
        g.fillRect(0, 0, 128, 40);
        g.fillStyle = TAXI_YELLOW;
        g.font = '800 28px Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('TAXI', 64, 21);
      }),
    []
  );
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    <mesh position={[-0.2, 1.62, 0]}>
      <boxGeometry args={[0.32, 0.18, 0.7]} />
      <meshStandardMaterial attach="material-0" color="#111" />
      <meshStandardMaterial attach="material-1" color="#111" />
      <meshStandardMaterial attach="material-2" color="#111" />
      <meshStandardMaterial attach="material-3" color="#111" />
      <meshStandardMaterial attach="material-4" map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.25} />
      <meshStandardMaterial attach="material-5" map={tex} emissive="#ffffff" emissiveMap={tex} emissiveIntensity={0.25} />
    </mesh>
  );
}

export function Cab() {
  const { status, route, to } = useCab();
  if (status !== 'coming' && status !== 'riding') return null;
  if (!route || !to) return null;
  return <CabRide route={route} />;
}

function CabRide({ route }: { route: Route }) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);
  const look = useRef({ yaw: 0, pitch: -0.05 });
  const here = useMemo(() => ({ x: 0, z: 0, dx: 1, dz: 0, cls: 4 }), []);
  const ahead = useMemo(() => ({ x: 0, z: 0, dx: 1, dz: 0, cls: 4 }), []);
  const yaw = useRef<number | null>(null);
  const eye = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);
  const last = useRef({ x: 0, z: 0, left: { x: 0, z: 0 } });
  const chase = useMemo(() => new THREE.Vector3(), []);
  const chased = useRef(false);

  // the cab pulls up, you get in
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
    engine.start('car');
    ui.toast('Your cab is here 🚕 Sit back and enjoy Kasaragod.');
    const t = window.setTimeout(() => cab.start(), 900);
    return () => {
      window.clearTimeout(t);
      engine.stop();
      // out of the cab: stand at the roadside on the left
      const { x, z, left } = last.current;
      world.riding = null;
      world.dismountAt = new THREE.Vector3(x + left.x * 2.4, 0.2, z + left.z * 2.4);
    };
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const g = group.current;
    if (!g) return;
    const s = cab.get();
    const live = cab.live;
    const riding = s.status === 'riding';

    // how fast: the road's speed, less for bends ahead, gently to a stop at the end
    along(route, live.done, here);
    along(route, live.done + 30, ahead);
    const bend = Math.abs(Math.atan2(here.dx * ahead.dz - here.dz * ahead.dx, here.dx * ahead.dx + here.dz * ahead.dz));
    let target = ROAD_SPEED[Math.min(here.cls, ROAD_SPEED.length - 1)] / 3.6;
    if (bend > 0.9) target = Math.min(target, 4.5);
    else if (bend > 0.45) target = Math.min(target, 7.5);
    else if (bend > 0.2) target = Math.min(target, 11);
    const left = route.total - live.done;
    target = Math.min(target, Math.sqrt(Math.max(0, left) * 2 * 2.2));
    if (!riding) target = 0;
    live.speed += Math.max(-4.5 * dt, Math.min(2.6 * dt, target - live.speed));
    live.done += live.speed * dt * s.fast;
    engine.speed(live.speed);

    // keep left (India): 2.2 m to the left of the road's middle
    along(route, live.done, here);
    const lx = here.dz;
    const lz = -here.dx;
    const keep = here.cls === 0 ? 3 : here.cls >= 5 ? 0.6 : 2.2;
    const x = here.x + lx * keep;
    const z = here.z + lz * keep;
    // turn smoothly toward the road's direction (vehicles face +x)
    const want = Math.atan2(-here.dz, here.dx);
    if (yaw.current === null) yaw.current = want;
    let d = want - yaw.current;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yaw.current += d * Math.min(1, dt * 4 * Math.max(1, s.fast / 2));
    g.position.set(x, 0, z);
    g.rotation.y = yaw.current;
    last.current = { x, z, left: { x: lx, z: lz } };

    // you, in the passenger seat, looking around
    if (riding) {
      const busy = !!ui.get().card || !!ui.get().book;
      if (!busy) {
        look.current.yaw = THREE.MathUtils.clamp(look.current.yaw + input.lookYaw, -2.2, 2.2);
        look.current.pitch = THREE.MathUtils.clamp(look.current.pitch + input.lookPitch, -0.8, 0.6);
      }
      input.lookYaw = 0;
      input.lookPitch = 0;
      q.setFromAxisAngle(up, yaw.current);
      eye.copy(EYE).applyQuaternion(q).add(g.position);
      if (s.view === 'inside') {
        camera.position.copy(eye);
        camera.rotation.set(look.current.pitch, yaw.current - Math.PI / 2 + look.current.yaw, 0, 'YXZ');
      } else {
        // from behind and a little above, swinging round as you look
        const around = yaw.current + look.current.yaw;
        const back = 7.5;
        const high = 3 - look.current.pitch * 4;
        chase.set(x - Math.cos(around) * back, Math.max(1.2, high), z + Math.sin(around) * back);
        if (!chased.current) camera.position.copy(chase);
        chased.current = true;
        camera.position.lerp(chase, Math.min(1, dt * 5 * s.fast));
        camera.lookAt(x + Math.cos(around) * 3, 1.3, z - Math.sin(around) * 3);
      }
      world.riding = { eye: eye.clone(), yaw: yaw.current - Math.PI / 2 };
      world.heading = yaw.current - Math.PI / 2 + look.current.yaw;
      world.avatar.set(x, 0, z);
    }

    // there
    if (riding && live.done >= route.total - 0.3) {
      const to = s.to;
      cab.end();
      if (to) ui.toast(to.home ? `Back at Electrosparkzz ${to.e}` : `Welcome to ${to.n}! ${to.e}`);
    }
  });

  return (
    <group ref={group}>
      <VehicleModel kind="car" color={TAXI_YELLOW} />
      <TaxiSign />
    </group>
  );
}
