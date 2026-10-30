import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { input } from './input';
import { insideBuilding, world } from '../world/state';
import { groundAt } from '../world/map';
import { ui } from '../world/interact';

const HALF_HEIGHT = 0.55;
const RADIUS = 0.3;
const EYE = 0.8; // above the capsule centre → eyes ≈ 1.65 m above the ground
const WALK = 1.45; // m/s, an easy stroll
const RUN = 3.6;
const GRAVITY = -9.81;

/** You, in first person: walk, look around, climb steps, bump into walls. */
export function Player({ start = [0, 1.2, 16.5] as [number, number, number], startYaw = 0, startPitch = -0.05 }) {
  const body = useRef<RapierRigidBody>(null);
  const collider = useRef<Collider | null>(null);
  const controller = useRef<KinematicCharacterController | null>(null);
  const { world: physics } = useRapier();
  const { camera } = useThree();

  const yaw = useRef(startYaw);
  const pitch = useRef(startPitch);
  const fall = useRef(0);
  const bob = useRef(0);
  const seated = useRef<typeof world.seat>(null);
  const speedNow = useRef(0);

  useEffect(() => {
    const c = physics.createCharacterController(0.02);
    c.enableAutostep(0.35, 0.2, true);
    c.enableSnapToGround(0.35);
    c.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    c.setSlideEnabled(true);
    controller.current = c;
    return () => {
      physics.removeCharacterController(c);
      controller.current = null;
    };
  }, [physics]);

  const move = new THREE.Vector3();
  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const b = body.current;
    const c = controller.current;
    if (!b || !c) return;
    if (!collider.current) collider.current = b.collider(0);

    // while a book is open, you stand still and the world waits
    const busy = ui.get().book !== null || ui.get().card !== null;
    if (busy) {
      input.lookYaw = 0;
      input.lookPitch = 0;
    }

    // previews (?debug): a free camera anywhere
    if (world.freeCam) {
      camera.position.copy(world.freeCam.at);
      camera.rotation.set(world.freeCam.pitch, world.freeCam.yaw, 0, 'YXZ');
      return;
    }

    // riding a vehicle: the vehicle moves the camera; park the walker out of the way
    if (world.riding) {
      b.setNextKinematicTranslation({ x: 0, y: -40, z: 0 });
      world.player.set(world.riding.eye.x, world.riding.eye.y - 1.4, world.riding.eye.z);
      return;
    }
    if (world.dismountAt) {
      const d = world.dismountAt;
      b.setTranslation({ x: d.x, y: d.y + HALF_HEIGHT + RADIUS + 0.1, z: d.z }, true);
      world.dismountAt = null;
      fall.current = 0;
      yaw.current = Math.atan2(-(camera.getWorldDirection(new THREE.Vector3()).x), -(camera.getWorldDirection(new THREE.Vector3()).z));
      return;
    }

    // look
    yaw.current += input.lookYaw;
    pitch.current = THREE.MathUtils.clamp(pitch.current + input.lookPitch, -1.35, 1.35);
    input.lookYaw = 0;
    input.lookPitch = 0;

    // walk relative to where you're facing
    const f = busy ? 0 : input.forward + input.joystick.y;
    const r = busy ? 0 : input.right + input.joystick.x;

    // sitting in a chair: look around freely; any step stands you up
    if (world.seat) {
      if (seated.current !== world.seat) {
        seated.current = world.seat;
        yaw.current = world.seat.yaw;
        pitch.current = -0.05;
      }
      world.heading = yaw.current;
      world.avatar.set(world.seat.eye.x, world.seat.eye.y - 1.64, world.seat.eye.z);
      if (Math.hypot(f, r) > 0.3 || world.standRequest) {
        world.standRequest = false;
        const s = world.seat.standAt;
        b.setTranslation({ x: s.x, y: s.y + HALF_HEIGHT + RADIUS + 0.05, z: s.z }, true);
        world.seat = null;
        seated.current = null;
        ui.setSeated(false);
      } else {
        camera.position.copy(world.seat.eye);
        camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
        return;
      }
    }
    const len = Math.min(Math.hypot(f, r), 1);
    const target = len > 0.01 ? (input.run || len > 0.92 ? (input.run ? RUN : WALK * 1.25) : WALK) * len : 0;
    speedNow.current += (target - speedNow.current) * Math.min(dt * 6, 1); // ease in/out like a real step
    forward.set(-Math.sin(yaw.current), 0, -Math.cos(yaw.current));
    right.set(Math.cos(yaw.current), 0, -Math.sin(yaw.current));
    move.set(0, 0, 0);
    if (len > 0.01) move.addScaledVector(forward, f / Math.max(len, 1)).addScaledVector(right, r / Math.max(len, 1)).normalize();
    move.multiplyScalar(speedNow.current * dt);

    fall.current = c.computedGrounded() ? -0.5 : fall.current + GRAVITY * dt;
    move.y = fall.current * dt;

    c.computeColliderMovement(collider.current, move);
    const done = c.computedMovement();
    const p = b.translation();
    const next = { x: p.x + done.x, y: p.y + done.y, z: p.z + done.z };
    // nothing is below ground: never sink into it (also holds you up before a tile's ground loads)
    const floor = groundAt(next.x, next.z) + HALF_HEIGHT + RADIUS;
    if (next.y < floor) {
      next.y = floor;
      fall.current = 0;
    }
    b.setNextKinematicTranslation(next);

    // share where you are; indoors means no rain on you
    world.player.set(next.x, next.y - HALF_HEIGHT - RADIUS, next.z);
    world.indoors = insideBuilding(next.x, next.z, -0.2);
    world.heading = yaw.current;
    world.avatar.copy(world.player);

    // camera at eye height with a soft walking bob
    bob.current += speedNow.current * dt * 5.2;
    const bobY = Math.sin(bob.current * 2) * 0.025 * Math.min(speedNow.current / WALK, 1.5);
    const bobX = Math.cos(bob.current) * 0.015 * Math.min(speedNow.current / WALK, 1.5);
    camera.position.set(next.x + right.x * bobX, next.y + EYE + bobY, next.z + right.z * bobX);
    camera.rotation.set(pitch.current, yaw.current, 0, 'YXZ');
  });

  return (
    <RigidBody ref={body} type="kinematicPosition" colliders={false} position={start} enabledRotations={[false, false, false]}>
      <CapsuleCollider args={[HALF_HEIGHT, RADIUS]} />
    </RigidBody>
  );
}
