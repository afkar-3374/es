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
  /** Buttons on the card (e.g. a café menu); the card closes after one is chosen */
  actions?: { label: string; run: () => void }[];
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

export type DrinkKind = 'chai' | 'coffee' | 'cold';
export interface Drink {
  kind: DrinkKind;
  name: string;
  emoji: string;
  sipsLeft: number;
  /** where it came from ('corner' = the cup on the reading-corner table) */
  from: 'corner' | 'cafe';
}

export interface Vehicle {
  id: string;
  name: string;
  emoji: string;
}

type State = {
  hover: string | null;
  card: Card | null;
  /** The book taken off the shelf (it flies to you), or null */
  book: Book | null;
  /** The reader is open over the world */
  reading: boolean;
  /** Sitting down somewhere */
  seated: boolean;
  /** The book you're carrying around (taken off the shelf to read elsewhere) */
  carrying: Book | null;
  /** The drink in your hand */
  drink: Drink | null;
  /** Counts sips, so the hand animation plays once per sip */
  sips: number;
  /** A short message at the bottom of the screen */
  toast: string | null;
  /** The vehicle you're riding */
  riding: Vehicle | null;
};
let state: State = { hover: null, card: null, book: null, reading: false, seated: false, carrying: null, drink: null, sips: 0, toast: null, riding: null };
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
let toastTimer = 0;

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  emit();
};

export const ui = {
  setHover(label: string | null) {
    if (state.hover !== label) set({ hover: label });
  },
  showCard(card: Card | null) {
    set({ card });
  },
  takeBook(book: Book) {
    set({ book, reading: false, hover: null });
  },
  openReader() {
    if (state.book && !state.reading) set({ reading: true });
  },
  /** Close the reader and put the book back on its shelf. */
  putBookBack() {
    set({ book: null, reading: false, carrying: null });
  },
  /** Close the reader but keep the book in your hand. */
  carryBook() {
    if (!state.book) return;
    const book = state.book;
    set({ carrying: book, book: null, reading: false });
    ui.toast(`You’re carrying “${book.title}”. Find a seat and read it there.`);
  },
  /** Open the book you're carrying. */
  readCarried() {
    if (state.carrying) set({ book: state.carrying, reading: true, hover: null });
  },
  /** Close the book you're carrying (it stays in your hand). */
  closeCarried() {
    set({ book: null, reading: false });
  },
  returnBook() {
    set({ carrying: null });
    ui.toast('The book is back on its shelf.');
  },
  takeDrink(drink: Drink) {
    set({ drink });
  },
  sip() {
    const d = state.drink;
    if (!d || d.sipsLeft <= 0) return;
    const left = d.sipsLeft - 1;
    set({ sips: state.sips + 1, drink: { ...d, sipsLeft: left } });
    if (left <= 0) {
      // the last sip: put the empty cup away a moment later
      setTimeout(() => {
        set({ drink: null });
        ui.toast(`That was lovely! ${d.emoji}`);
      }, 1400);
    }
  },
  ride(vehicle: Vehicle | null) {
    set({ riding: vehicle, hover: null });
  },
  toast(text: string | null) {
    set({ toast: text });
    if (text) {
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => ui.toast(null), 4200);
    }
  },
  setSeated(seated: boolean) {
    if (state.seated !== seated) set({ seated, hover: null });
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
