import { townDay } from './festival';

/*
 * Bots: townsfolk who walk the north footpath back and forth. Their position comes from
 * the wall clock, so everyone in town sees each bot in the same place. Nothing is sent
 * or stored: a bot is part of the town, not a player.
 */

export interface Bot {
  id: string;
  name: string;
  /** shirt colour */
  shirt: string;
  /** the footpath lane (z) and the stretch they walk along (x) */
  z: number;
  x0: number;
  x1: number;
  /** metres per second */
  speed: number;
  /** where in the walk they start (0–2) */
  phase: number;
  /** what they say when you say hi */
  greet: string;
}

export const BOTS: Bot[] = [
  { id: 'ravi', name: 'Ravi', shirt: '#2563eb', z: 4.4, x0: -58, x1: 58, speed: 1.1, phase: 0.1, greet: 'Ente Kasaragod! Welcome, machane.' },
  { id: 'anu', name: 'Anu', shirt: '#db2777', z: 4.4, x0: -58, x1: 58, speed: 0.9, phase: 1.3, greet: 'Have you tried the mango juice? Best in town!' },
  { id: 'joseph', name: 'Joseph', shirt: '#16a34a', z: 4.4, x0: -58, x1: 58, speed: 1.3, phase: 0.7, greet: 'The sea breeze today is lovely, no?' },
  { id: 'fathima', name: 'Fathima', shirt: '#f59e0b', z: 4.4, x0: -58, x1: 58, speed: 1.0, phase: 1.8, greet: 'Sell your jasmine at the Mart, the special pays double.' },
];

export interface BotPose {
  x: number;
  z: number;
  /** facing: +1 walking towards +x, −1 towards −x */
  dir: 1 | -1;
  /** 0…1, how far through a step (for the leg swing) */
  step: number;
}

/** Only for previews and tests (?debug): pin the clock so a bot holds still. */
export const botClock: { frozen: number | null } = { frozen: null };

/** Where a bot is at wall-clock time `ms`. */
export function botPose(b: Bot, ms = botClock.frozen ?? Date.now()): BotPose {
  const len = b.x1 - b.x0;
  const s = ((ms / 1000) * b.speed) / len + b.phase; // one walk there and back = 2
  const k = ((s % 2) + 2) % 2;
  const tri = k < 1 ? k : 2 - k;
  return { x: b.x0 + tri * len, z: b.z, dir: k < 1 ? 1 : -1, step: ((ms / 1000) * 2.2 + b.phase) % 1 };
}

const TIPS = 'es-town-tips';
function tipped(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(TIPS) ?? '{}') ?? {};
  } catch {
    return {};
  }
}

/** Has this bot already tipped you today (Kasaragod's day)? */
export function tippedToday(id: string): boolean {
  return tipped()[id] === townDay();
}

/** Mark a bot as having tipped you today. */
export function markTipped(id: string) {
  try {
    localStorage.setItem(TIPS, JSON.stringify({ ...tipped(), [id]: townDay() }));
  } catch {
    /* not saved: they may tip again on reload */
  }
}
