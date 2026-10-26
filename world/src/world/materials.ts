import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import { useMemo } from 'react';

const TEX = `${import.meta.env.BASE_URL}tex/`;

export type TexName =
  | 'asphalt_02'
  | 'hexagonal_concrete_paving'
  | 'painted_plaster_wall'
  | 'white_stucco'
  | 'painted_metal_shutter'
  | 'red_laterite_soil_stones'
  | 'sparse_grass'
  | 'concrete'
  | 'clay_roof_tiles'
  | 'terrazzo_tiles'
  | 'wood_floor'
  | 'grey_plaster';

const urls = (name: TexName) => ({
  map: `${TEX}${name}/diff.webp`,
  normalMap: `${TEX}${name}/nor.webp`,
  roughnessMap: `${TEX}${name}/rough.webp`,
});

/**
 * A real-world (PBR) material from a Poly Haven texture set, tiled `repeat` times.
 * `tint` multiplies the colour (e.g. painted plaster in another paint colour).
 */
export function usePBR(name: TexName, repeat: [number, number], options: { tint?: THREE.ColorRepresentation; roughness?: number; normalScale?: number } = {}) {
  const loaded = useTexture(urls(name));
  return useMemo(() => {
    const tex = (t: THREE.Texture, color = false) => {
      const c = t.clone();
      c.wrapS = c.wrapT = THREE.RepeatWrapping;
      c.repeat.set(repeat[0], repeat[1]);
      c.anisotropy = 8;
      if (color) c.colorSpace = THREE.SRGBColorSpace;
      c.needsUpdate = true;
      return c;
    };
    const material = new THREE.MeshStandardMaterial({
      map: tex(loaded.map, true),
      normalMap: tex(loaded.normalMap),
      roughnessMap: tex(loaded.roughnessMap),
      roughness: options.roughness ?? 1,
      color: options.tint ?? '#ffffff',
    });
    const s = options.normalScale ?? 1;
    material.normalScale.set(s, s);
    material.userData.dryRoughness = material.roughness;
    material.userData.baseColor = material.color.clone();
    return material;
  }, [loaded, repeat[0], repeat[1], options.tint, options.roughness, options.normalScale]);
}

/** Outdoor ground gets shinier (wet) in the rain. */
export function applyWetness(materials: THREE.MeshStandardMaterial[], wet: number) {
  for (const m of materials) {
    const dry = (m.userData.dryRoughness as number) ?? 1;
    m.roughness = dry * (1 - wet * 0.6);
    const base = m.userData.baseColor as THREE.Color | undefined;
    if (base) m.color.copy(base).multiplyScalar(1 - wet * 0.18);
  }
}

/** A small repeating texture drawn in code (kerb stripes, road paint, bark…). */
export function canvasTexture(width: number, height: number, draw: (g: CanvasRenderingContext2D) => void, repeat: [number, number] = [1, 1]) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext('2d')!);
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export const glassMaterial = () =>
  new THREE.MeshStandardMaterial({
    color: '#6f8796',
    roughness: 0.03,
    metalness: 0.35,
    transparent: true,
    opacity: 0.24,
    envMapIntensity: 1.3,
    depthWrite: false,
  });
