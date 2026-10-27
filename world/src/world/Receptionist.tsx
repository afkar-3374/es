import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { applyFace, applyPose, instancePerson, SEATED, SIT_DROP, SMILE, usePersonSource } from './people';
import { ui, type Interactable } from './interact';
import { world } from './state';

/*
 * Meera, at the reception desk. A Microsoft Rocketbox avatar (MIT licence), posed
 * sitting on an office chair: she types, breathes, turns to look at you when you
 * come close, and waves when you say hi.
 */
export function Receptionist({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const source = usePersonSource('receptionist');
  const { model, bones, base, lids } = useMemo(() => {
    const { model, bones } = instancePerson(source, true);
    applyPose(model, bones, SEATED);
    applyFace(bones, SMILE);
    const base: Record<string, THREE.Euler> = {};
    for (const n of ['Bip01_Head', 'Bip01_Spine1', 'Bip01_L_Forearm', 'Bip01_R_Forearm', 'Bip01_R_UpperArm']) base[n] = bones[n].rotation.clone();
    const lids = { L: bones.Bip01_LEyeBlinkTop.position.x, R: bones.Bip01_REyeBlinkTop.position.x };
    // a little flower clip above her left ear (head-bone space, centimetres: x up, y forward, z left)
    if (!bones.Bip01_Head.getObjectByName('hair-flower')) bones.Bip01_Head.add(hairFlower());
    return { model, bones, base, lids };
  }, [source]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esReceptionist: model, esBones: bones });
  }, [model, bones]);

  // Little lifelike motions
  const group = useRef<THREE.Group>(null);
  const look = useRef(0);
  const wave = useRef(0); // seconds of waving left
  const nextBlink = useRef(2);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const g = group.current;
    if (!g) return;

    // breathing
    bones.Bip01_Spine1.rotation.z = base.Bip01_Spine1.z + Math.sin(t * 1.6) * 0.012;

    // blink every few seconds
    if (t > nextBlink.current) nextBlink.current = t + 2.5 + Math.random() * 3;
    const blink = nextBlink.current - t < 0.14 ? 1 : 0;
    bones.Bip01_LEyeBlinkTop.position.x = lids.L - blink * 1.0;
    bones.Bip01_REyeBlinkTop.position.x = lids.R - blink * 1.0;

    // turn her head towards you when you're near and in front of the desk
    g.worldToLocal(tmp.copy(world.player));
    const dist = Math.hypot(tmp.x, tmp.z);
    const angle = Math.atan2(tmp.x, tmp.z); // 0 = straight ahead
    const near = dist < 7 && tmp.z > 0.3 && Math.abs(world.player.y - position[1]) < 1.5;
    const target = near ? THREE.MathUtils.clamp(angle, -0.9, 0.9) : Math.sin(t * 0.23) * 0.15;
    look.current += (target - look.current) * Math.min(dt * 2.5, 1);
    bones.Bip01_Head.rotation.x = base.Bip01_Head.x + look.current;
    // look up a little at a standing visitor, down at the screen otherwise
    bones.Bip01_Head.rotation.z = base.Bip01_Head.z + (near ? 0.12 : -0.05);
    bones.Bip01_Head.rotation.y = base.Bip01_Head.y + (near ? 0.12 : 0); // a little head tilt

    // typing when nobody is around; waving when greeted
    const typing = near ? 0.25 : 1;
    bones.Bip01_L_Forearm.rotation.z = base.Bip01_L_Forearm.z + Math.sin(t * 9) * 0.03 * typing;
    if (wave.current > 0) {
      wave.current -= dt;
      const w = Math.min(wave.current, 1, 2.2 - wave.current); // ease in and out
      const up = THREE.MathUtils.clamp(w * 1.6, 0, 1);
      bones.Bip01_R_UpperArm.rotation.y = base.Bip01_R_UpperArm.y + up * 0.75;
      bones.Bip01_R_Forearm.rotation.z = base.Bip01_R_Forearm.z - up * 0.55 + Math.sin(t * 9) * 0.22 * up;
    } else {
      bones.Bip01_R_UpperArm.rotation.y = base.Bip01_R_UpperArm.y;
      bones.Bip01_R_Forearm.rotation.z = base.Bip01_R_Forearm.z + Math.sin(t * 9 + 1.3) * 0.03 * typing;
    }
  });

  const interact: Interactable = useMemo(
    () => ({
      label: 'Say hi to Meera',
      reach: 4.5,
      onUse: () => {
        wave.current = 2.2;
        ui.showCard({
          emoji: '👋',
          title: 'Hi, I’m Meera!',
          text: 'Welcome to Electrosparkzz! The shops down here are opening soon. Upstairs at the back there’s our library, with four of our stories and a little café: Anu makes a lovely filter coffee. Take a book, grab a chai and find a cosy seat. And if you like, the scooter, cycle, auto and car outside are yours to ride. Keep left!',
        });
      },
    }),
    []
  );

  return (
    <group ref={group} position={position} rotation-y={rotation} userData={{ keep: true }}>
      <OfficeChair />
      <primitive object={model} position={[0, -SIT_DROP + 0.02, -0.02]} userData={{ interact }} />
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[0.35, 0.7, 0.35]} position={[0, 0.7, 0]} />
      </RigidBody>
    </group>
  );
}

/** A mesh-back office chair on a five-star base with casters. */
function OfficeChair() {
  const black = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1c1c1f', roughness: 0.5 }), []);
  const chrome = useMemo(() => new THREE.MeshStandardMaterial({ color: '#cfd2d6', roughness: 0.2, metalness: 0.95 }), []);
  const fabric = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2b2e35', roughness: 0.95 }), []);
  return (
    <group>
      {Array.from({ length: 5 }, (_, i) => {
        const a = (i / 5) * Math.PI * 2;
        return (
          <group key={i} rotation-y={a}>
            <mesh position={[0, 0.08, 0.17]} rotation-x={0.08} castShadow material={chrome}>
              <boxGeometry args={[0.05, 0.03, 0.34]} />
            </mesh>
            <mesh position={[0, 0.03, 0.33]} castShadow material={black}>
              <sphereGeometry args={[0.03, 10, 8]} />
            </mesh>
          </group>
        );
      })}
      <mesh position={[0, 0.25, 0]} castShadow material={chrome}>
        <cylinderGeometry args={[0.025, 0.03, 0.32, 12]} />
      </mesh>
      <mesh position={[0, 0.43, 0.03]} castShadow receiveShadow material={fabric}>
        <boxGeometry args={[0.5, 0.07, 0.48]} />
      </mesh>
      <mesh position={[0, 0.8, -0.24]} rotation-x={-0.12} castShadow material={fabric}>
        <boxGeometry args={[0.46, 0.58, 0.05]} />
      </mesh>
      <mesh position={[0, 0.6, -0.24]} castShadow material={black}>
        <boxGeometry args={[0.06, 0.3, 0.04]} />
      </mesh>
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.27, 0, 0]}>
          <mesh position={[0, 0.54, -0.02]} material={black}>
            <boxGeometry args={[0.03, 0.2, 0.03]} />
          </mesh>
          <mesh position={[0, 0.65, 0.04]} castShadow material={black}>
            <boxGeometry args={[0.06, 0.03, 0.26]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/** A small pink flower hair clip (sized in the model's centimetres). */
function hairFlower() {
  const g = new THREE.Group();
  g.name = 'hair-flower';
  const petal = new THREE.MeshStandardMaterial({ color: '#ff8fb8', roughness: 0.5 });
  const centre = new THREE.MeshStandardMaterial({ color: '#ffd166', roughness: 0.4 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.9, 10, 8), petal);
    m.scale.set(1, 0.45, 1);
    m.position.set(Math.cos(a) * 1.0, 0, Math.sin(a) * 1.0);
    g.add(m);
  }
  const c = new THREE.Mesh(new THREE.SphereGeometry(0.55, 10, 8), centre);
  c.position.y = 0.3;
  g.add(c);
  g.position.set(12.5, 3.0, 9.3);
  g.scale.setScalar(1.5);
  g.rotation.set(-0.9, 0, 0); // lying against the side of her head
  return g;
}
