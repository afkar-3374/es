import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { RUN_FRAMES, showFrame, strideBob, usePersonSource, walkCycle, WALK_FRAMES } from './people';
import { SPECS, VehicleModel, type VehicleKind } from './vehicleModels';
import { LOOKS, peers, useNet, type Peer } from '../net/net';
import { world } from './state';
import { voice } from '../net/voice';

/*
 * Everyone else in town: their person (walking, sitting or riding), a name tag with
 * what they last said, and their vehicle. Positions arrive a few times a second and
 * are smoothed here so people glide rather than jump.
 */

const BUBBLE_FOR = 7000; // ms
const SHOW_LABEL = 45; // metres
const SHOW_PERSON = 90;

/** What's drawn for one visitor, eased towards the last thing they told us. */
interface Shown {
  x: number;
  y: number;
  z: number;
  yaw: number;
  vx: number;
  vy: number;
  vz: number;
  vyaw: number;
  init: boolean;
  vinit: boolean;
}

const shown = new Map<string, Shown>();

const ease = (from: number, to: number, k: number) => from + (to - from) * k;
function easeAngle(from: number, to: number, k: number) {
  let d = to - from;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return from + d * k;
}

/** Shared per-frame smoothing (runs once, before the people and vehicles read it). */
function Smoother() {
  useFrame((_, dt) => {
    const k = 1 - Math.exp(-Math.min(dt, 0.1) * 9);
    for (const p of peers.values()) {
      let s = shown.get(p.id);
      if (!s) {
        s = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, vx: 0, vy: 0, vz: 0, vyaw: 0, init: true, vinit: false };
        shown.set(p.id, s);
      }
      // a big jump (they called a vehicle, or respawned): snap instead of sliding across town
      if (Math.hypot(p.x - s.x, p.z - s.z) > 25) Object.assign(s, { x: p.x, y: p.y, z: p.z });
      s.x = ease(s.x, p.x, k);
      s.y = ease(s.y, p.y, k);
      s.z = ease(s.z, p.z, k);
      s.yaw = easeAngle(s.yaw, p.yaw, k);
      const v = p.vehicle;
      if (v) {
        if (!s.vinit || Math.hypot(v.x - s.vx, v.z - s.vz) > 25) Object.assign(s, { vx: v.x, vy: v.y, vz: v.z, vyaw: v.yaw, vinit: true });
        s.vx = ease(s.vx, v.x, k);
        s.vy = ease(s.vy, v.y, k);
        s.vz = ease(s.vz, v.z, k);
        s.vyaw = easeAngle(s.vyaw, v.yaw, k);
      } else s.vinit = false;
    }
    for (const id of shown.keys()) if (!peers.has(id)) shown.delete(id);
  }, -1);
  return null;
}

export function Peers() {
  const { roster } = useNet();
  return (
    <group>
      <Smoother />
      {roster.map((p) => (
        <group key={p.id}>
          <PeerPerson id={p.id} look={p.look} name={p.name} />
          {p.vehicle && <PeerVehicle key={`${p.vehicle.kind}${p.vehicle.color}`} id={p.id} kind={p.vehicle.kind} color={p.vehicle.color} />}
        </group>
      ))}
    </group>
  );
}

/** Where a rider sits on each vehicle (as in the traffic). */
function seatOffset(kind: VehicleKind): [number, number] {
  const x = kind === 'auto' ? 0.25 : kind === 'cycle' ? -0.28 : kind === 'car' ? -0.05 : -0.22;
  return [x, SPECS[kind].seat - 0.92];
}

function PeerPerson({ id, look, name }: { id: string; look: number; name: string }) {
  const source = usePersonSource(LOOKS[look] ?? LOOKS[0]);
  // walking, standing and sitting are baked frames (no skeleton to update every frame)
  const cycle = useMemo(() => walkCycle(source), [source]);
  const model = useMemo(() => {
    const m = cycle.frames[0].clone();
    m.traverse((o) => (o.castShadow = true));
    return m;
  }, [cycle]);
  const group = useRef<THREE.Group>(null);
  const label = useRef<THREE.Group>(null);
  const tag = useRef<HTMLDivElement>(null);
  const bubble = useRef<HTMLDivElement>(null);
  const phase = useRef(0);
  const said = useRef('');
  const nameTag = useRef<HTMLDivElement>(null);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p: Peer | undefined = peers.get(id);
    const s = shown.get(id);
    const g = group.current;
    if (!p || !s || !g) return;
    const riding = p.mode === 2 && p.vehicle && s.vinit;
    let headY: number;
    if (riding) {
      const kind = p.vehicle!.kind;
      const [ox, oy] = seatOffset(kind);
      g.position.set(s.vx + Math.cos(s.vyaw) * ox, s.vy + oy, s.vz - Math.sin(s.vyaw) * ox);
      g.rotation.y = s.vyaw + Math.PI / 2;
      headY = s.vy + SPECS[kind].seat + 0.95;
    } else {
      g.position.set(s.x, s.y, s.z);
      g.rotation.y = s.yaw + Math.PI;
      headY = s.y + (p.mode === 1 ? 1.4 : 1.85);
    }
    // a car hides its driver well enough; skip the person inside
    model.visible = !(riding && p.vehicle!.kind === 'car');

    const dist = Math.hypot(g.position.x - world.player.x, g.position.z - world.player.z);
    g.visible = dist < SHOW_PERSON;

    // sitting (in a chair or on a vehicle), walking, or standing still
    if (riding) showFrame(model, p.vehicle!.kind === 'bike' ? cycle.bike : cycle.sit);
    else if (p.mode === 1) showFrame(model, cycle.sit);
    else if (g.visible) {
      const speed = Math.min(p.speed, 7);
      if (speed > 0.2) {
        // the legs keep pace with the ground: a walking stride is about 1.4 m, a running one 2.4 m
        const run = speed > 2.6;
        phase.current += (dt * Math.PI * 2 * speed) / (run ? 2.4 : 1.4);
        const t = (phase.current / (Math.PI * 2)) % 1;
        showFrame(model, run ? cycle.run[Math.floor(t * RUN_FRAMES)] : cycle.frames[Math.floor(t * WALK_FRAMES)]);
        g.position.y += strideBob(phase.current, run);
      } else showFrame(model, cycle.stand);
    }

    // name tag and speech bubble
    if (label.current) {
      label.current.position.set(g.position.x, headY + 0.35, g.position.z);
      label.current.visible = dist < SHOW_LABEL;
    }
    const b = p.bubble && performance.now() - p.bubble.at < BUBBLE_FOR ? p.bubble.text : '';
    if (bubble.current && b !== said.current) {
      said.current = b;
      bubble.current.textContent = b;
      bubble.current.style.display = b ? '' : 'none';
    }
    // everyone in the call can be heard anywhere, so their name shows while they speak
    const speaking = voice.level(id) > 0.04;
    if (tag.current) tag.current.style.opacity = dist < SHOW_LABEL || speaking ? '1' : '0';
    if (label.current) label.current.visible = dist < SHOW_LABEL || speaking;
    if (nameTag.current) nameTag.current.classList.toggle('speaking', speaking);
  });

  return (
    <>
      <group ref={group}>
        <primitive object={model} />
      </group>
      <group ref={label}>
        <Html center zIndexRange={[10, 0]} style={{ pointerEvents: 'none' }}>
          <div className="peer-label" ref={tag}>
            <div className="peer-bubble" ref={bubble} style={{ display: 'none' }} />
            <div className="peer-name" ref={nameTag}>
              {name}
            </div>
          </div>
        </Html>
      </group>
    </>
  );
}

function PeerVehicle({ id, kind, color }: { id: string; kind: VehicleKind; color: string }) {
  const spec = SPECS[kind];
  const group = useRef<THREE.Group>(null);
  const body = useRef<RapierRigidBody>(null);
  const wheels = useRef<{ o: THREE.Object3D; r: number }[]>([]);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const up = useMemo(() => new THREE.Vector3(0, 1, 0), []);

  useEffect(() => {
    wheels.current = [];
    group.current?.traverse((o) => o.userData.wheel && wheels.current.push({ o, r: o.userData.wheel }));
  }, []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = peers.get(id);
    const s = shown.get(id);
    const g = group.current;
    if (!p?.vehicle || !s?.vinit || !g) return;
    g.position.set(s.vx, s.vy, s.vz);
    g.rotation.y = s.vyaw;
    g.visible = Math.hypot(s.vx - world.player.x, s.vz - world.player.z) < 140;
    for (const w of wheels.current) w.o.rotation.z -= (p.vehicle.speed * dt) / w.r;
    q.setFromAxisAngle(up, s.vyaw);
    body.current?.setNextKinematicTranslation({ x: s.vx, y: s.vy + spec.half[1], z: s.vz });
    body.current?.setNextKinematicRotation(q);
  });

  return (
    <>
      <group ref={group}>
        <VehicleModel kind={kind} color={color || '#f5f6fa'} />
      </group>
      <RigidBody ref={body} type="kinematicPosition" colliders={false} position={[0, -80, 0]}>
        <CuboidCollider args={spec.half} />
      </RigidBody>
    </>
  );
}
