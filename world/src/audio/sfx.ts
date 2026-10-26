/**
 * Vehicle sounds, made in the browser: horns and the engine of whatever you ride.
 */
let ctx: AudioContext | null = null;

function ensure() {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export type HornKind = 'car' | 'auto' | 'scooter' | 'cycle';

/** A horn (or a bicycle bell), `volume` 0…1 (lower for faraway traffic). */
export function horn(kind: HornKind, volume = 1) {
  if (volume < 0.02) return;
  const c = ensure();
  const t = c.currentTime + 0.01;
  const out = c.createGain();
  out.gain.value = 0.18 * volume;
  out.connect(c.destination);

  if (kind === 'cycle') {
    // ring-ring
    for (const at of [0, 0.16]) {
      for (const f of [2350, 3530]) {
        const o = c.createOscillator();
        o.type = 'sine';
        o.frequency.value = f;
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t + at);
        g.gain.exponentialRampToValueAtTime(0.5, t + at + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
        o.connect(g).connect(out);
        o.start(t + at);
        o.stop(t + at + 0.5);
      }
    }
    return;
  }
  const notes = kind === 'car' ? [415, 523] : kind === 'auto' ? [330, 392] : [620, 740];
  const beeps = kind === 'auto' ? [[0, 0.16], [0.24, 0.3]] : [[0, kind === 'car' ? 0.45 : 0.22]];
  for (const [at, len] of beeps) {
    for (const f of notes) {
      const o = c.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const g = c.createGain();
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.35, t + at + 0.02);
      g.gain.setValueAtTime(0.35, t + at + len - 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + len);
      o.connect(lp).connect(g).connect(out);
      o.start(t + at);
      o.stop(t + at + len + 0.02);
    }
  }
}

/** The engine of the vehicle you're riding; its pitch follows your speed. */
export const engine = (() => {
  let osc: OscillatorNode | null = null;
  let osc2: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let kind: HornKind | null = null;
  return {
    start(k: HornKind) {
      this.stop();
      if (k === 'cycle') return;
      const c = ensure();
      kind = k;
      osc = c.createOscillator();
      osc.type = 'sawtooth';
      osc2 = c.createOscillator();
      osc2.type = 'square';
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = k === 'car' ? 420 : 700;
      gain = c.createGain();
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(k === 'car' ? 0.05 : 0.07, c.currentTime + 0.4);
      osc.connect(lp);
      osc2.connect(lp);
      lp.connect(gain).connect(c.destination);
      osc.start();
      osc2.start();
      this.speed(0);
    },
    /** m/s */
    speed(v: number) {
      if (!osc || !osc2 || !ctx) return;
      const base = kind === 'car' ? 38 : kind === 'auto' ? 30 : 55;
      const f = base + Math.abs(v) * (kind === 'car' ? 6 : 9);
      osc.frequency.setTargetAtTime(f, ctx.currentTime, 0.1);
      osc2.frequency.setTargetAtTime(f * 0.5, ctx.currentTime, 0.1);
    },
    stop() {
      if (gain && ctx) gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3);
      const a = osc;
      const b = osc2;
      setTimeout(() => {
        a?.stop();
        b?.stop();
      }, 400);
      osc = osc2 = null;
      gain = null;
      kind = null;
    },
  };
})();
