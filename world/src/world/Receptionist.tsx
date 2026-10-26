import * as THREE from 'three';
import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { ui, type Interactable } from './interact';
import { world } from './state';

/*
 * Meera, at the reception desk. A Microsoft Rocketbox avatar (MIT licence), posed
 * sitting on an office chair: she types, breathes, turns to look at you when you
 * come close, and waves when you say hi.
 */
const DIR = `${import.meta.env.BASE_URL}people/receptionist/`;

// The model points at .tga files on a Windows path; skip those, we attach web-sized textures ourselves.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => (url.toLowerCase().endsWith('.tga') ? 'data:,' : url));

/** Bone rotations (added to the model's T-pose) for sitting with hands at a keyboard. */
const SEATED: [string, 'x' | 'y' | 'z', number][] = [
  ['Bip01_L_Thigh', 'z', 1.5],
  ['Bip01_R_Thigh', 'z', 1.5],
  ['Bip01_L_Calf', 'z', -1.5],
  ['Bip01_R_Calf', 'z', -1.5],
  ['Bip01_L_UpperArm', 'y', 0.9],
  ['Bip01_R_UpperArm', 'y', -0.9],
  ['Bip01_L_UpperArm', 'z', -0.3],
  ['Bip01_R_UpperArm', 'z', -0.3],
  ['Bip01_L_Forearm', 'z', -1.27],
  ['Bip01_R_Forearm', 'z', -1.27],
];
const SIT_DROP = 0.45; // the model stands on its feet; sitting lowers the hips this much

export function Receptionist({ position, rotation = 0 }: { position: [number, number, number]; rotation?: number }) {
  const fbx = useLoader(FBXLoader, `${DIR}receptionist.fbx`, (l) => {
    (l as FBXLoader).manager = manager;
  });
  const tex = useTexture({
    bodyMap: `${DIR}f018_body_color.webp`,
    bodyNormal: `${DIR}f018_body_normal.webp`,
    headMap: `${DIR}f018_head_color.webp`,
    headNormal: `${DIR}f018_head_normal.webp`,
    hairMap: `${DIR}f018_opacity_color.webp`,
  });

  const { model, bones, base } = useMemo(() => {
    for (const k of ['bodyMap', 'headMap', 'hairMap'] as const) tex[k].colorSpace = THREE.SRGBColorSpace;
    fbx.scale.setScalar(0.01); // centimetres → metres
    fbx.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.Material[];
      mesh.material = mats.map((m) => {
        const part = m.name.includes('head') ? 'head' : m.name.includes('opacity') ? 'hair' : 'body';
        const std = new THREE.MeshStandardMaterial({
          name: m.name,
          map: part === 'head' ? tex.headMap : part === 'hair' ? tex.hairMap : tex.bodyMap,
          normalMap: part === 'head' ? tex.headNormal : part === 'body' ? tex.bodyNormal : null,
          roughness: part === 'head' ? 0.55 : 0.75,
        });
        if (part === 'hair') {
          // hair strands and eyelashes
          std.alphaTest = 0.4;
          std.side = THREE.DoubleSide;
          std.roughness = 0.6;
        }
        return std;
      });
    });

    const bones: Record<string, THREE.Bone> = {};
    fbx.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
    });
    // Sit down, starting from the model's own T-pose every time (never twice)
    if (!fbx.userData.tpose) {
      fbx.userData.tpose = Object.fromEntries(Object.entries(bones).map(([n, b]) => [n, b.rotation.clone()]));
    }
    const tpose = fbx.userData.tpose as Record<string, THREE.Euler>;
    for (const [n, b] of Object.entries(bones)) b.rotation.copy(tpose[n]);
    for (const [name, axis, v] of SEATED) bones[name].rotation[axis] += v;
    const base: Record<string, THREE.Euler> = {};
    for (const n of ['Bip01_Head', 'Bip01_Spine1', 'Bip01_L_Forearm', 'Bip01_R_Forearm', 'Bip01_R_UpperArm']) base[n] = bones[n].rotation.clone();
    return { model: fbx, bones, base };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fbx, tex.bodyMap, tex.bodyNormal, tex.headMap, tex.headNormal, tex.hairMap]);

  useEffect(() => {
    if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esReceptionist: model });
  }, [model]);

  // Little lifelike motions
  const group = useRef<THREE.Group>(null);
  const look = useRef(0);
  const wave = useRef(0); // seconds of waving left
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    const g = group.current;
    if (!g) return;

    // breathing
    bones.Bip01_Spine1.rotation.z = base.Bip01_Spine1.z + Math.sin(t * 1.6) * 0.012;

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
          text: 'Welcome to Electrosparkzz. The shops down here are getting ready to open. Head up the stairs at the back: the library has one bookcase open with four of our stories. Take your time!',
        });
      },
    }),
    []
  );

  return (
    <group ref={group} position={position} rotation-y={rotation}>
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
