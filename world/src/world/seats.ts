import * as THREE from 'three';
import { ui, type Interactable } from './interact';
import { world } from './state';

/**
 * A place to sit. `seat` is the point on the seat cushion, `yaw` which way you face
 * (0 = towards −z, π = towards +z), `standAt` where you step to when you stand up.
 */
export function seatInteract(label: string, seat: THREE.Vector3, yaw: number, standAt: THREE.Vector3, eyeAbove = 0.72): Interactable {
  return {
    label,
    reach: 3,
    onUse: () => {
      if (ui.get().riding) return;
      world.seat = { eye: seat.clone().add(new THREE.Vector3(0, eyeAbove, 0)), yaw, standAt };
      ui.setSeated(true);
    },
  };
}

export function standUp() {
  if (world.seat) world.standRequest = true;
}
