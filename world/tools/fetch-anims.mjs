// Downloads a few motion-capture clips from the Microsoft Rocketbox library (MIT licence,
// the same skeleton as our people) and turns each into a small JSON file the game bakes
// poses from:
//   public/anims/<name>.json  { frames, fps, duration, stride, bones: { Bip01_X: [qx, qy, qz, qw, …] }, hip: [x, y, z, …] }
// One loop of each clip, sampled at even steps; rotations to 4 decimals. The hip (cm) has
// any steady drift taken out, so walks stay in place; `stride` is how far one loop goes (m).
//   node tools/fetch-anims.mjs <cache-dir>
import { mkdirSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

const CACHE = process.argv[2];
if (!CACHE) throw new Error('usage: node tools/fetch-anims.mjs <cache-dir>');
mkdirSync(CACHE, { recursive: true });
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'anims');
mkdirSync(OUT, { recursive: true });

const BASE = 'https://raw.githubusercontent.com/microsoft/Microsoft-Rocketbox/master/Assets/Animations/';
// name → [folder, file, frames to keep over the whole clip]
const CLIPS = {
  f_walk: ['all_animations_max_motextr_xy', 'f_walk_neutral_01.max.fbx', 24],
  f_run: ['all_animations_max_motextr_xy', 'f_run_neutral_01.max.fbx', 16],
  m_walk: ['all_animations_max_motextr_xy', 'm_walk_neutral_01.max.fbx', 24],
  m_run: ['all_animations_max_motextr_xy', 'm_run_neutral_01.max.fbx', 16],
  f_idle: ['all_animations_max_motextr_static', 'f_idle_neutral_01.max.fbx', 40],
  m_idle: ['all_animations_max_motextr_static', 'm_idle_neutral_01.max.fbx', 40],
  f_wave: ['all_animations_max_motextr_static', 'f_wave_01.max.fbx', 36],
  m_wave: ['all_animations_max_motextr_static', 'm_wave_01.max.fbx', 36],
  f_sit: ['all_animations_max_motextr_static', 'f_sit_chair_idle_neutral_01.max.fbx', 40],
  f_talk: ['all_animations_max_motextr_static', 'f_gestic_talk_relaxed_01.max.fbx', 48],
};

// the loader only needs a little of a browser
globalThis.self ??= globalThis;
globalThis.window ??= globalThis;
globalThis.document ??= { createElementNS: () => ({ style: {}, addEventListener() {}, removeEventListener() {} }) };

const loader = new FBXLoader();
for (const [name, [folder, file, frames]] of Object.entries(CLIPS)) {
  const path = join(CACHE, file);
  if (!existsSync(path)) {
    console.log(`downloading ${file}`);
    const res = await fetch(BASE + folder + '/' + encodeURIComponent(file));
    if (!res.ok) throw new Error(`${file}: ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(path);
  const fbx = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const clip = fbx.animations[0];
  if (!clip) throw new Error(`${file}: no animation`);
  const mixer = new THREE.AnimationMixer(fbx);
  const action = mixer.clipAction(clip);
  action.play();
  const bones = {};
  fbx.traverse((o) => {
    if (o.isBone) bones[o.name] = o;
  });
  const out = { frames, fps: frames / clip.duration, duration: +clip.duration.toFixed(3), bones: {}, hip: [] };
  for (const n of Object.keys(bones)) out.bones[n] = [];
  for (let f = 0; f < frames; f++) {
    mixer.setTime((f / frames) * clip.duration);
    for (const [n, b] of Object.entries(bones)) out.bones[n].push(...b.quaternion.toArray().map((v) => Math.round(v * 1e4) / 1e4));
    const hip = bones.Bip01 ?? bones.Bip01_Pelvis;
    out.hip.push(...hip.position.toArray().map((v) => Math.round(v * 10) / 10));
  }
  // walks and runs travel: note how far one loop goes, then take the drift out
  mixer.setTime(clip.duration * 0.999);
  const hipEnd = (bones.Bip01 ?? bones.Bip01_Pelvis).position.clone();
  const dx = (hipEnd.x - out.hip[0]) / 0.999;
  const dz = (hipEnd.z - out.hip[2]) / 0.999;
  out.stride = Math.round(Math.hypot(dx, dz)) / 100;
  const [x0, , z0] = out.hip;
  for (let f = 0; f < frames; f++) {
    out.hip[f * 3] = Math.round((out.hip[f * 3] - x0 - (dx * f) / frames) * 10) / 10;
    out.hip[f * 3 + 2] = Math.round((out.hip[f * 3 + 2] - z0 - (dz * f) / frames) * 10) / 10;
  }
  // bones that never move are left out
  for (const [n, q] of Object.entries(out.bones)) {
    let still = true;
    for (let i = 4; i < q.length && still; i++) if (Math.abs(q[i] - q[i % 4]) > 2e-3) still = false;
    if (still) out.bones[n] = q.slice(0, 4);
  }
  const json = JSON.stringify(out);
  writeFileSync(join(OUT, `${name}.json`), json);
  console.log(`${name}: ${clip.duration.toFixed(2)} s, stride ${out.stride} m, ${(json.length / 1024).toFixed(0)} KB`);
}
