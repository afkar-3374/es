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
    // the files carry their own scene light; it would light the whole town once per person
    const lights: THREE.Object3D[] = [];
    fbx.traverse((o) => (o as THREE.Light).isLight && lights.push(o));
    lights.forEach((l) => l.removeFromParent());
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

const baked = new Map<string, THREE.Group>();

/**
 * A person frozen in one pose as plain meshes (no skeleton to update and upload every
 * frame). Worked out once per look and pose, then shared by everyone who uses it.
 */
export function bakedPerson(source: THREE.Group, key: string, pose: (bones: Bones) => void): THREE.Group {
  const id = `${source.uuid}:${key}`;
  let template = baked.get(id);
  if (!template) {
    const { model, bones } = instancePerson(source);
    pose(bones);
    model.updateMatrixWorld(true);
    template = new THREE.Group();
    const skin = new THREE.Matrix4();
    const tmp = new THREE.Matrix4();
    const v = new THREE.Vector3();
    const n = new THREE.Vector3();
    model.traverse((o) => {
      const sm = o as THREE.SkinnedMesh;
      if (!sm.isSkinnedMesh) return;
      sm.skeleton.update();
      const g = sm.geometry;
      const out = new THREE.BufferGeometry();
      const pos = g.attributes.position;
      const nor = g.attributes.normal;
      const si = g.attributes.skinIndex;
      const sw = g.attributes.skinWeight;
      const P = new Float32Array(pos.count * 3);
      const N = new Float32Array(pos.count * 3);
      const bm = sm.skeleton.boneMatrices;
      for (let i = 0; i < pos.count; i++) {
        // the same blend of bone matrices the GPU would use for this vertex
        skin.makeScale(0, 0, 0).elements[15] = 0;
        for (let k = 0; k < 4; k++) {
          const w = sw.getComponent(i, k);
          if (!w) continue;
          tmp.fromArray(bm, si.getComponent(i, k) * 16);
          for (let e = 0; e < 16; e++) skin.elements[e] += tmp.elements[e] * w;
        }
        skin.premultiply(sm.bindMatrixInverse).multiply(sm.bindMatrix);
        v.fromBufferAttribute(pos, i).applyMatrix4(skin);
        P.set([v.x, v.y, v.z], i * 3);
        if (nor) {
          n.fromBufferAttribute(nor, i).transformDirection(skin);
          N.set([n.x, n.y, n.z], i * 3);
        }
      }
      out.setAttribute('position', new THREE.BufferAttribute(P, 3));
      if (nor) out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
      for (const name of ['uv', 'uv1', 'tangent']) if (g.attributes[name]) out.setAttribute(name, g.attributes[name]);
      if (g.index) out.setIndex(g.index);
      for (const grp of g.groups) out.addGroup(grp.start, grp.count, grp.materialIndex);
      out.computeBoundingSphere();
      const mesh = new THREE.Mesh(out, sm.material);
      // keep the skinned mesh's place in the model
      sm.matrixWorld.decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.applyMatrix4(new THREE.Matrix4().copy(model.matrixWorld).invert());
      mesh.receiveShadow = true;
      template!.add(mesh);
    });
    // the model's own scale (centimetres → metres) and placement
    template.position.copy(model.position);
    template.quaternion.copy(model.quaternion);
    template.scale.copy(model.scale);
    baked.set(id, template);
  }
  // copies share geometry and materials
  return template.clone();
}

/** Frames in a baked walk (and run) cycle */
export const WALK_FRAMES = 24;
export const RUN_FRAMES = 16;

/** A smooth bump around `at` (radians round the stride), `width` wide. */
function bump(phase: number, at: number, width: number) {
  const d = Math.atan2(Math.sin(phase - at), Math.cos(phase - at));
  return Math.exp(-(d * d) / (2 * width * width));
}

/** Relaxed hands: fingers gently curled, thumb tucked, as people's hands hang. */
function hands(curl: number): Pose {
  const out: Pose = [];
  for (const side of ['L', 'R']) {
    for (const f of ['1', '2', '3', '4']) {
      const spread = Number(f) * 0.12;
      out.push([`Bip01_${side}_Finger${f}`, 'z', curl * (0.35 + spread * 0.5)]);
      out.push([`Bip01_${side}_Finger${f}1`, 'z', curl * (0.55 + spread)]);
      out.push([`Bip01_${side}_Finger${f}2`, 'z', curl * 0.45]);
    }
    out.push([`Bip01_${side}_Finger01`, 'z', curl * 0.25]);
  }
  return out;
}

/** One leg through the stride. `phase` is where this leg is: π/2 = heel strike, −π/2 = toe off. */
function leg(side: 'L' | 'R', phase: number, run: boolean): Pose {
  // hip: forward at heel strike, behind at push-off (a walk ≈ +28°/−12°, a run more)
  const hip = run ? 0.18 + 0.62 * Math.sin(phase) : 0.1 + 0.38 * Math.sin(phase);
  // knee: a small give as the foot takes the weight, a big bend as the leg swings through
  const knee = run
    ? 0.35 * bump(phase, Math.PI / 2 + 0.5, 0.45) + 1.65 * bump(phase, -0.35, 0.75)
    : 0.22 * bump(phase, Math.PI / 2 + 0.45, 0.4) + 1.05 * bump(phase, -0.45, 0.6) + 0.06;
  // ankle: toes lifted to clear the ground while swinging, pointed as the foot pushes off
  const ankle = (run ? 0.3 : 0.18) * bump(phase, 0.1, 0.7) - (run ? 0.55 : 0.35) * bump(phase, -Math.PI / 2 - 0.15, 0.35);
  return [
    [`Bip01_${side}_Thigh`, 'z', hip],
    [`Bip01_${side}_Calf`, 'z', -knee],
    [`Bip01_${side}_Foot`, 'z', ankle],
    // toes bend as the heel lifts
    [`Bip01_${side}_Toe0`, 'z', 0.4 * bump(phase, -Math.PI / 2 - 0.25, 0.3)],
  ];
}

/** One arm, swinging against its leg; elbows bend more as the arm comes forward. */
function arm(side: 'L' | 'R', phase: number, run: boolean): Pose {
  // the arm swings opposite its own leg: forward while the leg is back
  const swing = -Math.sin(phase);
  const s = side === 'L' ? 1 : -1;
  return [
    [`Bip01_${side}_UpperArm`, 'y', s * (run ? 1.0 : 1.18)],
    [`Bip01_${side}_UpperArm`, 'z', (run ? 0.55 : 0.32) * swing - (run ? 0.1 : 0.03)],
    [`Bip01_${side}_Forearm`, 'z', run ? -1.35 - 0.2 * swing : -0.2 - 0.3 * Math.max(0, swing)],
    [`Bip01_${side}_Hand`, 'y', s * -0.12],
  ];
}

/** The walking (or running) pose at a point in the stride (phase 0…2π). */
export function walkPose(phase: number, run = false): Pose {
  const twist = Math.sin(phase) * (run ? 0.13 : 0.08);
  return [
    ...leg('L', phase, run),
    ...leg('R', phase + Math.PI, run),
    ...arm('L', phase, run),
    ...arm('R', phase + Math.PI, run),
    // the hips turn with the forward leg, the chest turns back the other way, the head stays steady
    ['Bip01_Pelvis', 'x', twist],
    ['Bip01_Spine1', 'x', -twist * 1.4],
    ['Bip01_Head', 'x', twist * 0.4],
    // lean into a run; walkers stand tall, the head looking where they go
    ['Bip01_Spine', 'z', run ? 0.16 : 0.03],
    ['Bip01_Head', 'z', run ? -0.12 : -0.03],
    ...hands(run ? 1.3 : 0.8),
  ];
}

/** How far the body rises and falls through a stride (metres; highest mid-step). */
export function strideBob(phase: number, run: boolean) {
  return run ? 0.05 * Math.abs(Math.sin(phase)) - 0.03 : -0.022 * Math.cos(2 * phase) - 0.01;
}

/** Standing at ease: weight a little on one leg, arms loose, hands relaxed. */
export const STANDING_EASY: Pose = [
  ...STANDING,
  ['Bip01_L_Thigh', 'z', 0.04],
  ['Bip01_R_Thigh', 'z', -0.02],
  ['Bip01_L_Calf', 'z', -0.08],
  ['Bip01_L_Foot', 'z', 0.05],
  ['Bip01_Pelvis', 'y', 0.03],
  ['Bip01_Spine1', 'y', -0.03],
  ...hands(0.8),
];

/** On a sports bike: crouched over the tank, hands on clip-ons, knees tucked in. */
export const BIKE_TUCK: Pose = [
  ...SEATED,
  ['Bip01_Spine', 'z', 0.55],
  ['Bip01_Spine1', 'z', 0.15],
  ['Bip01_Head', 'z', -0.55],
  ['Bip01_Neck', 'z', -0.25],
  ['Bip01_L_Thigh', 'z', -0.35],
  ['Bip01_R_Thigh', 'z', -0.35],
  ['Bip01_L_Calf', 'z', -0.45],
  ['Bip01_R_Calf', 'z', -0.45],
  ['Bip01_L_UpperArm', 'z', 1.05],
  ['Bip01_R_UpperArm', 'z', 1.05],
  ['Bip01_L_Forearm', 'z', 0.95],
  ['Bip01_R_Forearm', 'z', 0.95],
  ...hands(1.4),
];

/**
 * A walk and run cycle baked into still frames (plus standing, sitting and riding), so
 * people move without a skeleton. Show a frame by swapping each part's geometry.
 */
export function walkCycle(source: THREE.Group) {
  const pose = (p: Pose) => (bones: Bones) => applyPose(source, bones, p);
  const frames = Array.from({ length: WALK_FRAMES }, (_, i) => bakedPerson(source, `walk${i}`, pose(walkPose((i / WALK_FRAMES) * Math.PI * 2))));
  const run = Array.from({ length: RUN_FRAMES }, (_, i) => bakedPerson(source, `run${i}`, pose(walkPose((i / RUN_FRAMES) * Math.PI * 2, true))));
  const stand = bakedPerson(source, 'stand', pose(STANDING_EASY));
  const sit = bakedPerson(source, 'sit', pose([...SEATED, ...hands(0.8)]));
  const bike = bakedPerson(source, 'bike', pose(BIKE_TUCK));
  return { frames, run, stand, sit, bike };
}

/** Make `person` (a copy of one of the cycle's frames) show `frame`. */
export function showFrame(person: THREE.Object3D, frame: THREE.Object3D) {
  for (let i = 0; i < person.children.length; i++) {
    const to = frame.children[i] as THREE.Mesh | undefined;
    if (to) (person.children[i] as THREE.Mesh).geometry = to.geometry;
  }
}
