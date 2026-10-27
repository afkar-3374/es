import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** For big scenery nobody clicks: skip it when looking for what's under the crosshair. */
export const noRaycast = () => {};

/**
 * Fewer draw calls for a model built from many small meshes: every mesh that never moves on
 * its own is baked into one mesh per material under `root`, and the originals are hidden.
 * Parts tagged `userData.wheel` (they spin), `userData.keep` (they move, or come and go) or
 * `userData.interact` (they can be clicked) are merged separately, inside themselves; hidden
 * parts are left alone.
 * Returns a function that undoes it.
 */
export function mergeStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const groups = new Map<string, { material: THREE.Material; geos: THREE.BufferGeometry[]; cast: boolean; receive: boolean }>();
  const hidden: THREE.Object3D[] = [];
  const undo: (() => void)[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o !== root) {
      // hidden for now (shown later by its owner): leave it alone
      if (!o.visible || o.userData.merged) return;
      // things that move, appear or can be clicked keep their own parts together
      if (o.userData.wheel || o.userData.keep || o.userData.interact) {
        undo.push(mergeStatic(o));
        return;
      }
    }
    const mesh = o as THREE.Mesh;
    const special =
      (mesh as THREE.SkinnedMesh).isSkinnedMesh || (mesh as THREE.InstancedMesh).isInstancedMesh || (mesh.geometry as THREE.InstancedBufferGeometry)?.isInstancedBufferGeometry || Array.isArray(mesh.material);
    if (mesh.isMesh && !special && mesh.visible) {
      const material = mesh.material as THREE.Material & { vertexColors?: boolean };
      if (!material.vertexColors) {
        let g = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
        if (!g.attributes.normal) g.computeVertexNormals();
        if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
        g.morphAttributes = {};
        g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toRoot, mesh.matrixWorld));
        const entry = groups.get(material.uuid) ?? { material, geos: [], cast: false, receive: false };
        entry.geos.push(g);
        entry.cast ||= mesh.castShadow;
        entry.receive ||= mesh.receiveShadow;
        groups.set(material.uuid, entry);
        hidden.push(mesh);
        g = null as unknown as THREE.BufferGeometry;
      }
    }
    for (const c of o.children) visit(c);
  };
  visit(root);
  const added: THREE.Mesh[] = [];
  for (const { material, geos, cast, receive } of groups.values()) {
    if (geos.length < 2) {
      geos.forEach((g) => g.dispose());
      continue;
    }
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, material);
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    mesh.userData.merged = true;
    root.add(mesh);
    added.push(mesh);
  }
  // hide only what was actually merged
  const mergedMats = new Set(added.map((m) => (m.material as THREE.Material).uuid));
  for (const h of hidden) if (mergedMats.has(((h as THREE.Mesh).material as THREE.Material).uuid)) h.visible = false;
  return () => {
    undo.forEach((u) => u());
    for (const m of added) {
      root.remove(m);
      m.geometry.dispose();
    }
    for (const h of hidden) h.visible = true;
  };
}
