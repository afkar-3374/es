import { useSyncExternalStore } from 'react';
import { world } from '../world/state';
import { getMeta } from '../world/map';
import { ui } from '../world/interact';
import { game } from './store';
import { sfx } from './sfx';

/*
 * Exploring: the first time you walk into a named place (a town, a village, a
 * suburb), you discover it: a little reward, and it goes on your explore map.
 */

const KEY = 'es-town-discovered';
const REACH = 90; // metres from the middle of a place
const REWARD = 10;

function load(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

let found = new Set<string>(load());
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

function check() {
  const meta = getMeta();
  if (!meta) return;
  const p = world.player;
  for (const pl of meta.places) {
    if (found.has(pl.n)) continue;
    if (Math.hypot(pl.x - p.x, pl.z - p.z) > REACH) continue;
    found = new Set([...found, pl.n]);
    try {
      localStorage.setItem(KEY, JSON.stringify([...found]));
    } catch {
      /* not saved: fine for this visit */
    }
    game.addPoints(REWARD);
    sfx.crossed();
    ui.toast(`📍 New place: ${pl.n}! +${REWARD} points`);
    emit();
    return; // one at a time
  }
}

setInterval(check, 1000);

export const discovered = () => found;

export function useDiscovered(): { names: Set<string>; total: number } {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
  return { names: found, total: getMeta()?.places.length ?? 0 };
}
