import { useSyncExternalStore } from 'react';
import * as THREE from 'three';
import { world } from '../world/state';
import { ui } from '../world/interact';
import { ITEMS, MAX_LIFE, CLINIC_DOOR, CROSSING, RECIPES, SOURCE_BY_ID, SOURCES, TUNE } from './catalog';
import { specialItem } from './festival';
import { sfx } from './sfx';

/*
 * The town game: points, life, the bag, and which panel is open.
 * Points, life, the bag and gear are saved in this browser (localStorage), so they
 * come back on a reload; a save code moves them to another browser. Harvest stock
 * regrows in memory (it's the town's, not yours).
 */

export interface GameState {
  points: number;
  life: number;
  /** how many of each item you carry */
  inv: Record<string, number>;
  /** gear you own and wear */
  owned: Record<string, boolean>;
  /** the shop panel open, or null */
  shop: string | null;
  /** the bag open */
  bag: boolean;
  /** the town board open */
  board: boolean;
  /** when you were last hurt (for the red flash and for regrowing life) */
  hurtAt: number;
  /** what's left on each harvest source */
  stock: Record<string, number>;
}

const KEY = 'es-town-game-v1';
const START_POINTS = 60;

function freshStock(): Record<string, number> {
  return Object.fromEntries(SOURCES.map((s) => [s.id, s.max]));
}

type Saved = Pick<GameState, 'points' | 'life' | 'inv' | 'owned'>;

/** Keep only sane values (a save might be from an older version, or pasted in by hand). */
function sanitize(j: unknown): Saved | null {
  if (!j || typeof j !== 'object') return null;
  const o = j as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : d);
  const counts = (v: unknown) =>
    Object.fromEntries(
      Object.entries((v ?? {}) as Record<string, unknown>)
        .filter(([k, n]) => ITEMS[k] && typeof n === 'number' && n > 0)
        .map(([k, n]) => [k, Math.min(9999, Math.floor(n as number))])
    );
  const owned = Object.fromEntries(
    Object.keys((o.owned ?? {}) as object)
      .filter((k) => ITEMS[k]?.kind === 'gear')
      .map((k) => [k, true])
  );
  return { points: Math.floor(num(o.points, START_POINTS)), life: Math.min(MAX_LIFE, num(o.life, MAX_LIFE)), inv: counts(o.inv), owned };
}

function load(): Saved {
  const fallback: Saved = { points: START_POINTS, life: MAX_LIFE, inv: {}, owned: {} };
  try {
    const raw = localStorage.getItem(KEY);
    return (raw && sanitize(JSON.parse(raw))) || fallback;
  } catch {
    return fallback;
  }
}

function save(s: GameState) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ points: s.points, life: s.life, inv: s.inv, owned: s.owned }));
  } catch {
    /* private window or blocked storage: the game still works, it just won't remember */
  }
}

const saved = load();
let state: GameState = { ...saved, shop: null, bag: false, board: false, hurtAt: 0, stock: freshStock() };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (patch: Partial<GameState>) => {
  state = { ...state, ...patch };
  emit();
};
const commit = (patch: Partial<GameState>) => {
  set(patch);
  save(state);
};

/** Next time each source grows one more back. */
const growAt: Record<string, number> = {};
/** Warnings already shown, so a storm doesn't repeat the same toast every quarter second. */
const warned = { rain: false, heat: false };
/** Outdoor temperature (°C), set from the live weather. */
let temperature = 28;
let lastHit = 0;
/** Which side of the zebra crossing you stepped on from ('n' or 's'), while you're on it. */
let crossFrom: 'n' | 's' | null = null;

const WHO: Record<string, string> = { car: 'A car', auto: 'An auto-rickshaw', bus: 'A bus', bike: 'A bike', cab: 'A cab' };

/** What one of an item sells for right now (today's special pays double; a town map adds a fifth). */
export function sellPrice(itemId: string): { price: number; special: boolean } {
  const base = ITEMS[itemId]?.sell ?? 0;
  const special = itemId === specialItem();
  let price = base * (special ? TUNE.specialBonus : 1);
  if (state.owned.map) price *= TUNE.mapBonus;
  return { price: Math.round(price), special };
}

function inCrossing(): boolean {
  const p = world.player;
  return p.x > CROSSING.x0 && p.x < CROSSING.x1 && p.z > CROSSING.z0 && p.z < CROSSING.z1;
}

function pickFrom(id: string) {
  const src = SOURCE_BY_ID[id];
  if (!src) return;
  const now = performance.now();
  const have = state.stock[id] ?? 0;
  const item = ITEMS[src.item];
  if (have <= 0) return ui.toast(`Nothing left on this ${src.kind === 'palm' ? 'palm' : 'plant'}. It grows back soon.`);
  if (have === src.max) growAt[id] = now + src.regrow;
  set({ stock: { ...state.stock, [id]: have - 1 } });
  commit({ inv: { ...state.inv, [src.item]: (state.inv[src.item] ?? 0) + 1 } });
  sfx.pick();
  ui.toast(`+1 ${item.emoji} ${item.name}`);
}

/** Fainting: you lose some points, and wake up at the clinic with a little life. */
function faint() {
  const lost = Math.floor(state.points * TUNE.faintLoss);
  commit({ points: state.points - lost, life: TUNE.faintLife, shop: null, bag: false, board: false, hurtAt: performance.now() });
  sfx.faint();
  world.dismountAt = new THREE.Vector3(CLINIC_DOOR.x, 0.16, CLINIC_DOOR.z);
  ui.showCard({
    emoji: '😵',
    title: 'You fainted!',
    text: `A kind neighbour took you to the Kasaragod Clinic. You dropped ${lost} points on the way. Rest a while: life comes back slowly when you’re safe.`,
  });
}

export const game = {
  get: () => state,

  /** Pick one from a harvest source (coconut palm, mango tree, flower shrub, marigold bed). */
  pick: pickFrom,

  openShop(id: string | null) {
    if (id && state.bag) set({ bag: false });
    set({ shop: id, board: false });
    if (id && document.pointerLockElement) document.exitPointerLock();
  },

  toggleBag() {
    if (ui.get().card || ui.get().book) return;
    const bag = !state.bag;
    set({ bag, shop: null, board: false });
    if (bag && document.pointerLockElement) document.exitPointerLock();
  },

  toggleBoard() {
    if (ui.get().card || ui.get().book) return;
    const board = !state.board;
    set({ board, shop: null, bag: false });
    if (board && document.pointerLockElement) document.exitPointerLock();
  },

  /** A shop, the bag or the board is open: the visitor stops walking. */
  modalOpen: () => state.shop !== null || state.bag || state.board,

  /** Sell one (or every) of an item at the Mart. */
  sell(itemId: string, all = false) {
    const have = state.inv[itemId] ?? 0;
    const n = all ? have : Math.min(1, have);
    const { price, special } = sellPrice(itemId);
    if (!price || n <= 0) return;
    commit({ inv: { ...state.inv, [itemId]: have - n }, points: state.points + n * price });
    sfx.sell();
    ui.toast(`Sold ${n} ${ITEMS[itemId].emoji} for +${n * price} points${special ? ' (today’s special!)' : ''}`);
  },

  /** Make a garland from the flowers you carry. */
  craft(recipeId: string) {
    const r = RECIPES.find((x) => x.id === recipeId);
    if (!r) return;
    const can = Object.entries(r.needs).every(([k, n]) => (state.inv[k] ?? 0) >= n);
    if (!can) return ui.toast('You need more flowers for that.');
    const inv = { ...state.inv };
    for (const [k, n] of Object.entries(r.needs)) inv[k] -= n;
    inv[r.makes] = (inv[r.makes] ?? 0) + 1;
    commit({ inv });
    sfx.craft();
    ui.toast(`Made a ${ITEMS[r.makes].name.toLowerCase()} ${ITEMS[r.makes].emoji}`);
  },

  /** Buy from a shop: consumables go in the bag, gear is worn from then on. */
  buy(itemId: string) {
    const item = ITEMS[itemId];
    if (!item?.buy) return;
    if (item.kind === 'gear' && state.owned[itemId]) return ui.toast(`You already have a ${item.name.toLowerCase()}.`);
    if (state.points < item.buy) return ui.toast(`You need ${item.buy - state.points} more points for that.`);
    const points = state.points - item.buy;
    if (item.kind === 'gear') commit({ points, owned: { ...state.owned, [itemId]: true } });
    else commit({ points, inv: { ...state.inv, [itemId]: (state.inv[itemId] ?? 0) + 1 } });
    sfx.buy();
    ui.toast(item.kind === 'gear' ? `You’re wearing your new ${item.name.toLowerCase()} ${item.emoji}` : `Bought ${item.emoji} ${item.name}`);
  },

  /** The clinic's check-up: back to full life, for a fee. */
  treat() {
    if (state.life >= MAX_LIFE) return ui.toast('You’re feeling fine already!');
    if (state.points < TUNE.treatPrice) return ui.toast(`The check-up costs ${TUNE.treatPrice} points.`);
    commit({ points: state.points - TUNE.treatPrice, life: MAX_LIFE });
    sfx.heal();
    ui.toast('Good as new! Take care on the road.');
  },

  /** Use a consumable from the bag. */
  use(itemId: string) {
    const item = ITEMS[itemId];
    if (!item?.heal || (state.inv[itemId] ?? 0) <= 0) return;
    const life = Math.min(MAX_LIFE, state.life + item.heal);
    commit({ life, inv: { ...state.inv, [itemId]: state.inv[itemId] - 1 } });
    sfx.heal();
    ui.toast(life >= MAX_LIFE ? 'Full life again!' : `+${item.heal} life. ${item.emoji}`);
  },

  /** A vehicle hit you. Helmet and vest help; the zebra crossing helps most. */
  hit(kind: string) {
    const now = performance.now();
    if (now - lastHit < TUNE.hitGapMs || world.indoors || world.riding) return;
    lastHit = now;
    let dmg = TUNE.accident;
    if (state.owned.helmet) dmg *= 0.5;
    if (state.owned.vest) dmg *= 0.75;
    const crossing = inCrossing();
    if (crossing) dmg *= TUNE.crossingDamage;
    dmg = Math.round(dmg);
    const life = Math.max(0, state.life - dmg);
    commit({ life, hurtAt: now });
    sfx.hurt();
    const tip = crossing ? 'Even on the crossing, look both ways.' : 'Use the zebra crossing, and look both ways.';
    ui.toast(`${WHO[kind] ?? 'A vehicle'} hit you! −${dmg} life. ${tip}`);
    if (life <= 0) faint();
  },

  /** The outdoor temperature (°C), from the live weather. */
  setTemperature(t: number) {
    temperature = t;
  },

  /** Can you pay for this many points? */
  affords: (pts: number) => state.points >= pts,

  /** Do you carry this many of an item? */
  has: (item: string, qty: number) => (state.inv[item] ?? 0) >= qty,

  /** Trading: you hand items over and get points (the other side's side is `tradeIn`). */
  tradeOut(item: string, qty: number, pts: number): boolean {
    if (!game.has(item, qty)) return false;
    commit({ inv: { ...state.inv, [item]: state.inv[item] - qty }, points: state.points + pts });
    sfx.sell();
    return true;
  },

  /** Trading: you get the items and pay the points. */
  tradeIn(item: string, qty: number, pts: number): boolean {
    if (!game.affords(pts)) return false;
    commit({ inv: { ...state.inv, [item]: (state.inv[item] ?? 0) + qty }, points: state.points - pts });
    sfx.buy();
    return true;
  },

  /** A save code: copy it to another browser to carry on there. */
  saveCode(): string {
    const j = JSON.stringify({ v: 1, points: state.points, life: state.life, inv: state.inv, owned: state.owned });
    return btoa(unescape(encodeURIComponent(j)));
  },

  /** Load a save code. Returns false if it isn't one. */
  loadCode(code: string): boolean {
    try {
      const clean = sanitize(JSON.parse(decodeURIComponent(escape(atob(code.trim())))));
      if (!clean) return false;
      commit({ ...clean, hurtAt: performance.now() });
      ui.toast('Progress loaded. Welcome back!');
      return true;
    } catch {
      return false;
    }
  },
};

/** Fainting, the rain and the heat, life coming back when you're safe, the crossing, and regrowing harvest. */
function tick(dt: number) {
  const now = performance.now();

  // harvest grows back one at a time
  let stock: Record<string, number> | null = null;
  for (const s of SOURCES) {
    const current: Record<string, number> = stock ?? state.stock;
    const have = current[s.id] ?? 0;
    if (have >= s.max) {
      delete growAt[s.id];
      continue;
    }
    growAt[s.id] ??= now + s.regrow;
    if (now >= growAt[s.id]) {
      stock = { ...current, [s.id]: have + 1 };
      growAt[s.id] = now + s.regrow;
    }
  }
  if (stock) set({ stock });

  // crossing the road at the zebra crossing: going over from one side to the other is a safe trip
  if (!world.riding) {
    const on = inCrossing();
    const side: 'n' | 's' = world.player.z < 10 ? 'n' : 's';
    if (on && crossFrom === null) crossFrom = side;
    if (!on && crossFrom !== null) {
      if (crossFrom !== side) {
        commit({ points: state.points + TUNE.crossingPoints });
        sfx.crossed();
        ui.toast(`Safe crossing! +${TUNE.crossingPoints} points`);
      }
      crossFrom = null;
    }
  }

  // exposure: outside, in the rain without an umbrella or in the heat without a cap
  const outside = !world.indoors && !world.riding;
  const wet = outside && world.rain > 0.35 && !state.owned.umbrella;
  const hot = outside && temperature >= 33 && !state.owned.sun_cap;
  if (wet && !warned.rain) ui.toast('Getting soaked! An umbrella from the ☂️ shop keeps the rain off.');
  if (hot && !warned.heat) ui.toast('It’s scorching! A sun cap from the ☂️ shop helps.');
  warned.rain = wet;
  warned.heat = hot;

  let life = state.life;
  if (wet || hot) {
    life = Math.max(0, life - (wet ? TUNE.rainDrain : 0) * dt - (hot ? TUNE.heatDrain : 0) * dt);
    if (life <= 0 && state.life > 0) {
      commit({ life: 0, hurtAt: now });
      faint();
      return;
    }
  } else if (now - state.hurtAt > TUNE.calmMs && life < MAX_LIFE) {
    life = Math.min(MAX_LIFE, life + TUNE.regen * dt);
  }
  if (Math.round(life * 10) !== Math.round(state.life * 10)) {
    set({ life });
    // life moves every tick: save it every few seconds, not on every change
    if (now - lastSave > 3000) {
      save(state);
      lastSave = now;
    }
  }
}

let lastSave = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  tick(Math.min((now - last) / 1000, 1));
  last = now;
}, 250);

/** Subscribe to the whole game state (re-renders on any change). */
export function useGame(): GameState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

/** Just one piece of the game state: re-renders only when that piece changes. */
export function useGameValue<T>(pick: (s: GameState) => T): T {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => pick(state)
  );
}

