import { useSyncExternalStore } from 'react';
import { GOOGLE_TILES_KEY } from '../net/config';

/*
 * "Real world" view: Google's Photorealistic 3D Tiles (the Google Earth mesh) instead of the
 * town we draw ourselves. Everything you can bump into stays ours (it's invisible then), so
 * walking, vehicles, cabs and everyone else carry on the same.
 */

const KEY = 'es-world-real';
let on = (() => {
  try {
    return !!GOOGLE_TILES_KEY && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export const real = {
  /** a key is set up, so the view can be offered */
  available: !!GOOGLE_TILES_KEY,
  get on() {
    return on;
  },
  set(v: boolean) {
    on = v && real.available;
    try {
      localStorage.setItem(KEY, on ? '1' : '0');
    } catch {
      /* fine */
    }
    listeners.forEach((l) => l());
  },
};

export function useReal() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => on
  );
}
