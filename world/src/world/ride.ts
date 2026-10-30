import type { VehicleKind } from './vehicleModels';

/**
 * Riding a vehicle: the Vehicles component registers how to call your vehicle,
 * get off and honk. (Kept separate so the on-screen buttons don't need the 3D code.)
 */
export const ride = {
  call: (_kind: VehicleKind) => {},
  dismount: () => {},
  honk: () => {},
  /** riding: from behind the vehicle ('chase') or from the seat ('seat') */
  view: 'chase' as 'chase' | 'seat',
  toggleView: () => {
    ride.view = ride.view === 'chase' ? 'seat' : 'chase';
  },
};
