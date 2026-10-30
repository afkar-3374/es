import { useSyncExternalStore } from 'react';
import { getMeta } from './map';

/*
 * Cabs: book a ride to a place in Kasaragod and a taxi drives you there along the real
 * roads (public/map/roads.bin, made by tools/build-map.mjs). This file finds the route
 * and holds the ride's state; Cab.tsx drives it, ui/Cab.tsx shows it.
 */

export interface Destination {
  n: string;
  e: string;
  x: number;
  z: number;
  home?: 1;
}

interface Net {
  vx: Float32Array;
  vz: Float32Array;
  /** for each point, the edges leaving it: [edge, forwards?] */
  out: [number, boolean][][];
  ea: Uint32Array;
  eb: Uint32Array;
  ef: Uint32Array;
  en: Uint16Array;
  ec: Uint8Array;
  len: Float32Array;
  sx: Float32Array;
  sz: Float32Array;
}

/** km/h by road class (motorway … service road), for picking the quickest way */
export const ROAD_SPEED = [70, 55, 45, 38, 28, 18];

let netPromise: Promise<Net> | null = null;
function loadNet() {
  netPromise ??= fetch(`${import.meta.env.BASE_URL}map/roads.bin`)
    .then((r) => {
      if (!r.ok) throw new Error(`roads ${r.status}`);
      return r.arrayBuffer();
    })
    .then((buf) => {
      const d = new DataView(buf);
      const nv = d.getUint32(0, true);
      const ne = d.getUint32(4, true);
      const np = d.getUint32(8, true);
      let o = 12;
      const vx = new Float32Array(nv);
      const vz = new Float32Array(nv);
      for (let i = 0; i < nv; i++, o += 8) {
        vx[i] = d.getInt32(o, true) / 10;
        vz[i] = d.getInt32(o + 4, true) / 10;
      }
      const ea = new Uint32Array(ne);
      const eb = new Uint32Array(ne);
      const ef = new Uint32Array(ne);
      const en = new Uint16Array(ne);
      const ec = new Uint8Array(ne);
      const ow = new Uint8Array(ne);
      for (let i = 0; i < ne; i++, o += 16) {
        ea[i] = d.getUint32(o, true);
        eb[i] = d.getUint32(o + 4, true);
        ef[i] = d.getUint32(o + 8, true);
        en[i] = d.getUint16(o + 12, true);
        ec[i] = d.getUint8(o + 14);
        ow[i] = d.getUint8(o + 15);
      }
      const sx = new Float32Array(np);
      const sz = new Float32Array(np);
      for (let i = 0; i < np; i++, o += 8) {
        sx[i] = d.getInt32(o, true) / 10;
        sz[i] = d.getInt32(o + 4, true) / 10;
      }
      const out: [number, boolean][][] = Array.from({ length: nv }, () => []);
      const len = new Float32Array(ne);
      for (let e = 0; e < ne; e++) {
        let L = 0;
        let px = vx[ea[e]];
        let pz = vz[ea[e]];
        for (let k = 0; k <= en[e]; k++) {
          const qx = k < en[e] ? sx[ef[e] + k] : vx[eb[e]];
          const qz = k < en[e] ? sz[ef[e] + k] : vz[eb[e]];
          L += Math.hypot(qx - px, qz - pz);
          px = qx;
          pz = qz;
        }
        len[e] = L;
        out[ea[e]].push([e, true]);
        if (!ow[e]) out[eb[e]].push([e, false]);
      }
      return { vx, vz, out, ea, eb, ef, en, ec, len, sx, sz };
    });
  netPromise.catch(() => (netPromise = null));
  return netPromise;
}

function nearest(net: Net, x: number, z: number) {
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < net.vx.length; i++) {
    if (!net.out[i].length) continue;
    const d = (net.vx[i] - x) ** 2 + (net.vz[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  return best;
}

/** The points of an edge, in the direction travelled. */
function edgePoints(net: Net, e: number, forwards: boolean): [number, number][] {
  const pts: [number, number][] = [[net.vx[net.ea[e]], net.vz[net.ea[e]]]];
  for (let k = 0; k < net.en[e]; k++) pts.push([net.sx[net.ef[e] + k], net.sz[net.ef[e] + k]]);
  pts.push([net.vx[net.eb[e]], net.vz[net.eb[e]]]);
  return forwards ? pts : pts.reverse();
}

export interface Route {
  /** x, z every few metres along the way */
  pts: [number, number][];
  /** road class at each point (sets the speed) */
  cls: number[];
  /** metres along the route at each point */
  at: number[];
  total: number;
}

/** The quickest way by road from (x0, z0) to (x1, z1) (A*), or null. */
export async function findRoute(x0: number, z0: number, x1: number, z1: number): Promise<Route | null> {
  const net = await loadNet();
  const a = nearest(net, x0, z0);
  const b = nearest(net, x1, z1);
  if (a < 0 || b < 0) return null;
  const fastest = ROAD_SPEED[0] / 3.6;
  const h = (v: number) => Math.hypot(net.vx[v] - net.vx[b], net.vz[v] - net.vz[b]) / fastest;
  const g = new Float64Array(net.vx.length).fill(Infinity);
  const via = new Int32Array(net.vx.length).fill(-1);
  const viaFwd = new Uint8Array(net.vx.length);
  g[a] = 0;
  // binary heap of [f, vertex]
  const heap: [number, number][] = [[h(a), a]];
  const push = (item: [number, number]) => {
    heap.push(item);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (heap[p][0] <= heap[i][0]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [f, v] = pop();
    if (v === b) break;
    if (f - h(v) > g[v] + 1e-6) continue;
    for (const [e, fwd] of net.out[v]) {
      const w = fwd ? net.eb[e] : net.ea[e];
      const cost = g[v] + net.len[e] / (ROAD_SPEED[net.ec[e]] / 3.6);
      if (cost < g[w]) {
        g[w] = cost;
        via[w] = e;
        viaFwd[w] = fwd ? 1 : 0;
        push([cost + h(w), w]);
      }
    }
  }
  if (a !== b && via[b] < 0) return null;
  // walk back from the end, then lay the roads out in order
  const legs: [number, boolean][] = [];
  for (let v = b; v !== a; ) {
    const e = via[v];
    const fwd = viaFwd[v] === 1;
    legs.push([e, fwd]);
    v = fwd ? net.ea[e] : net.eb[e];
  }
  legs.reverse();
  const pts: [number, number][] = [];
  const cls: number[] = [];
  for (const [e, fwd] of legs) {
    const p = edgePoints(net, e, fwd);
    for (let k = pts.length ? 1 : 0; k < p.length; k++) {
      pts.push(p[k]);
      cls.push(net.ec[e]);
    }
  }
  if (!pts.length) {
    pts.push([net.vx[a], net.vz[a]]);
    cls.push(4);
  }
  // finish at the door: from the road to the place itself (if it's off the road a little)
  const end = pts[pts.length - 1];
  if (Math.hypot(end[0] - x1, end[1] - z1) > 3 && Math.hypot(end[0] - x1, end[1] - z1) < 20) {
    pts.push([x1, z1]);
    cls.push(5);
  }
  const at = [0];
  for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, cls, at, total: at[at.length - 1] };
}

/**
 * A drive for traffic: from a junction near (x, z) (within `radius`, at least `min` away),
 * carrying on along proper roads (no paths), turning at random, for about `length` metres.
 */
export async function wanderRoute(x: number, z: number, radius: number, min: number, length: number, rand = Math.random): Promise<Route | null> {
  const net = await loadNet();
  const near: number[] = [];
  for (let i = 0; i < net.vx.length; i++) {
    const d = Math.hypot(net.vx[i] - x, net.vz[i] - z);
    if (d < radius && d > min && net.out[i].some(([e]) => net.ec[e] <= 4)) near.push(i);
  }
  if (!near.length) return null;
  let v = near[Math.floor(rand() * near.length)];
  const pts: [number, number][] = [[net.vx[v], net.vz[v]]];
  const cls: number[] = [4];
  let total = 0;
  let came = -1;
  while (total < length) {
    const ways = net.out[v].filter(([e]) => net.ec[e] <= 4 && e !== came);
    if (!ways.length) break;
    // bigger roads more often
    const pick = ways.length === 1 ? ways[0] : ways[Math.floor(rand() * ways.length)];
    const [e, fwd] = pick;
    const p = edgePoints(net, e, fwd);
    for (let k = 1; k < p.length; k++) {
      total += Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]);
      pts.push(p[k]);
      cls.push(net.ec[e]);
    }
    came = e;
    v = fwd ? net.eb[e] : net.ea[e];
  }
  if (pts.length < 2) return null;
  const at = [0];
  for (let k = 1; k < pts.length; k++) at.push(at[k - 1] + Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]));
  return { pts, cls, at, total: at[at.length - 1] };
}

/** The nearest junction on a proper road to (x, z), and which way that road runs from it. */
export async function nearestRoad(x: number, z: number) {
  const net = await loadNet();
  let best = -1;
  let bd = Infinity;
  for (let i = 0; i < net.vx.length; i++) {
    if (!net.out[i].some(([e]) => net.ec[e] <= 4)) continue;
    const d = (net.vx[i] - x) ** 2 + (net.vz[i] - z) ** 2;
    if (d < bd) {
      bd = d;
      best = i;
    }
  }
  if (best < 0) return null;
  const [e, fwd] = net.out[best].find(([e]) => net.ec[e] <= 4)!;
  const p = edgePoints(net, e, fwd);
  const L = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]) || 1;
  return { x: p[0][0], z: p[0][1], dx: (p[1][0] - p[0][0]) / L, dz: (p[1][1] - p[0][1]) / L };
}

/* ── The ride ─────────────────────────────────────────────────── */

export type CabStatus = 'idle' | 'finding' | 'coming' | 'riding';

export interface CabState {
  status: CabStatus;
  to: Destination | null;
  route: Route | null;
  /** metres driven */
  done: number;
  /** current speed, m/s */
  speed: number;
  /** fast travel: 1, 4 or 10 times */
  fast: 1 | 4 | 10;
  /** watch the taxi from behind, or sit inside it */
  view: 'behind' | 'inside';
}

let state: CabState = { status: 'idle', to: null, route: null, done: 0, speed: 0, fast: 1, view: 'behind' };
const listeners = new Set<() => void>();
const set = (patch: Partial<CabState>) => {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
};

export const cab = {
  get: () => state,
  /** set by the cab while it drives (not React state: read it every frame) */
  live: { done: 0, speed: 0 },
  set,
  destinations(): Destination[] {
    return (getMeta() as { destinations?: Destination[] } | null)?.destinations ?? [];
  },
  /** Book a ride from where you are to `to`. */
  async book(to: Destination, fromX: number, fromZ: number) {
    if (state.status !== 'idle') return;
    set({ status: 'finding', to, route: null, done: 0, speed: 0, fast: 1 });
    try {
      const route = await findRoute(fromX, fromZ, to.x, to.z);
      // (you may have cancelled while it looked)
      if (!route || (state.status as CabStatus) !== 'finding') {
        set({ status: 'idle', to: null });
        return route ? 'cancelled' : 'no-route';
      }
      cab.live.done = 0;
      cab.live.speed = 0;
      set({ status: 'coming', route });
      return 'ok';
    } catch {
      set({ status: 'idle', to: null });
      return 'offline';
    }
  },
  /** The cab is here and you're in. */
  start() {
    if (state.status === 'coming') set({ status: 'riding' });
  },
  setFast(fast: 1 | 4 | 10) {
    set({ fast });
  },
  toggleView() {
    set({ view: state.view === 'behind' ? 'inside' : 'behind' });
  },
  /** Jump to just before the end. */
  skip() {
    if (state.route) cab.live.done = Math.max(cab.live.done, state.route.total - 40);
  },
  /** Get out now (or at the end). */
  end() {
    set({ status: 'idle', to: null, route: null, done: 0, speed: 0, fast: 1 });
  },
};

export function useCab() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    () => state
  );
}
