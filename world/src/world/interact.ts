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

export interface Book {
  id: string;
  title: string;
  subtitle: string;
  /** The book page on the site, opened in the reader */
  url: string;
  colors: [string, string];
  emoji: string;
}

type State = {
  hover: string | null;
  card: Card | null;
  /** The book taken off the shelf (it flies to you), or null */
  book: Book | null;
  /** The reader is open over the world */
  reading: boolean;
  /** Sitting in the reading corner's armchair */
  seated: boolean;
};
let state: State = { hover: null, card: null, book: null, reading: false, seated: false };
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
  takeBook(book: Book) {
    state = { ...state, book, reading: false, hover: null };
    emit();
  },
  openReader() {
    if (!state.book || state.reading) return;
    state = { ...state, reading: true };
    emit();
  },
  putBookBack() {
    state = { ...state, book: null, reading: false };
    emit();
  },
  setSeated(seated: boolean) {
    if (state.seated === seated) return;
    state = { ...state, seated, hover: null };
    emit();
  },
  get: () => state,
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
