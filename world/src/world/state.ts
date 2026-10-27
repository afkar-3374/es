import * as THREE from 'three';
import type { VehicleKind } from './vehicleModels';

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
  /** Ask the visitor to stand up from their seat */
  standRequest: false,
  /** Riding a vehicle: the camera follows it, the walker is parked out of the way */
  riding: null as null | { eye: THREE.Vector3; yaw: number },
  /** After getting off a vehicle: where to put the walker */
  dismountAt: null as null | THREE.Vector3,
  /** Which way you face (radians, 0 = towards −z), for the map and for others */
  heading: 0,
  /** Where others should draw you: your feet, or the seat you're sitting on */
  avatar: new THREE.Vector3(0, 0.2, 16.5),
  /** Your own vehicle, if you've called one */
  vehicle: null as null | { kind: VehicleKind; color: string; x: number; y: number; z: number; yaw: number; speed: number; ridden: boolean },
  /** Previews only: look from here instead of your eyes */
  freeCam: null as null | { at: THREE.Vector3; yaw: number; pitch: number },
  /** What you last said (shown over your head to others) */
  bubble: null as null | { text: string; at: number },
};

/** Footprint of the Electrosparkzz building on the ground (x/z). */
export const BUILDING = { minX: -12, maxX: 12, minZ: -20, maxZ: 0 };

export const insideBuilding = (x: number, z: number, margin = 0) =>
  x > BUILDING.minX - margin && x < BUILDING.maxX + margin && z > BUILDING.minZ - margin && z < BUILDING.maxZ + margin;
