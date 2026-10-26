import { useSyncExternalStore } from 'react';

/**
 * Things you can click or tap in the world. A mesh opts in with
 * `userData.interact = { label, onUse }`; the Interactor finds it under your
 * aim (desktop: screen centre) or your finger (phones).
 */
export interface Interactable {
  /** Shown when you look at it: "Look at the shutter" */
  label: string;
  onUse: () => void;
  /** How close you need to be (metres) */
  reach?: number;
}

export interface Card {
  title: string;
  text: string;
  emoji?: string;
}

type State = { hover: string | null; card: Card | null };
let state: State = { hover: null, card: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const ui = {
  setHover(label: string | null) {
    if (state.hover === label) return;
    state = { ...state, hover: label };
    emit();
  },
  showCard(card: Card | null) {
    state = { ...state, card };
    emit();
  },
};

export function useUi(): State {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state
  );
}

/** A tap/click to try, in normalised screen coordinates (−1…1). */
export const taps: { x: number; y: number }[] = [];
export function requestUse(x = 0, y = 0) {
  taps.push({ x, y });
}
