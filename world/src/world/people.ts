import * as THREE from 'three';
import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { useTexture } from '@react-three/drei';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

/*
 * People in the world are Microsoft Rocketbox avatars (MIT licence). Each lives in
 * public/people/<name>/ as model.fbx plus web-sized textures:
 *   body_color, body_normal, head_color, head_normal (.webp) and opacity_color (hair).
 */

// The models point at .tga files on a Windows path; skip those, we attach our own textures.
const manager = new THREE.LoadingManager();
manager.setURLModifier((url) => (url.toLowerCase().endsWith('.tga') ? 'data:,' : url));

export type Bones = Record<string, THREE.Bone>;
export type Pose = [bone: string, axis: 'x' | 'y' | 'z', radians: number][];

/** Load a person (one shared copy) with proper materials, scaled to metres. */
export function usePersonSource(name: string) {
  const dir = `${import.meta.env.BASE_URL}people/${name}/`;
  const fbx = useLoader(FBXLoader, `${dir}model.fbx`, (l) => {
    (l as FBXLoader).manager = manager;
  });
  const tex = useTexture({
    bodyMap: `${dir}body_color.webp`,
    bodyNormal: `${dir}body_normal.webp`,
    headMap: `${dir}head_color.webp`,
    headNormal: `${dir}head_normal.webp`,
    hairMap: `${dir}opacity_color.webp`,
  });
  return useMemo(() => {
    if (fbx.userData.prepared) return fbx;
    for (const t of [tex.bodyMap, tex.headMap, tex.hairMap]) t.colorSpace = THREE.SRGBColorSpace;
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
          roughness: part === 'head' ? 0.68 : 0.75,
        });
        if (part === 'head') std.envMapIntensity = 0.55; // skin shouldn't shine like plastic
        if (part === 'hair') {
          std.alphaTest = 0.18; // keep the fine strands so the scalp doesn't show through
          std.side = THREE.DoubleSide;
          std.roughness = 0.6;
        }
        return std;
      });
    });
    // remember the T-pose so poses are always applied from scratch
    const tpose: Record<string, THREE.Euler> = {};
    const tpos: Record<string, THREE.Vector3> = {};
    fbx.traverse((o) => {
      if ((o as THREE.Bone).isBone) {
        tpose[o.name] = o.rotation.clone();
        tpos[o.name] = o.position.clone();
      }
    });
    fbx.userData.tpose = tpose;
    fbx.userData.tpos = tpos;
    fbx.userData.prepared = true;
    return fbx;
  }, [fbx, tex.bodyMap, tex.bodyNormal, tex.headMap, tex.headNormal, tex.hairMap]);
}

/** A separate copy of a person (own skeleton, shared meshes and materials). */
export function instancePerson(source: THREE.Group, shared = false): { model: THREE.Object3D; bones: Bones } {
  const model = shared ? source : (cloneSkinned(source) as THREE.Group);
  model.userData.tpose = source.userData.tpose;
  model.userData.tpos = source.userData.tpos;
  const bones: Bones = {};
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone) bones[o.name] = o as THREE.Bone;
  });
  return { model, bones };
}

/** Put a person in a pose: their T-pose plus the given bone rotations. */
export function applyPose(model: THREE.Object3D, bones: Bones, pose: Pose) {
  const tpose = model.userData.tpose as Record<string, THREE.Euler>;
  const tpos = model.userData.tpos as Record<string, THREE.Vector3>;
  for (const [n, b] of Object.entries(bones)) {
    b.rotation.copy(tpose[n]);
    b.position.copy(tpos[n]);
  }
  for (const [name, axis, v] of pose) if (bones[name]) bones[name].rotation[axis] += v;
}

/** Sitting with hands forward (desk, handlebars). */
export const SEATED: Pose = [
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

/** Standing relaxed, arms by the sides. */
export const STANDING: Pose = [
  ['Bip01_L_UpperArm', 'y', 1.15],
  ['Bip01_R_UpperArm', 'y', -1.15],
  ['Bip01_L_Forearm', 'z', -0.25],
  ['Bip01_R_Forearm', 'z', -0.25],
];

/** How far the hips drop when someone sits (they're modelled standing on their feet). */
export const SIT_DROP = 0.45;

/** Face-bone nudges (in the model's centimetres): x = up, z = towards the person's left. */
export type FaceShape = [bone: string, axis: 'x' | 'y' | 'z', cm: number][];

/** A warm smile that reaches the eyes. */
export const SMILE: FaceShape = [
  ['Bip01_LMouthCorner', 'x', 0.7],
  ['Bip01_RMouthCorner', 'x', 0.7],
  ['Bip01_LMouthCorner', 'z', 0.4],
  ['Bip01_RMouthCorner', 'z', -0.4],
  ['Bip01_LCheek', 'x', 0.35],
  ['Bip01_RCheek', 'x', 0.35],
  ['Bip01_LEyeBlinkBottom', 'x', 0.18],
  ['Bip01_REyeBlinkBottom', 'x', 0.18],
];

export function applyFace(bones: Bones, face: FaceShape) {
  for (const [name, axis, cm] of face) if (bones[name]) bones[name].position[axis] += cm;
}
