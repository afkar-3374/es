import * as THREE from 'three';
import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { SEX, showFrame, useClips, usePersonSource, walkCycle, WALK_FRAMES } from './people';
import { LOOKS } from '../net/net';
import { wanderRoute, type Route } from './cab';
import { along } from './Cab';
import { groundAt } from './map';
import { world } from './state';
import { useQuality } from './quality';
import { useReal } from './real';

/*
 * People out and about: walking along the side of the road near you, at their own pace,
 * now and then stopping for a moment. Each walks a few hundred metres, then someone else
 * turns up somewhere nearby.
 */

const COUNT = [6, 10, 16];
const SPAWN: [number, number] = [25, 170];
const GONE = 260;

/** (previews: where everyone is walking) */
const walkers = new Set<{ x: number; z: number }>();
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esPeople: walkers });

/** How far from the road's middle people walk, by road class (they keep to the edge). */
const EDGE = [7, 6, 5, 4.2, 3.4, 2.6];

interface Walker {
  route: Route;
  done: number;
  side: number;
  speed: number;
  pause: number;
}

function Person({ seed }: { seed: number }) {
  const lookName = LOOKS[seed % LOOKS.length];
  const source = usePersonSource(lookName);
  const sex = SEX[lookName] ?? 'f';
  const clips = useClips([`${sex}_walk`, `${sex}_run`, `${sex}_idle`] as const);
  const cycle = useMemo(() => walkCycle(source, { walk: clips[`${sex}_walk`], run: clips[`${sex}_run`], idle: clips[`${sex}_idle`] }), [source, clips, sex]);
  const model = useMemo(() => {
    const m = cycle.frames[0].clone();
    m.traverse((o) => (o.castShadow = true));
    return m;
  }, [cycle]);
  const g = useRef<THREE.Group>(null);
  const [w, setW] = useState<Walker | null>(null);
  const busy = useRef(false);
  const phase = useRef(Math.random() * 10);
  const here = useMemo(() => ({ x: 0, z: 0, dx: 0, dz: 0, cls: 4 }), []);
  const pos = useMemo(() => ({ x: 0, z: 0 }), []);
  useEffect(() => {
    walkers.add(pos);
    return () => void walkers.delete(pos);
  }, [pos]);

  const start = () => {
    if (busy.current) return;
    busy.current = true;
    const p = world.player;
    wanderRoute(p.x, p.z, SPAWN[1], SPAWN[0], 260).then((route) => {
      busy.current = false;
      if (route) setW({ route, done: Math.random() * Math.min(60, route.total / 2), side: Math.random() < 0.5 ? 1 : -1, speed: 1.15 + Math.random() * 0.35, pause: 0 });
    });
  };
  useEffect(() => {
    const t = setTimeout(start, 600 + seed * 400);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame((_, delta) => {
    const o = g.current;
    if (!w || !o) return;
    const dt = Math.min(delta, 0.1);
    const p = world.player;
    along(w.route, w.done, here);
    const edge = EDGE[Math.min(here.cls, EDGE.length - 1)];
    const x = here.x + here.dz * edge * w.side;
    const z = here.z - here.dx * edge * w.side;
    if (w.done >= w.route.total - 1 || Math.hypot(x - p.x, z - p.z) > GONE) {
      setW(null);
      start();
      return;
    }
    // a pause now and then (looking at a shop, waiting for someone)
    if (w.pause > 0) w.pause -= dt;
    else if (Math.random() < dt * 0.02) w.pause = 2 + Math.random() * 4;
    const moving = w.pause <= 0;
    if (moving) w.done += w.speed * dt;
    o.position.set(x, groundAt(x, z), z);
    pos.x = x;
    pos.z = z;
    // facing the way they walk (turned as everyone else in town is: Peers.tsx)
    o.rotation.y = Math.atan2(here.dx, here.dz);
    const far = Math.hypot(x - p.x, z - p.z) > 120;
    if (!moving) showFrame(model, cycle.stand);
    else if (!far) {
      phase.current += (dt * Math.PI * 2 * w.speed) / cycle.strides.walk;
      const t = (phase.current / (Math.PI * 2)) % 1;
      showFrame(model, cycle.frames[Math.floor(t * WALK_FRAMES)]);
    }
  });

  if (!w) return null;
  return (
    <group ref={g}>
      <primitive object={model} />
    </group>
  );
}

export function Pedestrians() {
  const { level } = useQuality();
  const real = useReal();
  return (
    <group visible={!real}>
      {Array.from({ length: COUNT[level] }, (_, i) => (
        <Suspense key={i} fallback={null}>
          <Person seed={i * 3 + 1} />
        </Suspense>
      ))}
    </group>
  );
}
