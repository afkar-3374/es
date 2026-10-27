import * as THREE from 'three';
import { noRaycast } from './merge';
import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { CuboidCollider, RigidBody } from '@react-three/rapier';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { canvasTexture, usePBR } from './materials';
import { box } from './Neighbours';
import { BEACH, BOUNDS, rng, sandHeight, SEA_LEVEL } from './layout';
import type { PalmSpot } from './Palms';

/*
 * The Arabian Sea on the west edge of town: a paved promenade along Beach Road, sand
 * sloping gently into the water, fishing boats pulled up on the beach, umbrellas and
 * a little tea stall. You can wade in up to your knees.
 */

const Z0 = BOUNDS.minZ - 40;
const Z1 = BOUNDS.maxZ + 40;
const SLOPE = Math.atan(BEACH.drop / (BEACH.sandTop - BEACH.sandBottom));

export const BEACH_PALMS: PalmSpot[] = (() => {
  const r = rng(909);
  const out: PalmSpot[] = [];
  for (let z = BOUNDS.minZ + 6; z < BOUNDS.maxZ - 4; z += 13 + r() * 6) out.push({ x: -215.5 - r() * 3, z, scale: 0.9 + r() * 0.3 });
  for (let i = 0; i < 26; i++) out.push({ x: -222 - r() * 16, z: BOUNDS.minZ + r() * (BOUNDS.maxZ - BOUNDS.minZ), scale: 0.8 + r() * 0.4 });
  return out;
})();

const BOATS: { x: number; z: number; turn: number; color: string }[] = [
  { x: -246, z: -30, turn: 0.15, color: '#2d6cdf' },
  { x: -249, z: -18, turn: -0.1, color: '#c0392b' },
  { x: -244, z: 62, turn: 0.3, color: '#16a085' },
  { x: -251, z: 75, turn: 0.05, color: '#f39c12' },
  { x: -247, z: -120, turn: -0.25, color: '#8e44ad' },
];
const UMBRELLAS: { x: number; z: number; color: string }[] = [
  { x: -228, z: 12, color: '#e84393' },
  { x: -231, z: 24, color: '#f1c40f' },
  { x: -226, z: 36, color: '#2d6cdf' },
  { x: -229, z: -60, color: '#e67e22' },
  { x: -233, z: 140, color: '#27ae60' },
];
const STALL = { x: -217, z: 18 };

export function Beach() {
  const paving = usePBR('hexagonal_concrete_paving', [1, 1]);

  const sand = useMemo(() => {
    const x0 = BEACH.sandTop;
    const x1 = BEACH.sandBottom - 60;
    const g = new THREE.PlaneGeometry(x0 - x1, Z1 - Z0, 40, 8);
    g.rotateX(-Math.PI / 2);
    g.translate((x0 + x1) / 2, 0, (Z0 + Z1) / 2);
    const p = g.attributes.position;
    const uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      p.setY(i, sandHeight(p.getX(i)) - 0.005);
      uv.setXY(i, (uv.getX(i) * (x0 - x1)) / 6, (uv.getY(i) * (Z1 - Z0)) / 6);
    }
    g.computeVertexNormals();
    const tex = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#e6cf9f';
      c.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5000; i++) {
        const v = 180 + Math.random() * 60;
        c.fillStyle = `rgba(${v},${v * 0.86},${v * 0.62},0.5)`;
        c.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5);
      }
    });
    return { g, mat: new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }) };
  }, []);

  const promenade = useMemo(() => {
    const m = paving.clone();
    for (const key of ['map', 'normalMap', 'roughnessMap'] as const) {
      const t = paving[key];
      if (t) {
        m[key] = t.clone();
        m[key]!.repeat.set(3.5 / 2.5, (Z1 - Z0) / 2.5);
        m[key]!.needsUpdate = true;
      }
    }
    return m;
  }, [paving]);

  const props = useMemo(() => {
    const solid: THREE.BufferGeometry[] = [];
    const cloth: THREE.BufferGeometry[] = [];
    const solids: { x: number; y: number; z: number; w: number; h: number; d: number }[] = [];
    // a low kerb along the promenade: low enough to step (or drive) over onto the sand
    for (let z = BOUNDS.minZ; z < BOUNDS.maxZ; z += 30) {
      const len = 26;
      solid.push(box(0.35, 0.26, len, BEACH.sandTop + 0.17, 0.13, z + len / 2, '#c9c2b4'));
      solids.push({ x: BEACH.sandTop + 0.17, y: 0.13, z: z + len / 2, w: 0.35, h: 0.26, d: len });
    }
    // fishing boats (vallam), pulled up on the sand
    for (const b of BOATS) {
      const shape = new THREE.Shape();
      shape.moveTo(-4.2, 0);
      shape.quadraticCurveTo(-3, 1, -1.5, 1);
      shape.lineTo(1.5, 1);
      shape.quadraticCurveTo(3, 1, 4.2, 0);
      shape.quadraticCurveTo(3, -1, 1.5, -1);
      shape.lineTo(-1.5, -1);
      shape.quadraticCurveTo(-3, -1, -4.2, 0);
      const hull = new THREE.ExtrudeGeometry(shape, { depth: 0.85, bevelEnabled: false, curveSegments: 6 });
      hull.rotateX(-Math.PI / 2);
      const c = new THREE.Color(b.color);
      const colors = new Float32Array(hull.attributes.position.count * 3);
      for (let i = 0; i < hull.attributes.position.count; i++) {
        const top = hull.attributes.position.getY(i) > 0.6;
        const col = top ? new THREE.Color('#f4efe6') : c;
        colors.set([col.r, col.g, col.b], i * 3);
      }
      hull.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      hull.rotateY(b.turn);
      const y = sandHeight(b.x);
      hull.translate(b.x, y, b.z);
      solid.push(hull);
      solids.push({ x: b.x, y: y + 0.42, z: b.z, w: 1.9, h: 0.85, d: 1.9 });
      solids.push({ x: b.x - Math.cos(b.turn) * 2.6, y: y + 0.42, z: b.z + Math.sin(b.turn) * 2.6, w: 1.5, h: 0.85, d: 1.5 });
      solids.push({ x: b.x + Math.cos(b.turn) * 2.6, y: y + 0.42, z: b.z - Math.sin(b.turn) * 2.6, w: 1.5, h: 0.85, d: 1.5 });
    }
    // umbrellas
    for (const u of UMBRELLAS) {
      const y = sandHeight(u.x);
      solid.push(box(0.06, 2.3, 0.06, u.x, y + 1.15, u.z, '#eeeeee'));
      const top = new THREE.ConeGeometry(1.5, 0.6, 12, 1, true);
      top.translate(u.x, y + 2.35, u.z);
      const c = new THREE.Color(u.color);
      top.setAttribute('color', new THREE.BufferAttribute(new Float32Array(top.attributes.position.count * 3).map((_, i) => [c.r, c.g, c.b][i % 3]), 3));
      cloth.push(top.toNonIndexed());
      solids.push({ x: u.x, y: y + 1.15, z: u.z, w: 0.1, h: 2.3, d: 0.1 });
    }
    // a tea stall on the promenade (chai and snacks), with a thatched roof
    solid.push(box(2.6, 1.0, 1.4, STALL.x, 0.5, STALL.z, '#8a6a48'));
    solid.push(box(2.6, 0.06, 1.6, STALL.x, 1.03, STALL.z, '#d9cdb6'));
    for (const [dx, dz] of [[-1.25, -0.65], [1.25, -0.65], [-1.25, 0.65], [1.25, 0.65]]) solid.push(box(0.08, 2.4, 0.08, STALL.x + dx, 1.2, STALL.z + dz, '#6b4a2e'));
    const thatch = new THREE.ConeGeometry(2.3, 1.1, 4, 1);
    thatch.rotateY(Math.PI / 4);
    thatch.translate(STALL.x, 2.95, STALL.z);
    const tc = new THREE.Color('#b08d57');
    const th = thatch.toNonIndexed();
    th.setAttribute('color', new THREE.BufferAttribute(new Float32Array(th.attributes.position.count * 3).map((_, i) => [tc.r, tc.g, tc.b][i % 3]), 3));
    cloth.push(th);
    solids.push({ x: STALL.x, y: 0.5, z: STALL.z, w: 2.6, h: 1.0, d: 1.4 });

    const merge = (list: THREE.BufferGeometry[]) => mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    return { solid: merge(solid), cloth: merge(cloth), solids };
  }, []);

  const mats = useMemo(
    () => ({
      solid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }),
      cloth: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }),
    }),
    []
  );

  return (
    <group>
      <mesh geometry={sand.g} material={sand.mat} receiveShadow raycast={noRaycast} />
      <mesh rotation-x={-Math.PI / 2} position={[(BEACH.sandTop + BEACH.promenade) / 2, 0.02, (Z0 + Z1) / 2]} material={promenade} receiveShadow>
        <planeGeometry args={[BEACH.promenade - BEACH.sandTop, Z1 - Z0]} />
      </mesh>
      <mesh geometry={props.solid} material={mats.solid} castShadow receiveShadow raycast={noRaycast} />
      <mesh geometry={props.cloth} material={mats.cloth} castShadow raycast={noRaycast} />
      <Sea />

      <RigidBody type="fixed" colliders={false}>
        {/* the sloping sand (one long tilted box) */}
        <CuboidCollider
          args={[(BEACH.sandTop - BEACH.sandBottom) / 2 / Math.cos(SLOPE) + 10, 0.5, (Z1 - Z0) / 2]}
          position={[
            (BEACH.sandTop + BEACH.sandBottom) / 2 + 0.5 * Math.sin(SLOPE) - 10 * Math.cos(SLOPE),
            sandHeight((BEACH.sandTop + BEACH.sandBottom) / 2) - 0.5 * Math.cos(SLOPE) - 10 * Math.sin(SLOPE),
            (Z0 + Z1) / 2,
          ]}
          rotation={[0, 0, SLOPE]}
        />
        {/* the promenade */}
        <CuboidCollider args={[3, 0.5, (Z1 - Z0) / 2]} position={[BEACH.sandTop + 3, -0.5, (Z0 + Z1) / 2]} />
        {/* far enough out: knee deep, no further */}
        <CuboidCollider args={[0.5, 6, (Z1 - Z0) / 2]} position={[BOUNDS.minX - 0.5, 4, (Z0 + Z1) / 2]} />
        {props.solids.map((s, i) => (
          <CuboidCollider key={i} args={[s.w / 2, s.h / 2, s.d / 2]} position={[s.x, s.y, s.z]} />
        ))}
      </RigidBody>
    </group>
  );
}

/** The sea: rippling water out to the horizon, with surf rolling up the sand. */
function Sea() {
  const { ripples, water, foam, foamTex } = useMemo(() => {
    const ripples = canvasTexture(256, 256, (g) => {
      // a soft bumpy normal map made of overlapping blobs
      g.fillStyle = 'rgb(128,128,255)';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 260; i++) {
        const x = Math.random() * 256;
        const y = Math.random() * 256;
        const r = 6 + Math.random() * 18;
        const grad = g.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        grad.addColorStop(0, 'rgba(170,170,255,0.35)');
        grad.addColorStop(1, 'rgba(90,90,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }, [60, 60]);
    ripples.colorSpace = THREE.NoColorSpace;
    const water = new THREE.MeshStandardMaterial({ color: '#1d6f7c', roughness: 0.08, metalness: 0.25, normalMap: ripples, normalScale: new THREE.Vector2(0.6, 0.6), transparent: true, opacity: 0.9, envMapIntensity: 1.4 });
    const foamTex = canvasTexture(64, 512, (g) => {
      g.clearRect(0, 0, 64, 512);
      // soft bubbly lace, thickest at the water's edge
      for (let i = 0; i < 700; i++) {
        const x = Math.pow(Math.random(), 1.8) * 64;
        const y = Math.random() * 512;
        const r = 2 + Math.random() * 5;
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${0.25 + Math.random() * 0.35})`);
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
      }
    }, [1, 40]);
    const foam = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, opacity: 0.8, depthWrite: false });
    return { ripples, water, foam, foamTex };
  }, []);

  const foamMesh = useMemo(() => ({ current: null as THREE.Mesh | null }), []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    ripples.offset.set(t * 0.004, t * 0.0025);
    // the surf rolls up the sand and slides back
    const wave = (Math.sin(t * 0.55) + 1) / 2;
    if (foamMesh.current) {
      const x = BEACH.waterline + wave * 3;
      foamMesh.current.position.set(x, sandHeight(x) + 0.03, (Z0 + Z1) / 2);
      foam.opacity = 0.25 + (1 - wave) * 0.35;
    }
    foamTex.offset.y = t * 0.01;
  });

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[BEACH.waterline - 3000, SEA_LEVEL, (Z0 + Z1) / 2]} material={water} receiveShadow raycast={noRaycast}>
        <planeGeometry args={[6000, 8000]} />
      </mesh>
      <mesh ref={(m) => (foamMesh.current = m)} rotation={[-Math.PI / 2, -SLOPE, 0]} material={foam}>
        <planeGeometry args={[8, Z1 - Z0]} />
      </mesh>
    </group>
  );
}
