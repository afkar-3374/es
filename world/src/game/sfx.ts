/*
 * Little game sounds, made in the browser (no files to load). A pick is a blip,
 * a sale a coin chime, a hurt a low thud. On by default; the menu switches them off.
 */
const KEY = 'es-town-sound';
let ctx: AudioContext | null = null;

let enabled = (() => {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
})();

function audio(): AudioContext | null {
  if (!enabled) return null;
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

/** One note: a short oscillator with a fast fade, optionally sliding to another pitch. */
function note(freq: number, at: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + at;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.03);
}

export const sfx = {
  get enabled() {
    return enabled;
  },
  setEnabled(on: boolean) {
    enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* not saved: fine */
    }
    if (on) sfx.pick();
  },
  /** picking a coconut, a flower or a fruit */
  pick() {
    note(880, 0, 0.12, 'triangle', 0.16, 1320);
  },
  /** a coin chime when you sell */
  sell() {
    note(1046, 0, 0.12, 'sine', 0.15);
    note(1568, 0.09, 0.2, 'sine', 0.15);
  },
  buy() {
    note(659, 0, 0.1, 'triangle', 0.14);
    note(880, 0.08, 0.1, 'triangle', 0.14);
    note(1175, 0.16, 0.18, 'triangle', 0.14);
  },
  craft() {
    note(523, 0, 0.1, 'square', 0.08);
    note(659, 0.1, 0.1, 'square', 0.08);
    note(784, 0.2, 0.2, 'square', 0.08);
  },
  heal() {
    note(440, 0, 0.18, 'sine', 0.14, 880);
  },
  /** an accident: a thud and a falling tone */
  hurt() {
    note(140, 0, 0.3, 'sawtooth', 0.26, 50);
    note(90, 0.02, 0.22, 'square', 0.12, 40);
  },
  faint() {
    note(520, 0, 0.3, 'triangle', 0.18, 260);
    note(390, 0.3, 0.4, 'triangle', 0.14, 130);
  },
  /** a trade offer arrives */
  offer() {
    note(988, 0, 0.12, 'sine', 0.14);
    note(1318, 0.12, 0.2, 'sine', 0.14);
  },
  /** a safe crossing */
  crossed() {
    note(784, 0, 0.12, 'sine', 0.12);
    note(988, 0.1, 0.18, 'sine', 0.12);
  },
};
