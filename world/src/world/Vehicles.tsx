import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { SPECS, setVehicleLights, VehicleModel, type VehicleKind } from './vehicleModels';
import { applyPose, bakedPerson, SEATED, usePersonSource } from './people';
import { ui, type Interactable } from './interact';
import { world } from './state';
import { junctions, roadById } from './layout';
import { me, peers } from '../net/net';
import { isTouch } from '../player/input';
import { input } from '../player/input';
import { ride } from './ride';
import { engine, horn } from '../audio/sfx';
import type { Conditions } from '../env/kasaragod';

/*
 * Traffic around town (keeping left, as in India) and the vehicle each visitor can
 * call up and ride. Every road runs along x or z; on an east–west road eastbound (+x)
 * traffic keeps to the north half, on a north–south road southbound (+z) traffic keeps
 * to the east half.
 */
const CROSSING = { x0: -2.6, x1: 2.6, z0: 4.6, z1: 15.4 };

/* ── Which vehicles are on the road (more at rush hour, few at night) ── */

interface Npc {
  kind: VehicleKind;
  color: string;
  road: string;
  dir: 1 | -1;
  /** distance of the lane from the road's centre line (always on the left) */
  off: number;
  cruise: number; // m/s
  start: number; // starting position along the road
  order: number; // lower = still out at quiet times
}

const NPCS: Npc[] = [
  { kind: 'car', color: '#c0392b', road: 'main', dir: 1, off: 2.7, cruise: 9.5, start: -150, order: 0 },
  { kind: 'auto', color: '', road: 'main', dir: -1, off: 2.7, cruise: 7, start: 120, order: 1 },
  { kind: 'scooter', color: '#2d6cdf', road: 'main', dir: 1, off: 3.8, cruise: 8, start: -40, order: 2 },
  { kind: 'car', color: '#ecf0f1', road: 'main', dir: -1, off: 2.6, cruise: 10, start: -20, order: 3 },
  { kind: 'auto', color: '', road: 'main', dir: 1, off: 2.8, cruise: 7, start: 60, order: 4 },
  { kind: 'scooter', color: '#e84393', road: 'main', dir: -1, off: 3.8, cruise: 8.5, start: 160, order: 5 },
  { kind: 'cycle', color: '#16a085', road: 'main', dir: 1, off: 4.1, cruise: 4, start: 20, order: 6 },
  { kind: 'car', color: '#34495e', road: 'main', dir: 1, off: 2.7, cruise: 9, start: 130, order: 7 },
  { kind: 'scooter', color: '#f39c12', road: 'main', dir: -1, off: 3.7, cruise: 7.5, start: 40, order: 8 },
  { kind: 'car', color: '#7f8c8d', road: 'main', dir: -1, off: 2.6, cruise: 10.5, start: -110, order: 9 },
  // around town
  { kind: 'auto', color: '', road: 'coast', dir: 1, off: 2.2, cruise: 7.5, start: -120, order: 1 },
  { kind: 'car', color: '#1f6f8b', road: 'coast', dir: -1, off: 2.2, cruise: 10, start: 150, order: 3 },
  { kind: 'scooter', color: '#8e44ad', road: 'coast', dir: 1, off: 3.2, cruise: 8, start: 60, order: 5 },
  { kind: 'scooter', color: '#d35400', road: 'west', dir: 1, off: 2, cruise: 7.5, start: -60, order: 2 },
  { kind: 'auto', color: '', road: 'west', dir: -1, off: 2, cruise: 6.5, start: 80, order: 6 },
  { kind: 'car', color: '#f1c40f', road: 'east', dir: -1, off: 2, cruise: 8.5, start: 40, order: 2 },
  { kind: 'cycle', color: '#c0392b', road: 'east', dir: 1, off: 3, cruise: 4, start: -40, order: 7 },
  { kind: 'car', color: '#95a5a6', road: 'north', dir: 1, off: 2, cruise: 9, start: -100, order: 4 },
  { kind: 'scooter', color: '#27ae60', road: 'south', dir: -1, off: 2, cruise: 8, start: 50, order: 4 },
];

/** Share of the traffic out right now, by the hour in Kasaragod. */
function busyness(c: Conditions) {
  const h = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false }).format(c.now));
  const curve = [0.15, 0.1, 0.1, 0.1, 0.15, 0.3, 0.55, 0.8, 1, 1, 0.85, 0.75, 0.75, 0.7, 0.7, 0.75, 0.85, 1, 1, 0.9, 0.7, 0.5, 0.35, 0.2];
  return curve[h] ?? 0.6;
}

/** Colours for visitors' own vehicles */
const PAINT = ['#e84393', '#2d6cdf', '#16a085', '#f39c12', '#c0392b', '#8e44ad', '#f5f6fa', '#2c3e50', '#d35400', '#27ae60'];

/** Live positions of everything on wheels and everyone walking on a road, for keeping distance. */
const live = {
  npcs: [] as { x: number; z: number; road: string }[],
};

/** Things a driver must not hit: you, other visitors and their vehicles. */
function obstacles(): { x: number; z: number; parked: boolean; walker: boolean }[] {
  const list: { x: number; z: number; parked: boolean; walker: boolean }[] = [];
  const p = world.player;
  if (p.y < 1.2 && !world.riding) list.push({ x: p.x, z: p.z, parked: false, walker: true });
  const v = world.vehicle;
  if (v) list.push({ x: v.x, z: v.z, parked: Math.abs(v.speed) < 0.1 && !v.ridden, walker: false });
  for (const peer of peers.values()) {
    if (peer.mode === 0 && peer.y < 1.2) list.push({ x: peer.x, z: peer.z, parked: false, walker: true });
    const pv = peer.vehicle;
    if (pv) list.push({ x: pv.x, z: pv.z, parked: Math.abs(pv.speed) < 0.1 && !pv.ridden, walker: false });
  }
  return list;
}

export function Vehicles({ c }: { c: Conditions }) {
  const share = busyness(c);
  useFrame(() => setVehicleLights(world.night));
  const [mine, setMine] = useState<{ kind: VehicleKind; color: string; at: [number, number, number]; yaw: number; n: number } | null>(null);
  const { world: physics, rapier } = useRapier();

  // calling your vehicle: it appears just in front of you, side-on
  useEffect(() => {
    ride.call = (kind) => {
      if (ui.get().riding) return ui.toast('Get off first, then call another vehicle.');
      const p = world.player;
      const h = world.heading;
      const fwd = { x: -Math.sin(h), z: -Math.cos(h) };
      const right = { x: Math.cos(h), z: -Math.sin(h) };
      const spec = SPECS[kind];
      // is there room for it here? (a box the size of the vehicle, a little off the ground)
      const free = (x: number, z: number) =>
        !physics.intersectionWithShape(
          { x, y: Math.max(p.y, 0) + spec.half[1] + 0.25, z },
          new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h + Math.PI / 2),
          new rapier.Cuboid(spec.half[0] + 0.15, spec.half[1] - 0.2, spec.half[2] + 0.15),
          undefined,
          undefined,
          undefined,
          undefined,
          (col) => col.parent()?.bodyType() === rapier.RigidBodyType.Fixed
        );
      // beside you on the right, facing the way you look (so you can just ride off); else the left; else ahead
      const spots = [
        [right.x * 2.3 + fwd.x * 0.8, right.z * 2.3 + fwd.z * 0.8],
        [-right.x * 2.3 + fwd.x * 0.8, -right.z * 2.3 + fwd.z * 0.8],
        [fwd.x * (spec.half[0] + 1.6), fwd.z * (spec.half[0] + 1.6)],
      ];
      const spot = spots.find(([dx, dz]) => free(p.x + dx, p.z + dz));
      if (!spot) return ui.toast('No room here. Step out somewhere more open and try again.');
      const hash = [...me.id].reduce((a, ch) => a + ch.charCodeAt(0), 0);
      // vehicles face +x in their own space; your heading 0 looks towards −z
      setMine((m) => ({ kind, color: PAINT[hash % PAINT.length], at: [p.x + spot[0], Math.max(p.y, 0), p.z + spot[1]], yaw: h + Math.PI / 2, n: (m?.n ?? 0) + 1 }));
      ui.toast(`Your ${spec.name.toLowerCase()} is here! ${spec.emoji} Walk up and ${isTouch ? 'tap' : 'click'} it to ride.`);
    };
  }, [physics, rapier]);

  return (
    <group>
      {NPCS.map((n, i) => (
        <TrafficVehicle key={i} index={i} npc={n} on={n.order < Math.max(1, Math.round(10 * share))} />
      ))}
      {mine && <MyVehicle key={mine.n} kind={mine.kind} color={mine.color} home={mine.at} yaw={mine.yaw} />}
    </group>
  );
}

/* ── Traffic ─────────────────────────────────────────────────── */

function TrafficVehicle({ index, npc, on }: { index: number; npc: Npc; on: boolean }) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const spec = SPECS[npc.kind];
  const road = roadById(npc.road);
  const alongX = road.axis === 'x';
  // keep left: see the note at the top
  const laneC = road.c + (alongX ? -npc.dir : npc.dir) * npc.off;
  const yaw = alongX ? (npc.dir === 1 ? 0 : Math.PI) : npc.dir === 1 ? -Math.PI / 2 : Math.PI / 2;
  const ends = [road.from + 6, road.to - 6];
  const crossings = useMemo(() => junctions(road).filter((j) => j.at > ends[0] && j.at < ends[1]), [road]);
  const state = useRef({ s: npc.start, speed: npc.cruise, offset: 0, blocked: 0, honked: 0, shadow: true });
  const wheels = useRef<{ o: THREE.Object3D; r: number }[]>([]);
  const riderRef = useRef<THREE.Object3D>(null);
  const rot = useMemo(() => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), [yaw]);

  useEffect(() => {
    wheels.current = [];
    group.current?.traverse((o) => {
      if (o.userData.wheel) wheels.current.push({ o, r: o.userData.wheel });
      o.userData.castShadowWas = o.castShadow;
    });
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const g = group.current;
    if (!g) return;
    const st = state.current;
    g.visible = on;
    if (!on) {
      body.current?.setNextKinematicTranslation({ x: 0, y: -60 - index * 5, z: 0 });
      live.npcs[index] = { x: 9999, z: 9999, road: npc.road };
      return;
    }

    // what's ahead in this lane? (people, vehicles, the crossing, a junction to give way at)
    const lane = laneC + (alongX ? -npc.dir : npc.dir) * st.offset;
    let gap = Infinity;
    let parkedAhead = false; // the nearest thing ahead is a vehicle someone left on the road
    const ahead = (x: number, z: number, width = 1.7, parked = false) => {
      const a = alongX ? x : z;
      const across = alongX ? z : x;
      if (Math.abs(across - lane) > width) return;
      const d = (a - st.s) * npc.dir;
      if (d > 0 && d < gap) {
        gap = d;
        parkedAhead = parked;
      }
    };
    const onThisRoad = (x: number, z: number) => Math.abs((alongX ? z : x) - road.c) < road.w / 2;
    for (const o of obstacles()) if (!o.walker || onThisRoad(o.x, o.z)) ahead(o.x, o.z, o.walker ? 1.9 : 1.7, o.parked);
    const p = world.player;
    // someone on or about to step onto the zebra crossing: stop before it
    if (npc.road === 'main' && p.y < 1.2 && p.x > CROSSING.x0 && p.x < CROSSING.x1 && p.z > CROSSING.z0 && p.z < CROSSING.z1) {
      const stopLine = npc.dir === 1 ? CROSSING.x0 - 1.5 : CROSSING.x1 + 1.5;
      const d = (stopLine - st.s) * npc.dir;
      if (d > -spec.half[0] && d < gap) gap = d + 3.5;
    }
    live.npcs.forEach((o, j) => j !== index && ahead(o.x, o.z));
    // side roads give way to the main street
    if (npc.road !== 'main') {
      for (const j of crossings) {
        const stopAt = j.at - npc.dir * (j.half + spec.half[0] + 1.5);
        const d = (stopAt - st.s) * npc.dir;
        if (d < -0.5 || d > 25) continue;
        const busy = live.npcs.some((o) => {
          const other = roadById(o.road);
          if (other.axis === road.axis || Math.abs(other.c - j.at) > 1) return false;
          return Math.abs((other.axis === 'x' ? o.x : o.z) - road.c) < 22;
        });
        if (busy && d + 3.5 < gap) gap = d + 3.5;
      }
    }

    const safe = gap - spec.half[0] * 2 - 2.5;
    const want = Math.max(0, Math.min(npc.cruise, safe * 0.9));
    const rate = want < st.speed ? 6 : 2;
    st.speed += (want - st.speed) * Math.min(rate * dt, 1);
    if (st.speed < 0.05 && safe < 2) st.blocked += dt;
    else st.blocked = Math.max(0, st.blocked - dt * 2);

    const x = alongX ? st.s : lane;
    const z = alongX ? lane : st.s;
    // stuck behind something for a while: honk, then edge round it
    if (st.blocked > 2.5 && performance.now() - st.honked > 6000) {
      st.honked = performance.now();
      horn(npc.kind, Math.max(0, 1 - Math.hypot(p.x - x, p.z - z) / 45));
    }
    const targetOffset = st.blocked > 5 && parkedAhead ? -1.9 : st.blocked > 0.5 ? st.offset : 0;
    st.offset += (targetOffset - st.offset) * Math.min(dt * 0.6, 1);

    st.s += st.speed * npc.dir * dt;
    if (npc.dir === 1 ? st.s > ends[1] : st.s < ends[0]) st.s = npc.dir === 1 ? ends[0] : ends[1];
    live.npcs[index] = { x, z, road: npc.road };

    g.position.set(x, 0, z);
    g.rotation.y = yaw;
    // far away it's too small to see (or hidden in the fog): skip drawing it
    const far = Math.hypot(x - p.x, z - p.z);
    g.visible = far < 120;
    if (riderRef.current) riderRef.current.visible = far < 45;
    // only nearby traffic casts shadows
    const shadow = far < 45;
    if (shadow !== st.shadow) {
      st.shadow = shadow;
      g.traverse((o) => (o.castShadow = shadow && !!o.userData.castShadowWas));
    }
    for (const w of wheels.current) w.o.rotation.z -= (st.speed * dt) / w.r;
    body.current?.setNextKinematicTranslation({ x, y: spec.half[1], z });
    body.current?.setNextKinematicRotation(rot);
  });

  return (
    <>
      <group ref={group}>
        <VehicleModel kind={npc.kind} color={npc.color} />
        {npc.kind !== 'car' && (
          <group ref={riderRef as React.RefObject<THREE.Group>}>
            <Rider kind={npc.kind} />
          </group>
        )}
      </group>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -60 - index * 5, 0]} rotation={[0, yaw, 0]}>
        <CuboidCollider args={spec.half} />
      </RigidBody>
    </>
  );
}

/** A person riding a two-wheeler or driving an auto. */
export function Rider({ kind }: { kind: VehicleKind }) {
  const source = usePersonSource('rider');
  // a rider never changes pose, so they're baked into plain meshes (much cheaper than a skeleton)
  const model = useMemo(
    () =>
      bakedPerson(source, 'rider', (bones) => {
        applyPose(source, bones, SEATED);
        // hands reaching a little further forward for handlebars
        bones.Bip01_L_Forearm.rotation.z += 0.35;
        bones.Bip01_R_Forearm.rotation.z += 0.35;
      }),
    [source]
  );
  const spec = SPECS[kind];
  // seated models sit 0.47 m up with their hips ~0.9 m below standing height
  const y = spec.seat - 0.92;
  const x = kind === 'auto' ? 0.25 : kind === 'cycle' ? -0.28 : -0.32;
  return <primitive object={model} position={[x, y, 0]} rotation-y={Math.PI / 2} />;
}

/* ── Vehicles you can ride ──────────────────────────────────── */

function MyVehicle({ kind, color, home, yaw }: { kind: VehicleKind; color: string; home: [number, number, number]; yaw: number }) {
  const spec = SPECS[kind];
  const group = useRef<THREE.Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<Collider | null>(null);
  const controller = useRef<KinematicCharacterController | null>(null);
  const { world: physics } = useRapier();
  const { camera } = useThree();
  const st = useRef({
    pos: new THREE.Vector3(...home),
    yaw,
    speed: 0,
    fall: 0,
    riding: false,
    look: 0,
    pitch: -0.05,
    lastRide: 0,
  });
  const wheels = useRef<{ o: THREE.Object3D; r: number }[]>([]);

  useEffect(() => {
    wheels.current = [];
    group.current?.traverse((o) => o.userData.wheel && wheels.current.push({ o, r: o.userData.wheel }));
    const c = physics.createCharacterController(0.03);
    c.enableAutostep(0.3, 0.2, true);
    c.enableSnapToGround(0.3);
    c.setMaxSlopeClimbAngle((35 * Math.PI) / 180);
    c.setSlideEnabled(true);
    controller.current = c;
    return () => {
      physics.removeCharacterController(c);
      world.vehicle = null;
    };
  }, [physics]);

  const getOff = () => {
    const s = st.current;
    if (!s.riding) return;
    s.riding = false;
    s.speed = 0;
    s.lastRide = performance.now();
    engine.stop();
    // step off on the left side
    const left = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw)).multiplyScalar(spec.half[2] + 0.6);
    world.dismountAt = s.pos.clone().add(left).setY(Math.max(s.pos.y, 0.2));
    world.riding = null;
    ui.ride(null);
  };

  const interact: Interactable = useMemo(
    () => ({
      label: `Ride your ${spec.name.toLowerCase()}`,
      reach: 3.4,
      onUse: () => {
        const u = ui.get();
        if (u.riding || u.seated) return;
        if (u.drink) return ui.toast('Finish your drink before you ride!');
        const s = st.current;
        s.riding = true;
        s.look = 0;
        s.pitch = -0.05;
        ride.dismount = getOff;
        ride.honk = () => horn(kind);
        engine.start(kind);
        ui.ride({ id: kind, name: spec.name, emoji: spec.emoji });
        ui.toast(kind === 'car' ? 'Buckle up! Keep left, and mind the crossing.' : 'Helmet on! Keep left, and mind the crossing.');
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const fwd = useMemo(() => new THREE.Vector3(), []);
  const move = useMemo(() => new THREE.Vector3(), []);
  const eye = useMemo(() => new THREE.Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = st.current;
    const g = group.current;
    const b = body.current;
    const c = controller.current;
    if (!g || !b || !c) return;
    if (!collider.current) collider.current = b.collider(0);

    if (s.riding) {
      const busy = !!ui.get().card || !!ui.get().book;
      const throttle = busy ? 0 : THREE.MathUtils.clamp(input.forward + input.joystick.y, -1, 1);
      const steer = busy ? 0 : THREE.MathUtils.clamp(input.right + input.joystick.x, -1, 1);
      // accelerate, brake, reverse slowly, roll to a stop
      if (throttle > 0.05) s.speed += spec.accel * throttle * dt;
      else if (throttle < -0.05) s.speed += (s.speed > 0.3 ? -7 : -spec.accel * 0.6) * -throttle * dt;
      else s.speed -= Math.sign(s.speed) * Math.min(Math.abs(s.speed), 1.6 * dt);
      s.speed = THREE.MathUtils.clamp(s.speed, -3, spec.top);
      // steering gets gentler at speed, reverses when backing up
      const grip = Math.min(Math.abs(s.speed) / 2.5, 1) * Math.sign(s.speed);
      s.yaw -= steer * spec.turn * grip * dt * (1 - Math.min(Math.abs(s.speed) / (spec.top * 2.5), 0.5));
      // look around while riding
      s.look = THREE.MathUtils.clamp(s.look + input.lookYaw, -1.7, 1.7);
      s.pitch = THREE.MathUtils.clamp(s.pitch + input.lookPitch, -0.9, 0.6);
      input.lookYaw = 0;
      input.lookPitch = 0;
      engine.speed(s.speed);
    }

    fwd.set(Math.cos(s.yaw), 0, -Math.sin(s.yaw));
    s.fall = c.computedGrounded() ? -0.5 : s.fall - 9.81 * dt;
    move.copy(fwd).multiplyScalar(s.speed * dt);
    move.y = s.fall * dt;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), s.yaw);
    b.setNextKinematicRotation(q);
    c.computeColliderMovement(collider.current, move);
    const done = c.computedMovement();
    const t = b.translation();
    // bumped into something: lose the speed
    if (s.riding && Math.abs(s.speed) > 1 && done.x * move.x + done.z * move.z < move.x * move.x * 0.25 + move.z * move.z * 0.25) s.speed *= 0.4;
    const next = { x: t.x + done.x, y: t.y + done.y, z: t.z + done.z };
    b.setNextKinematicTranslation(next);
    s.pos.set(next.x, next.y - spec.half[1], next.z);

    g.position.copy(s.pos);
    g.rotation.y = s.yaw;
    for (const w of wheels.current) w.o.rotation.z -= (s.speed * dt) / w.r;
    world.vehicle = { kind, color, x: s.pos.x, y: s.pos.y, z: s.pos.z, yaw: s.yaw, speed: s.speed, ridden: s.riding };

    if (s.riding) {
      eye.set(...spec.eye).applyQuaternion(q).add(s.pos);
      // a little vibration on two- and three-wheelers
      if (kind !== 'car') eye.y += Math.sin(performance.now() * 0.05) * 0.004 * Math.min(Math.abs(s.speed), 3);
      camera.position.copy(eye);
      camera.rotation.set(s.pitch, s.yaw - Math.PI / 2 + s.look, 0, 'YXZ');
      world.riding = { eye: eye.clone(), yaw: s.yaw - Math.PI / 2 };
      world.heading = s.yaw - Math.PI / 2 + s.look;
      const speedo = document.getElementById('speedo');
      if (speedo) speedo.textContent = `${Math.round(Math.abs(s.speed) * 3.6)} km/h`;
    }
  });

  return (
    <>
      <group ref={group} position={home} rotation-y={yaw} userData={{ interact }}>
        <VehicleModel kind={kind} color={color} />
        {/* a hidden box so the whole vehicle is easy to tap (a bicycle is mostly air); rays still hit hidden meshes */}
        <mesh position={[0, spec.half[1], 0]} visible={false}>
          <boxGeometry args={[spec.half[0] * 2, spec.half[1] * 2, spec.half[2] * 2 + 0.2]} />
        </mesh>
      </group>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[home[0], home[1] + spec.half[1], home[2]]} rotation={[0, yaw, 0]}>
        <CuboidCollider args={spec.half} />
      </RigidBody>
    </>
  );
}
