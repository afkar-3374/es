import * as THREE from 'three';

/**
 * Live values shared by everything in the world, read every frame (not React state,
 * so nothing re-renders 60 times a second).
 */
export const world = {
  /** Where the visitor's feet are */
  player: new THREE.Vector3(0, 0.2, 16.5),
  /** 0 = dry, 1 = soaking wet ground */
  wet: 0,
  /** 0 = daytime, 1 = full night (lamps on) */
  night: 0,
  /** km/h */
  wind: 8,
  /** true while the visitor is inside the building (no rain indoors) */
  indoors: false,
  /** Sitting in a chair: where your eyes are and which way you face; null when standing */
  seat: null as null | { eye: THREE.Vector3; yaw: number; standAt: THREE.Vector3 },
  /** Current rain strength 0–1 (for rain on windows and sounds) */
  rain: 0,
};

/** Footprint of the Electrosparkzz building on the ground (x/z). */
export const BUILDING = { minX: -12, maxX: 12, minZ: -20, maxZ: 0 };

export const insideBuilding = (x: number, z: number, margin = 0) =>
  x > BUILDING.minX - margin && x < BUILDING.maxX + margin && z > BUILDING.minZ - margin && z < BUILDING.maxZ + margin;
