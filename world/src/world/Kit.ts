import * as THREE from 'three';

/*
 * A small kit for modelling buildings in code: boxes, turned shapes (towers, domes,
 * finials), Kerala roofs, laterite walls with battlements. Everything is gathered into one
 * mesh per material, and the solid parts are noted for colliders.
 *
 * Coordinates are metres: x east, z south, y up (the ground height comes from `G`).
 * `at()` moves and turns the drawing for a while, so a building can be modelled square
 * to itself and then placed.
 */

export type V2 = [number, number];
export type MatKey = 'laterite' | 'plaster' | 'tiles' | 'copper' | 'wood' | 'stone' | 'gold' | 'dark' | 'paving' | 'white' | 'water' | 'green';

/** Metres of wall per texture repeat (u, v) */
const UV_SCALE: Record<MatKey, number> = { laterite: 2, plaster: 2.5, tiles: 1.6, copper: 2, wood: 1.5, stone: 2, gold: 1, dark: 1, paving: 3, white: 2.5, water: 8, green: 2 };

export type Solid = { kind: 'box'; c: THREE.Vector3; q: THREE.Quaternion; h: THREE.Vector3 } | { kind: 'cyl'; c: THREE.Vector3; r: number; hh: number };

export interface SignSpec {
  c: THREE.Vector3;
  yaw: number;
  w: number;
  h: number;
  text: string;
  sub?: string;
}

class Geo {
  pos: number[] = [];
  nor: number[] = [];
  uv: number[] = [];
  col: number[] = [];
}

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export class Kit {
  geos = new Map<MatKey, Geo>();
  solids: Solid[] = [];
  signs: SignSpec[] = [];
  /** colour multiplied into what's drawn next */
  tint = new THREE.Color(1, 1, 1);
  /** where drawing goes now (see `at`) */
  m = new THREE.Matrix4();
  q = new THREE.Quaternion();
  /** ground height at a point in the landmark's own metres */
  constructor(private G: (x: number, z: number) => number) {}

  /** Draw `fn` moved to (x, z) and turned by `yaw` (radians, as three.js turns about y). */
  at(x: number, z: number, yaw: number, fn: () => void) {
    const m = this.m.clone();
    const q = this.q.clone();
    this.m.multiply(new THREE.Matrix4().makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(yaw)));
    this.q.multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw));
    try {
      fn();
    } finally {
      this.m = m;
      this.q = q;
    }
  }

  /** Draw with this colour multiplied in. */
  tinted(c: THREE.ColorRepresentation, fn: () => void, k = 1) {
    const old = this.tint.clone();
    this.tint.set(c).multiplyScalar(k);
    try {
      fn();
    } finally {
      this.tint.copy(old);
    }
  }

  /** Ground height under (x, z) here. */
  gy(x: number, z: number) {
    const p = v3(x, 0, z).applyMatrix4(this.m);
    return this.G(p.x, p.z);
  }

  private geo(m: MatKey) {
    let g = this.geos.get(m);
    if (!g) this.geos.set(m, (g = new Geo()));
    return g;
  }

  /**
   * A flat polygon (corners in order). `out` is roughly the way it faces; the winding is
   * fixed to match. UVs are the corners projected onto the face, so neighbours line up.
   */
  poly(mat: MatKey, local: THREE.Vector3[], out?: THREE.Vector3) {
    const pts = local.map((p) => p.clone().applyMatrix4(this.m));
    // Newell's normal
    const n = v3(0, 0, 0);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      n.x += (a.y - b.y) * (a.z + b.z);
      n.y += (a.z - b.z) * (a.x + b.x);
      n.z += (a.x - b.x) * (a.y + b.y);
    }
    if (n.lengthSq() < 1e-10) return;
    n.normalize();
    if (out && n.dot(out.clone().applyQuaternion(this.q)) < 0) {
      pts.reverse();
      n.negate();
    }
    // texture axes: along the face level with the ground (or along x on flat faces), and up it
    let eu = v3(-n.z, 0, n.x);
    if (eu.lengthSq() < 1e-4) eu = v3(1, 0, 0);
    eu.normalize();
    const ev = n.clone().cross(eu).normalize();
    const s = UV_SCALE[mat];
    const g = this.geo(mat);
    const c = this.tint;
    const put = (p: THREE.Vector3) => {
      g.pos.push(p.x, p.y, p.z);
      g.nor.push(n.x, n.y, n.z);
      g.uv.push(p.dot(eu) / s, p.dot(ev) / s);
      g.col.push(c.r, c.g, c.b);
    };
    for (let i = 1; i + 1 < pts.length; i++) {
      put(pts[0]);
      put(pts[i]);
      put(pts[i + 1]);
    }
  }

  /**
   * A box from its centre and three axes (u along, n up, w across; at right angles, w = u × n)
   * and half sizes along them.
   */
  obb(mat: MatKey, c: THREE.Vector3, u: THREE.Vector3, n: THREE.Vector3, w: THREE.Vector3, hu: number, hn: number, hw: number, solid = false, faces = 63) {
    const P = (a: number, b: number, d: number) => c.clone().addScaledVector(u, a * hu).addScaledVector(n, b * hn).addScaledVector(w, d * hw);
    const F: [THREE.Vector3, number[][]][] = [
      [u, [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
      [u.clone().negate(), [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
      [n, [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
      [n.clone().negate(), [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
      [w, [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
      [w.clone().negate(), [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
    ];
    F.forEach(([out, cs], i) => {
      if (faces & (1 << i)) this.poly(mat, cs.map(([a, b, d]) => P(a, b, d)), out);
    });
    if (solid) {
      const basis = new THREE.Matrix4().makeBasis(u, n, w);
      const q = new THREE.Quaternion().setFromRotationMatrix(basis);
      this.solids.push({ kind: 'box', c: c.clone().applyMatrix4(this.m), q: this.q.clone().multiply(q), h: v3(hu, hn, hw) });
    }
  }

  /** An upright box: centre (x, z), bottom at y0, sizes along x, y, z, turned by yaw. */
  box(mat: MatKey, x: number, y0: number, z: number, sx: number, sy: number, sz: number, yaw = 0, solid = false) {
    const u = v3(Math.cos(yaw), 0, -Math.sin(yaw));
    const w = v3(Math.sin(yaw), 0, Math.cos(yaw));
    // the bottom is never seen
    this.obb(mat, v3(x, y0 + sy / 2, z), u, UP, w, sx / 2, sy / 2, sz / 2, solid, 63 & ~8);
  }

  /** An upright box along the line a → b (centred on it), `thick` across. */
  boxAlong(mat: MatKey, a: V2, b: V2, y0: number, y1: number, thick: number, solid = false, extend = 0) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    if (L < 0.01) return;
    const u = v3(dx / L, 0, dz / L);
    const w = u.clone().cross(UP);
    this.obb(mat, v3((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2), u, UP, w, L / 2 + extend, (y1 - y0) / 2, thick / 2, solid, 63 & ~8);
  }

  /** A shape turned about the upright through (x, z): profile of [radius, height] from bottom to top. */
  lathe(mat: MatKey, x: number, y0: number, z: number, profile: V2[], seg = 16, phase = 0) {
    for (let i = 0; i + 1 < profile.length; i++) {
      const [r0, h0] = profile[i];
      const [r1, h1] = profile[i + 1];
      if (r0 < 1e-4 && r1 < 1e-4) continue;
      for (let s = 0; s < seg; s++) {
        const a0 = phase + (s / seg) * Math.PI * 2;
        const a1 = phase + ((s + 1) / seg) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const out = v3(Math.cos(am) * (h1 - h0), r0 - r1, Math.sin(am) * (h1 - h0));
        const p = (r: number, h: number, a: number) => v3(x + Math.cos(a) * r, y0 + h, z + Math.sin(a) * r);
        this.poly(mat, [p(r0, h0, a0), p(r0, h0, a1), p(r1, h1, a1), p(r1, h1, a0)], out);
      }
    }
  }

  /** An upright cylinder (or frustum) with a flat top; bottom at y0. */
  cyl(mat: MatKey, x: number, y0: number, z: number, r: number, h: number, seg = 16, rTop = r, solid = false) {
    this.lathe(mat, x, y0, z, [[r, 0], [rTop, h], [0, h]], seg);
    if (solid) this.solids.push({ kind: 'cyl', c: v3(x, y0 + h / 2, z).applyMatrix4(this.m), r: Math.max(r, rTop), hh: h / 2 });
  }

  /** A flat-topped slab from a ring (outline), y0 to y1. */
  prism(mat: MatKey, ring: V2[], y0: number, y1: number, top: MatKey = mat) {
    let A = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i];
      const [x1, z1] = ring[(i + 1) % ring.length];
      A += x0 * z1 - x1 * z0;
    }
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length;
    const cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    for (let i = 0; i < ring.length; i++) {
      const [x0, z0] = ring[i];
      const [x1, z1] = ring[(i + 1) % ring.length];
      const sgn = A > 0 ? 1 : -1;
      const out = v3(sgn * (z1 - z0), 0, -sgn * (x1 - x0));
      if (out.lengthSq() < 1e-6) out.set((x0 + x1) / 2 - cx, 0, (z0 + z1) / 2 - cz);
      this.poly(mat, [v3(x0, y0, z0), v3(x1, y0, z1), v3(x1, y1, z1), v3(x0, y1, z0)], out);
    }
    const tris = THREE.ShapeUtils.triangulateShape(
      ring.map(([x, z]) => new THREE.Vector2(x, z)),
      []
    );
    for (const t of tris) this.poly(top, t.map((k) => v3(ring[k][0], y1, ring[k][1])), UP);
  }

  /**
   * A Kerala roof over a w × d plan centred here (w along x): hipped, its slopes curving
   * gently (steep at the ridge, flatter at the eaves), the ridge as long as the hips allow.
   * `apse` rounds the −x end (the "elephant's back" of a gajaprishta shrine); `gables` puts the
   * little triangular gable (mukhappu) of carved wood at the ridge's ends.
   */
  keralaRoof(mat: MatKey, w: number, d: number, y: number, h: number, o: { overhang?: number; apse?: boolean; gables?: boolean; finials?: number } = {}) {
    const ov = o.overhang ?? 0.9;
    const W = w + 2 * ov;
    const D = d + 2 * ov;
    const rx = Math.max(0, (W - D) / 2);
    const ring: V2[] = [];
    if (o.apse) {
      ring.push([W / 2, -D / 2], [W / 2, D / 2]);
      const cx = -W / 2 + D / 2;
      for (let i = 0; i <= 10; i++) {
        const a = Math.PI / 2 + (i / 10) * Math.PI;
        ring.push([cx + Math.cos(a) * (D / 2), Math.sin(a) * (D / 2)]);
      }
    } else ring.push([W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2], [-W / 2, -D / 2]);
    // the apse's ridge ends where its curve starts
    const rx0 = o.apse ? Math.min(rx, -W / 2 + D / 2) : -rx;
    const ridge = (p: V2): V2 => [Math.max(rx0, Math.min(rx, p[0])), 0];
    // eaves → halfway (dipped: the curve) → ridge
    const rings: [V2[], number][] = [
      [ring, y],
      [ring.map((p) => { const r = ridge(p); return [p[0] + (r[0] - p[0]) * 0.5, p[1] + (r[1] - p[1]) * 0.5] as V2; }), y + h * 0.4],
      [ring.map(ridge), y + h],
    ];
    for (let k = 0; k + 1 < rings.length; k++) {
      const [a, ya] = rings[k];
      const [b, yb] = rings[k + 1];
      for (let i = 0; i < ring.length; i++) {
        const j = (i + 1) % ring.length;
        const mx = (ring[i][0] + ring[j][0]) / 2;
        const mz = (ring[i][1] + ring[j][1]) / 2;
        const r = ridge([mx, mz]);
        const out = v3(mx - r[0], h, mz - r[1]);
        this.poly(mat, [v3(a[i][0], ya, a[i][1]), v3(a[j][0], ya, a[j][1]), v3(b[j][0], yb, b[j][1]), v3(b[i][0], yb, b[i][1])], out);
      }
    }
    // the ridge itself, a little proud
    if (rx - rx0 > 0.2) this.boxAlong(mat, [rx0, 0], [rx, 0], y + h - 0.05, y + h + 0.18, 0.3, false, 0.1);
    if (o.gables) {
      const f = 0.42;
      const e = (f * D) / 2;
      for (const s of o.apse ? [1] : [1, -1]) {
        const x0 = s * rx;
        const X = s * (rx + e * 0.75);
        const top = y + h + 0.1;
        const low = y + h - f * h;
        this.poly('wood', [v3(X, top, 0), v3(X, low, -e * 0.85), v3(X, low, e * 0.85)], v3(s, 0, 0));
        // its own little roof, over the gable
        for (const side of [1, -1]) this.poly(mat, [v3(x0 - s * 0.3, top + 0.05, 0), v3(X + s * 0.35, top + 0.05, 0), v3(X + s * 0.35, low - 0.15, side * (e + 0.2)), v3(x0 - s * 0.3, low - 0.15, side * (e + 0.2))], v3(0, 1, side));
        this.finial(X + s * 0.2, top, 0, 0.5);
      }
    }
    if (o.finials) {
      const n = o.finials;
      for (let i = 0; i < n; i++) this.finial(n === 1 ? (rx + rx0) / 2 : rx0 + ((rx - rx0) * i) / (n - 1), y + h + 0.15, 0, 1);
    }
  }

  /** A gold finial (kalasham) standing at y. */
  finial(x: number, y: number, z: number, s: number) {
    this.lathe('gold', x, y, z, [[0.22 * s, 0], [0.3 * s, 0.12 * s], [0.42 * s, 0.4 * s], [0.3 * s, 0.7 * s], [0.12 * s, 0.85 * s], [0.18 * s, 1.0 * s], [0.04 * s, 1.5 * s], [0, 1.6 * s]], 10);
  }

  /** A half-sphere dome of radius r on a short drum, from y. */
  dome(mat: MatKey, x: number, y: number, z: number, r: number) {
    const prof: V2[] = [[r * 1.05, 0], [r * 1.05, r * 0.35]];
    for (let i = 0; i <= 8; i++) {
      const a = (i / 8) * (Math.PI / 2);
      prof.push([Math.cos(a) * r, r * 0.35 + Math.sin(a) * r * 1.1]);
    }
    this.lathe(mat, x, y, z, prof, 18);
    this.finial(x, y + r * 1.42, z, r * 0.35);
  }

  /** A slab whose top runs from a (at height y0) up to b (at y1), filled down to the ground. */
  ramp(mat: MatKey, a: V2, b: V2, y0: number, y1: number, width: number) {
    const dx = b[0] - a[0];
    const dz = b[1] - a[1];
    const L = Math.hypot(dx, dz);
    const w = v3(-dz / L, 0, dx / L).multiplyScalar(width / 2);
    const side = (s: number) => {
      const A = v3(a[0], 0, a[1]).addScaledVector(w, s);
      const B = v3(b[0], 0, b[1]).addScaledVector(w, s);
      return { A0: A.clone().setY(this.gy(a[0], a[1]) - 1), A1: A.clone().setY(y0), B1: B.clone().setY(y1), B0: B.clone().setY(this.gy(b[0], b[1]) - 1) };
    };
    const l = side(-1);
    const r = side(1);
    this.poly(mat, [l.A0, l.B0, l.B1, l.A1], w.clone().negate());
    this.poly(mat, [r.A0, r.B0, r.B1, r.A1], w);
    this.poly('paving', [l.A1, r.A1, r.B1, l.B1], UP);
    this.poly(mat, [l.B0, r.B0, r.B1, l.B1], v3(dx, 0, dz));
    // walkable: a slab along the top
    const u = v3(dx, y1 - y0, dz).normalize();
    const n = w.clone().normalize().cross(u).normalize();
    const ww = u.clone().cross(n);
    const len = Math.hypot(L, y1 - y0);
    const c = v3((a[0] + b[0]) / 2, (y0 + y1) / 2, (a[1] + b[1]) / 2).addScaledVector(n, -0.3);
    const basis = new THREE.Matrix4().makeBasis(u, n, ww);
    this.solids.push({ kind: 'box', c: c.applyMatrix4(this.m), q: this.q.clone().multiply(new THREE.Quaternion().setFromRotationMatrix(basis)), h: v3(len / 2, 0.3, width / 2) });
  }

  /** A name board on two posts, facing +z turned by yaw. */
  sign(x: number, z: number, yaw: number, text: string, sub?: string) {
    const g = this.gy(x, z);
    const ux = Math.cos(yaw);
    const uz = -Math.sin(yaw);
    for (const s of [-1.7, 1.7]) this.box('wood', x + ux * s, g - 0.3, z + uz * s, 0.18, 2.9, 0.18, yaw);
    this.box('wood', x, g + 1.15, z, 3.8, 1.5, 0.12, yaw);
    const c = v3(x, g + 1.9, z).add(v3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.07)).applyMatrix4(this.m);
    const q = new THREE.Euler().setFromQuaternion(this.q.clone().multiply(new THREE.Quaternion().setFromAxisAngle(UP, yaw)), 'YXZ');
    this.signs.push({ c, yaw: q.y, w: 3.6, h: 1.3, text, sub });
  }

  /** Everything drawn so far, one geometry per material. */
  geometries() {
    const out = new Map<MatKey, THREE.BufferGeometry>();
    for (const [k, g] of this.geos) {
      if (!g.pos.length) continue;
      const b = new THREE.BufferGeometry();
      b.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
      b.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
      b.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      b.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
      b.computeBoundingSphere();
      out.set(k, b);
    }
    return out;
  }
}

/* ── Plans ────────────────────────────────────────────────────── */

export function ringArea(ring: V2[]) {
  let A = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x0, z0] = ring[i];
    const [x1, z1] = ring[(i + 1) % ring.length];
    A += x0 * z1 - x1 * z0;
  }
  return A / 2;
}

/** Outward unit normal of edge a → b on a ring of this area's sign. */
function outward(a: V2, b: V2, A: number): V2 {
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const s = A > 0 ? 1 : -1;
  return [(s * (b[1] - a[1])) / L, (-s * (b[0] - a[0])) / L];
}

/** The ring moved d metres outwards (corners mitred, within reason). */
export function offsetRing(ring: V2[], d: number): V2[] {
  const A = ringArea(ring);
  const n = ring.length;
  return ring.map((p, i) => {
    const a = outward(ring[(i - 1 + n) % n], p, A);
    const b = outward(p, ring[(i + 1) % n], A);
    let mx = a[0] + b[0];
    let mz = a[1] + b[1];
    const L = Math.hypot(mx, mz) || 1;
    mx /= L;
    mz /= L;
    const k = d / Math.max(0.5, mx * a[0] + mz * a[1]);
    return [p[0] + mx * k, p[1] + mz * k];
  });
}

/** Drop corners closer than `min` to the last one kept. */
export function simplify(pts: V2[], min: number) {
  const out: V2[] = [pts[0]];
  for (const p of pts.slice(1)) {
    const q = out[out.length - 1];
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= min) out.push(p);
  }
  return out;
}

export function inRing(ring: V2[], x: number, z: number) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i];
    const [xj, zj] = ring[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/** Deterministic noise in 0..1 */
export const hash = (a: number, b = 0) => {
  const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

export interface WallPiece {
  a: V2;
  b: V2;
  top: number;
  /** unit, pointing out of the fort */
  out: V2;
}

/**
 * A laterite curtain wall along a path (a ring when `closed`): pieces a few metres long
 * that follow the ground, with a battlemented parapet and gun holes on the outer face
 * (Bekal's walls have three rows: far, middle and near). Returns the pieces.
 */
export function wallLine(
  k: Kit,
  path: V2[],
  o: { closed?: boolean; h: number; thick: number; parapet?: boolean; holes?: boolean; skip?: (x: number, z: number) => boolean; ruin?: number; seed?: number; mat?: MatKey }
): WallPiece[] {
  const pieces: WallPiece[] = [];
  const A = o.closed ? ringArea(path) : 1;
  const n = path.length;
  const mat = o.mat ?? 'laterite';
  const seed = o.seed ?? 1;
  for (let i = 0; i < (o.closed ? n : n - 1); i++) {
    const p = path[i];
    const q = path[(i + 1) % n];
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 0.05) continue;
    const m = Math.max(1, Math.ceil(L / 7));
    const out = outward(p, q, A);
    for (let j = 0; j < m; j++) {
      const a: V2 = [p[0] + ((q[0] - p[0]) * j) / m, p[1] + ((q[1] - p[1]) * j) / m];
      const b: V2 = [p[0] + ((q[0] - p[0]) * (j + 1)) / m, p[1] + ((q[1] - p[1]) * (j + 1)) / m];
      const mx = (a[0] + b[0]) / 2;
      const mz = (a[1] + b[1]) / 2;
      if (o.skip?.(mx, mz)) continue;
      const g0 = k.gy(a[0], a[1]);
      const g1 = k.gy(b[0], b[1]);
      const gm = k.gy(mx, mz);
      const lo = Math.min(g0, g1, gm);
      const hi = Math.max(g0, g1, gm);
      // a ruin: some lengths have come down
      const r = hash(mx * 0.37 + seed, mz * 0.29);
      const h = o.ruin ? o.h * (r < o.ruin ? 0.25 + r : 1 - 0.25 * hash(mx, mz + seed)) : o.h;
      const top = Math.max((lo + hi) / 2 + h, hi + h * 0.6);
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      // stones vary, and the monsoon blackens some lengths
      const shade = 0.82 + hash(mx * 0.11 + seed, mz * 0.13) * 0.24 - (hash(mz * 0.05, mx * 0.07) < 0.25 ? 0.18 : 0);
      k.tinted('#ffffff', () => {
        k.boxAlong(mat, a, b, lo - 2, top, o.thick, true, o.thick * 0.25);
        // a battered footing
        k.boxAlong(mat, a, b, lo - 1, lo + 1.3, o.thick + 0.7, false, o.thick * 0.25);
      }, shade);
      pieces.push({ a, b, top, out });
      if (o.parapet && h === o.h) {
        const off = o.thick / 2 - 0.35;
        const pa: V2 = [a[0] + out[0] * off, a[1] + out[1] * off];
        const pb: V2 = [b[0] + out[0] * off, b[1] + out[1] * off];
        k.tinted('#ffffff', () => {
          k.boxAlong(mat, pa, pb, top, top + 1.0, 0.7, true, 0.2);
          // merlons with gaps between (the crenels)
          const count = Math.max(1, Math.round(len / 3));
          for (let c = 0; c < count; c++) {
            const t0 = (c + 0.18) / count;
            const t1 = (c + 0.82) / count;
            k.boxAlong(mat, [pa[0] + (pb[0] - pa[0]) * t0, pa[1] + (pb[1] - pa[1]) * t0], [pa[0] + (pb[0] - pa[0]) * t1, pa[1] + (pb[1] - pa[1]) * t1], top + 1.0, top + 1.85, 0.7, true);
          }
        }, shade * 0.97);
      }
      if (o.holes && h === o.h) {
        // gun holes on the outer face, in rows
        const off = o.thick / 2 + 0.02;
        const rows = o.h > 6 ? [top - 2.3, top - 4.8] : [top - 2.0];
        rows.forEach((y, row) => {
          const t = row % 2 ? 0.25 : 0.7;
          const cx = a[0] + (b[0] - a[0]) * t + out[0] * off;
          const cz = a[1] + (b[1] - a[1]) * t + out[1] * off;
          if (y - lo < 1.2) return;
          const ux = (b[0] - a[0]) / len;
          const uz = (b[1] - a[1]) / len;
          k.boxAlong('dark', [cx - ux * 0.2, cz - uz * 0.2], [cx + ux * 0.2, cz + uz * 0.2], y, y + 0.7, 0.08);
        });
      }
    }
  }
  return pieces;
}

/** A round bastion (or tower) at (x, z), r across, standing h above the ground, battlemented. */
export function bastion(k: Kit, x: number, z: number, r: number, h: number, o: { holes?: boolean; base?: number; mat?: MatKey } = {}) {
  const mat = o.mat ?? 'laterite';
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < 8; i++) {
    const g = k.gy(x + Math.cos(i) * r, z + Math.sin(i) * r);
    lo = Math.min(lo, g);
    hi = Math.max(hi, g);
  }
  const top = o.base ?? Math.max((lo + hi) / 2 + h, hi + h * 0.7);
  const seg = Math.max(12, Math.round(r * 3));
  k.tinted('#ffffff', () => {
    // a slight batter: wider at the foot
    k.lathe(mat, x, lo - 2, z, [[r * 1.06, 0], [r, top - lo + 2], [r - 0.7, top - lo + 2]], seg);
    k.lathe('paving', x, top, z, [[r - 0.7, 0], [0, 0]], seg);
    k.solids.push({ kind: 'cyl', c: new THREE.Vector3(x, (lo - 2 + top) / 2, z).applyMatrix4(k.m), r, hh: (top - lo + 2) / 2 });
    // parapet ring, alternate merlons
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * Math.PI * 2;
      const a1 = ((i + 1) / seg) * Math.PI * 2;
      const rr = r - 0.35;
      const p0: V2 = [x + Math.cos(a0) * rr, z + Math.sin(a0) * rr];
      const p1: V2 = [x + Math.cos(a1) * rr, z + Math.sin(a1) * rr];
      k.boxAlong(mat, p0, p1, top, top + (i % 2 ? 1.85 : 1.0), 0.7, true, 0.12);
      if (o.holes && i % 3 === 0) {
        const am = (a0 + a1) / 2;
        const hx = x + Math.cos(am) * (r * 1.02 + 0.03);
        const hz = z + Math.sin(am) * (r * 1.02 + 0.03);
        const tx = -Math.sin(am) * 0.2;
        const tz = Math.cos(am) * 0.2;
        for (const y of h > 6 ? [top - 2.2, top - 4.6] : [top - 2]) if (y - lo > 1.2) k.boxAlong('dark', [hx - tx, hz - tz], [hx + tx, hz + tz], y, y + 0.7, 0.1);
      }
    }
  }, 0.9 + hash(x, z) * 0.15);
  return top;
}

/**
 * A Kerala building: a granite plinth, walls (with a door on the +z side and windows),
 * and tiered roofs, each tier smaller and higher, set on a short wooden neck.
 */
export function keralaBuilding(
  k: Kit,
  w: number,
  d: number,
  o: {
    plinth?: number;
    wallH?: number;
    wall?: MatKey;
    roof?: MatKey;
    tiers?: number;
    roofH?: number;
    apse?: boolean;
    gables?: boolean;
    finials?: number;
    doors?: boolean;
    upper?: { h: number; mat: MatKey };
    open?: boolean;
  } = {}
) {
  const plinth = o.plinth ?? 0.9;
  const wallH = o.wallH ?? 3.4;
  const roof = o.roof ?? 'tiles';
  const tiers = o.tiers ?? 1;
  let lo = Infinity;
  for (const [x, z] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2], [0, 0]]) lo = Math.min(lo, k.gy(x, z));
  const base = lo + plinth;
  // the plinth, moulded: wider at the foot
  k.box('stone', 0, lo - 1, 0, w + 1.0, plinth + 1 - 0.25, d + 1.0, 0, true);
  k.box('stone', 0, base - 0.25, 0, w + 0.7, 0.25, d + 0.7);
  if (o.apse) {
    // the round back, as a turned plinth and wall
    k.lathe('stone', -w / 2 + d / 2, lo - 1, 0, [[d / 2 + 0.5, 0], [d / 2 + 0.5, plinth + 1], [0, plinth + 1]], 16);
  }
  let top = base + wallH;
  if (o.open) {
    // pillars only (a pavilion)
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) k.box('wood', (sx * (w / 2 - 0.3)), base, (sz * (d / 2 - 0.3)), 0.4, wallH, 0.4, 0, true);
    k.box('wood', 0, top - 0.35, d / 2 - 0.3, w, 0.35, 0.3);
    k.box('wood', 0, top - 0.35, -d / 2 + 0.3, w, 0.35, 0.3);
  } else {
    const wall = o.wall ?? 'plaster';
    if (o.apse) {
      const cx = -w / 2 + d / 2;
      k.box(wall, (cx + w / 2) / 2, base, 0, w / 2 - cx, wallH, d, 0, true);
      k.lathe(wall, cx, base, 0, [[d / 2, 0], [d / 2, wallH], [0, wallH]], 16);
      k.solids.push({ kind: 'cyl', c: new THREE.Vector3(cx, base + wallH / 2, 0).applyMatrix4(k.m), r: d / 2, hh: wallH / 2 });
    } else k.box(wall, 0, base, 0, w, wallH, d, 0, true);
    if (o.doors !== false) {
      // a wooden door in a dark frame at the front, windows along the sides
      k.box('wood', 0, base, d / 2 + 0.01, Math.min(2.2, w * 0.3) + 0.4, Math.min(2.6, wallH - 0.4) + 0.2, 0.06);
      k.box('dark', 0, base, d / 2 + 0.04, Math.min(2.2, w * 0.3), Math.min(2.6, wallH - 0.4), 0.06);
      const n = Math.floor(w / 3.5);
      for (let i = 0; i < n; i++) {
        const x = -w / 2 + ((i + 0.5) * w) / n;
        if (Math.abs(x) < 2) continue;
        for (const s of [1, -1]) {
          k.box('wood', x, base + 1.0, s * (d / 2 + 0.01), 1.1, 1.5, 0.06);
          k.box('dark', x, base + 1.1, s * (d / 2 + 0.04), 0.85, 1.3, 0.06);
        }
      }
    }
    if (o.upper) {
      // an upper floor of wood, a little in from the walls below
      k.box('wood', 0, top, 0, w - 0.6, o.upper.h, d - 0.6, 0, true);
      const n = Math.floor((w - 0.6) / 1.2);
      for (let i = 0; i < n; i++) for (const s of [1, -1]) k.box('dark', -w / 2 + 0.3 + (i + 0.5) * ((w - 0.6) / n), top + 0.7, s * (d / 2 - 0.27), 0.12, o.upper.h - 1.2, 0.06);
      top += o.upper.h;
    }
  }
  const roofH = o.roofH ?? Math.min(w, d) * 0.42;
  let tw = w;
  let td = d;
  let y = top;
  for (let t = 0; t < tiers; t++) {
    const last = t === tiers - 1;
    k.keralaRoof(roof, tw, td, y, roofH * (last ? 1 : 0.62), { overhang: t === 0 ? 1.1 : 0.7, apse: o.apse, gables: last && o.gables, finials: last ? o.finials : 0 });
    if (last) break;
    // the next tier sits on a wooden neck rising out of this one
    const nw = tw * 0.72;
    const nd = td * 0.68;
    const neckY = y + roofH * 0.62 * 0.62;
    if (o.apse) {
      const cx = -nw / 2 + nd / 2;
      k.box('wood', (cx + nw / 2) / 2, neckY, 0, nw / 2 - cx, 1.0, nd);
      k.lathe('wood', cx, neckY, 0, [[nd / 2, 0], [nd / 2, 1.0]], 14);
    } else k.box('wood', 0, neckY, 0, nw, 1.0, nd);
    tw = nw;
    td = nd;
    y = neckY + 1.0;
  }
  return { base, top };
}
