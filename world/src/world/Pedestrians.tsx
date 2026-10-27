import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { showFrame, usePersonSource, walkCycle, WALK_FRAMES } from './people';
import { BEACH, ROADS, rng, segmentsOf } from './layout';
import { SEGMENTS } from './Street';
import { world } from './state';
import { LOOKS } from '../net/net';

/*
 * People out and about on the footpaths: they stroll up and down, pause now and then,
 * and turn back at corners. Their walk is a baked cycle (no skeletons), and only the
 * ones near you are drawn.
 */

interface Path {
  /** walks along x (at z = c) or along z (at x = c) */
  axis: 'x' | 'z';
  c: number;
  from: number;
  to: number;
}

const PATHS: Path[] = (() => {
  const out: Path[] = [];
  // the main street's raised footpaths
  for (const [a, b] of SEGMENTS) {
    out.push({ axis: 'x', c: 3.2, from: a + 1, to: b - 1 });
    out.push({ axis: 'x', c: 16.4, from: a + 1, to: b - 1 });
  }
  // every other road's footpaths
  for (const r of ROADS) {
    if (r.id === 'main') continue;
    for (const [a, b] of segmentsOf(r, 2.5)) {
      for (const side of [-1, 1]) {
        if (r.id === 'coast' && side === -1) continue;
        out.push({ axis: r.axis, c: r.c + side * (r.w / 2 + 1.3), from: a + 1, to: b - 1 });
      }
    }
  }
  // the promenade by the sea
  out.push({ axis: 'z', c: (BEACH.promenade + BEACH.sandTop) / 2, from: -200, to: 220 });
  return out.filter((p) => p.to - p.from > 8);
})();

const COUNT = 26;
const DRAW = 85; // metres

interface Walker {
  path: Path;
  s: number;
  dir: 1 | -1;
  speed: number;
  look: number;
  pause: number;
  phase: number;
  offset: number;
}

export function Pedestrians() {
  const sources = [usePersonSource(LOOKS[0]), usePersonSource(LOOKS[1]), usePersonSource(LOOKS[2])];
  const cycles = useMemo(() => sources.map((s) => walkCycle(s)), [sources[0], sources[1], sources[2]]);
  const walkers = useMemo<Walker[]>(() => {
    const r = rng(4242);
    // more people on the main street, the rest spread around town
    return Array.from({ length: COUNT }, (_, i) => {
      const path = i < 10 ? PATHS[Math.floor(r() * SEGMENTS.length * 2)] : PATHS[Math.floor(r() * PATHS.length)];
      return { path, s: path.from + r() * (path.to - path.from), dir: r() < 0.5 ? 1 : -1, speed: 1.1 + r() * 0.5, look: Math.floor(r() * 3), pause: 0, phase: r() * 10, offset: (r() - 0.5) * 1.2 };
    });
  }, []);
  const people = useMemo(() => walkers.map((w) => cycles[w.look].frames[0].clone()), [walkers, cycles]);
  const group = useRef<THREE.Group>(null);
  const rand = useMemo(() => rng(99), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const p = world.player;
    walkers.forEach((w, i) => {
      const person = people[i];
      // stroll; now and then stop for a moment (looking at a shop, waiting for a friend)
      if (w.pause > 0) w.pause -= dt;
      else {
        w.s += w.speed * w.dir * dt;
        if (rand() < dt * 0.02) w.pause = 2 + rand() * 5;
      }
      if (w.s > w.path.to || w.s < w.path.from) {
        w.dir = (w.s > w.path.to ? -1 : 1) as 1 | -1;
        w.s = Math.min(Math.max(w.s, w.path.from), w.path.to);
      }
      const across = w.path.c + w.offset;
      const x = w.path.axis === 'x' ? w.s : across;
      const z = w.path.axis === 'x' ? across : w.s;
      const near = Math.hypot(x - p.x, z - p.z) < DRAW;
      person.visible = near;
      if (!near) return;
      const ground = w.path.axis === 'x' && Math.abs(w.path.c - 10) < 8 ? 0.16 : 0.02; // the main street's footpaths are raised
      person.position.set(x, ground, z);
      // the models face +z; turn them along the path
      person.rotation.y = w.path.axis === 'x' ? (w.dir === 1 ? Math.PI / 2 : -Math.PI / 2) : w.dir === 1 ? 0 : Math.PI;
      const cycle = cycles[w.look];
      if (w.pause > 0) showFrame(person, cycle.stand);
      else {
        w.phase += dt * (2.2 + w.speed * 1.6);
        showFrame(person, cycle.frames[Math.floor(((w.phase / (Math.PI * 2)) % 1) * WALK_FRAMES)]);
      }
    });
  });

  return (
    <group ref={group}>
      {people.map((m, i) => (
        <primitive key={i} object={m} />
      ))}
    </group>
  );
}
