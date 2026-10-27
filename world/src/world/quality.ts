import { useSyncExternalStore } from 'react';
import { isTouch } from '../player/input';

/*
 * Graphics quality. "auto" starts in the middle and steps down when frames come too slowly
 * (or up when there's room); "fast" and "pretty" pin it.
 *   0 fast: lower resolution, small shadow area, few clouds
 *   1 balanced
 *   2 pretty: full resolution on sharp screens, bigger and finer shadows
 */
export type Mode = 'auto' | 'fast' | 'pretty';
export type Level = 0 | 1 | 2;

const KEY = 'es-world-graphics';
let mode: Mode = (() => {
  try {
    const m = localStorage.getItem(KEY);
    if (m === 'auto' || m === 'fast' || m === 'pretty') return m;
  } catch {
    /* fine */
  }
  const q = new URLSearchParams(location.search).get('quality');
  return q === 'fast' || q === 'pretty' ? q : 'auto';
})();
/** Phones and laptops' built-in graphics start on fast; a dedicated graphics card starts balanced. */
function startLevel(): Level {
  if (isTouch) return 0;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl!.getParameter(info.UNMASKED_RENDERER_WEBGL) : '');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|apple m\d (pro|max|ultra)/i.test(name)) return 1;
  } catch {
    /* unknown: be careful */
  }
  return 0;
}
const START = startLevel();
let autoLevel: Level = START;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const quality = {
  get mode() {
    return mode;
  },
  get level(): Level {
    return mode === 'fast' ? 0 : mode === 'pretty' ? 2 : autoLevel;
  },
  setMode(m: Mode) {
    mode = m;
    try {
      localStorage.setItem(KEY, m);
    } catch {
      /* fine */
    }
    emit();
  },
  step(by: 1 | -1) {
    // built-in graphics can climb one step at most (it drops back as soon as frames slow)
    const next = Math.max(0, Math.min(START === 0 ? 1 : 2, autoLevel + by)) as Level;
    if (next === autoLevel) return;
    autoLevel = next;
    if (mode === 'auto') emit();
  },
};

/** Settings for each level */
export const LEVELS = [
  { dpr: 0.7, shadowMap: 1024, shadowBox: 28, clouds: 0.35 },
  { dpr: 1, shadowMap: 1024, shadowBox: 38, clouds: 0.7 },
  { dpr: 1.75, shadowMap: 2048, shadowBox: 45, clouds: 1 },
] as const;

export function useQuality() {
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => `${mode}${autoLevel}`
  );
  return { mode, level: quality.level, settings: LEVELS[quality.level] };
}
