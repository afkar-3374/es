import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CuboidCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { SPECS, setVehicleLights, VehicleModel, type VehicleKind } from './vehicleModels';
import { ui, type Interactable } from './interact';
import { world } from './state';
import { me } from '../net/net';
import { isTouch } from '../player/input';
import { input } from '../player/input';
import { ride } from './ride';
import { engine, horn } from '../audio/sfx';

/*
 * The vehicle each visitor can call up and ride. There is no computer traffic:
 * everything on the roads belongs to a real visitor.
 */

/** Colours for visitors' own vehicles */
const PAINT = ['#e84393', '#2d6cdf', '#16a085', '#f39c12', '#c0392b', '#8e44ad', '#f5f6fa', '#2c3e50', '#d35400', '#27ae60'];

export function Vehicles() {
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
      {mine && <MyVehicle key={mine.n} kind={mine.kind} color={mine.color} home={mine.at} yaw={mine.yaw} />}
    </group>
  );
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
