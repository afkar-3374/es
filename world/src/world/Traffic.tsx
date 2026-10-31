import * as THREE from 'three';
import { Suspense, useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { VehicleModel, SPECS, type VehicleKind } from './vehicleModels';
import { wanderRoute, ROAD_SPEED, type Route } from './cab';
import { along } from './Cab';
import { getMeta, groundAt } from './map';
import { world } from './state';
import { useQuality } from './quality';
import { Rider } from './Vehicles';
import { game } from '../game/store';

/*
 * Traffic: cars, cabs, autos, bikes and KSRTC buses driving Kasaragod's real roads around you, keeping left,
 * slowing for bends, and stopping for anyone (or anything) in the way. Each drives a few
 * hundred metres of random turns, then another starts somewhere else nearby.
 */

const COLORS = ['#c9cdd2', '#f4f4f2', '#2b2f36', '#8b1e22', '#1f4e8c', '#7a7f86', '#b7a27a', '#2e5e3a', '#d2d4d6'];
const KINDS: VehicleKind[] = ['car', 'auto', 'bus', 'bike', 'car', 'auto', 'car', 'bike', 'auto', 'bus', 'car', 'car'];
/** every third car is a cab (yellow, as the cab you can book) */
const CAB_YELLOW = '#f2c230';
/** how many, by graphics level */
const COUNT = [6, 12, 18];
/** start this far from you (out of sight, mostly), and stop past this */
const SPAWN = [140, 420];
const GONE = 520;

interface Driver {
  kind: VehicleKind;
  route: Route;
  done: number;
  speed: number;
  x: number;
  z: number;
  dx: number;
  dz: number;
  yaw: number;
  /** buses: where along the route the stops are, the next one, and how long it's been waiting */
  stops: number[];
  next: number;
  wait: number;
  /** when this driver can next hit someone (ms, performance.now) */
  hitAt?: number;
}

/** Bus stops beside this route (metres along it). */
function stopsOn(route: Route) {
  const all = getMeta()?.busStops ?? [];
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of route.pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const out: number[] = [];
  for (const [sx, sz] of all) {
    if (sx < x0 - 20 || sx > x1 + 20 || sz < z0 - 20 || sz > z1 + 20) continue;
    let best = Infinity;
    let at = 0;
    for (let k = 0; k < route.pts.length; k++) {
      const d = Math.hypot(route.pts[k][0] - sx, route.pts[k][1] - sz);
      if (d < best) {
        best = d;
        at = route.at[k];
      }
    }
    // on this side of the road (a bus keeps left: the stop is on its left)
    if (best < 16) out.push(at);
  }
  return out.sort((a, b) => a - b);
}

/** Everyone driving now (to keep a distance from the one ahead). */
const drivers = new Set<Driver>();
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esTraffic: drivers });

const here = { x: 0, z: 0, dx: 0, dz: 0, cls: 4 };
const ahead = { x: 0, z: 0, dx: 0, dz: 0, cls: 4 };

function Vehicle({ seed }: { seed: number }) {
  const kind = KINDS[seed % KINDS.length];
  const color = kind === 'car' && seed % 3 === 0 ? CAB_YELLOW : COLORS[(seed * 7) % COLORS.length];
  const spec = SPECS[kind];
  const [d, setD] = useState<Driver | null>(null);
  const body = useRef<RapierRigidBody>(null);
  const g = useRef<THREE.Group>(null);
  const busy = useRef(false);

  // a new drive, when this one ends or wanders off
  const start = () => {
    if (busy.current) return;
    busy.current = true;
    const p = world.player;
    wanderRoute(p.x, p.z, SPAWN[1], SPAWN[0], 900).then((route) => {
      busy.current = false;
      if (!route) return;
      const next: Driver = { kind, stops: kind === 'bus' ? stopsOn(route) : [], next: 0, wait: 0, route, done: 0, speed: 6, x: route.pts[0][0], z: route.pts[0][1], dx: 1, dz: 0, yaw: 0 };
      along(route, 0, here);
      next.yaw = Math.atan2(-here.dz, here.dx);
      setD(next);
    });
  };
  useEffect(() => {
    const t = setTimeout(start, 400 + seed * 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!d) return;
    drivers.add(d);
    return () => void drivers.delete(d);
  }, [d]);

  useFrame((_, delta) => {
    if (!d || !g.current) return;
    const dt = Math.min(delta, 0.1);
    const p = world.player;
    if (d.done >= d.route.total - 1 || Math.hypot(d.x - p.x, d.z - p.z) > GONE) {
      setD(null);
      start();
      return;
    }
    along(d.route, d.done, here);
    along(d.route, d.done + 25, ahead);
    const bend = Math.abs(Math.atan2(here.dx * ahead.dz - here.dz * ahead.dx, here.dx * ahead.dx + here.dz * ahead.dz));
    let target = ROAD_SPEED[Math.min(here.cls, ROAD_SPEED.length - 1)] / 3.6 * (kind === 'auto' ? 0.7 : kind === 'bus' ? 0.75 : kind === 'bike' ? 1.05 : 0.9);
    if (bend > 0.9) target = Math.min(target, 4);
    else if (bend > 0.45) target = Math.min(target, 7);
    else if (bend > 0.2) target = Math.min(target, 10);
    // anyone in the way? (people, your vehicle, the vehicle ahead in this lane)
    const block = (ox: number, oz: number, room: number) => {
      const rx = ox - d.x;
      const rz = oz - d.z;
      const fwd = rx * here.dx + rz * here.dz;
      const side = Math.abs(rx * here.dz - rz * here.dx);
      if (fwd > 0 && fwd < 22 + spec.half[0] && side < room) target = Math.min(target, Math.max(0, (fwd - 4 - spec.half[0]) * 0.6));
    };
    block(p.x, p.z, 2.6);
    const v = world.vehicle;
    if (v && !(v.x === 0 && v.z === 0)) block(v.x, v.z, 2.8);
    for (const o of drivers) if (o !== d) block(o.x, o.z, 2.2);
    // buses pull in at each stop for a few seconds
    while (d.next < d.stops.length && d.stops[d.next] < d.done - 3) d.next++;
    if (d.next < d.stops.length) {
      const to = d.stops[d.next] - d.done;
      if (to < 30) target = Math.min(target, Math.max(0, to * 0.45));
      if (to < 1.5 && d.speed < 0.6) {
        d.wait += dt;
        target = 0;
        if (d.wait > 7) {
          d.wait = 0;
          d.next++;
        }
      }
    }
    d.speed += Math.max(-6 * dt, Math.min(2.4 * dt, target - d.speed));
    d.done += Math.max(0, d.speed) * dt;
    along(d.route, d.done, here);
    // keep left (India)
    const keep = here.cls === 0 ? 3.2 : here.cls >= 5 ? 0.8 : kind === 'bus' ? 1.7 : kind === 'car' ? 1.9 : 2.4;
    d.x = here.x + here.dz * keep;
    d.z = here.z - here.dx * keep;
    // a moving vehicle right beside you is an accident (walking into the road, mostly)
    const now = performance.now();
    if (!world.riding && d.speed > 2.5 && (d.hitAt ?? 0) < now && Math.hypot(d.x - p.x, d.z - p.z) < 1.6) {
      d.hitAt = now + 8000;
      game.hit(d.kind);
    }
    d.dx = here.dx;
    d.dz = here.dz;
    const want = Math.atan2(-here.dz, here.dx);
    let turn = want - d.yaw;
    turn = Math.atan2(Math.sin(turn), Math.cos(turn));
    d.yaw += turn * Math.min(1, dt * 4);
    const y = groundAt(d.x, d.z);
    g.current.position.set(d.x, y, d.z);
    g.current.rotation.y = d.yaw;
    body.current?.setNextKinematicTranslation({ x: d.x, y: y + spec.half[1], z: d.z });
    body.current?.setNextKinematicRotation(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), d.yaw));
  });

  if (!d) return null;
  return (
    <>
      <group ref={g}>
        <VehicleModel kind={kind} color={color} />
        {kind === 'bike' && (
          <Suspense fallback={null}>
            <Rider kind={kind} look={seed % 8} shown={() => true} />
          </Suspense>
        )}
      </group>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[d.x, groundAt(d.x, d.z) + spec.half[1], d.z]}>
        <CuboidCollider args={spec.half as unknown as [number, number, number]} />
      </RigidBody>
    </>
  );
}

export function Traffic() {
  const { level } = useQuality();
  return (
    <>
      {Array.from({ length: COUNT[level] }, (_, i) => (
        <Vehicle key={i} seed={i + 1} />
      ))}
    </>
  );
}
