import * as THREE from 'three';
import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { CapsuleCollider, RigidBody, useRapier, type RapierRigidBody } from '@react-three/rapier';
import type { Collider, KinematicCharacterController } from '@dimforge/rapier3d-compat';
import { input } from './input';
import { insideBuilding, world } from '../world/state';
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

    // look
    yaw.current += input.lookYaw;
    pitch.current = THREE.MathUtils.clamp(pitch.current + input.lookPitch, -1.35, 1.35);
    input.lookYaw = 0;
    input.lookPitch = 0;

    // walk relative to where you're facing
    const f = busy ? 0 : input.forward + input.joystick.y;
    const r = busy ? 0 : input.right + input.joystick.x;
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
    b.setNextKinematicTranslation(next);

    // share where you are; indoors means no rain on you
    world.player.set(next.x, next.y - HALF_HEIGHT - RADIUS, next.z);
    world.indoors = insideBuilding(next.x, next.z, -0.2);

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
