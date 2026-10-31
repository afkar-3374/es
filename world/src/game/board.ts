import { useSyncExternalStore } from 'react';
import { hooks, net } from '../net/net';
import { game } from './store';

/*
 * The town board: the points of the people in town right now. Each visitor
 * sends their points every so often; nothing is stored, so when someone leaves,
 * they drop off the board.
 */

interface Entry {
  name: string;
  points: number;
  at: number;
}
const others = new Map<string, Entry>();
const STALE = 60_000;
let version = 0;
const listeners = new Set<() => void>();
const emit = () => {
  version++;
  listeners.forEach((l) => l());
};

hooks.score = (id, name, points) => {
  others.set(id, { name: name || 'Visitor', points, at: Date.now() });
  emit();
};

// say your points every few seconds (and drop people who've gone quiet)
setInterval(() => {
  const now = Date.now();
  let changed = false;
  for (const [id, e] of others) {
    if (now - e.at > STALE) {
      others.delete(id);
      changed = true;
    }
  }
  if (changed) emit();
  net.score(game.get().points);
}, 6000);

export interface BoardRow {
  id: string;
  name: string;
  points: number;
}

/** Everyone on the board, best first. `me` is you. */
export function boardRows(me: { id: string; name: string }): BoardRow[] {
  const rows: BoardRow[] = [{ id: me.id, name: me.name || 'You', points: game.get().points }];
  for (const [id, e] of others) rows.push({ id, name: e.name, points: e.points });
  return rows.sort((a, b) => b.points - a.points);
}

export function useBoardVersion(): number {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => version
  );
}
