/**
 * Soft lo-fi for the reading corner, made in the browser (no recordings):
 * warm electric-piano chords, a lazy bass, light brushed hats and vinyl crackle.
 * Plus the sound of rain when it's raining in Kasaragod.
 */
let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer = 0;
let playing = false;
let rainNode: { gain: GainNode } | null = null;

const BPM = 72;
const BEAT = 60 / BPM;
// Fmaj7 – Em7 – Dm7 – Cmaj7 (as MIDI note numbers)
const CHORDS = [
  [53, 57, 60, 64],
  [52, 55, 59, 62],
  [50, 53, 57, 60],
  [48, 52, 55, 59],
];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

function ensure() {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0;
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowpass';
    warmth.frequency.value = 2400;
    master.connect(warmth).connect(ctx.destination);
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function noiseBuffer(c: AudioContext, seconds: number) {
  const b = c.createBuffer(1, c.sampleRate * seconds, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

function keys(c: AudioContext, at: number, notes: number[], length: number) {
  for (const [i, n] of notes.entries()) {
    const t = at + i * 0.025; // a gently rolled chord
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + length);
    g.connect(master!);
    for (const [type, mult, vol] of [['sine', 1, 1], ['triangle', 2, 0.18]] as const) {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = midi(n) * mult;
      o.detune.value = (Math.random() - 0.5) * 8;
      const v = c.createGain();
      v.gain.value = vol;
      o.connect(v).connect(g);
      o.start(t);
      o.stop(t + length + 0.05);
    }
  }
}

function bass(c: AudioContext, at: number, note: number) {
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.value = midi(note - 12);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.12, at + 0.03);
  g.gain.exponentialRampToValueAtTime(0.0001, at + BEAT * 1.8);
  o.connect(g).connect(master!);
  o.start(at);
  o.stop(at + BEAT * 2);
}

let noise: AudioBuffer | null = null;
function hat(c: AudioContext, at: number, vol: number) {
  noise ??= noiseBuffer(c, 1);
  const s = c.createBufferSource();
  s.buffer = noise;
  const hp = c.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 7000;
  const g = c.createGain();
  g.gain.setValueAtTime(vol, at);
  g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
  s.connect(hp).connect(g).connect(master!);
  s.start(at, Math.random() * 0.5, 0.08);
}

function crackle(c: AudioContext) {
  const s = c.createBufferSource();
  const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() < 0.0009 ? (Math.random() * 2 - 1) * 0.6 : (Math.random() * 2 - 1) * 0.004;
  s.buffer = b;
  s.loop = true;
  const g = c.createGain();
  g.gain.value = 0.5;
  s.connect(g).connect(master!);
  s.start();
  return s;
}

let bar = 0;
let nextAt = 0;
let crackleSrc: AudioBufferSourceNode | null = null;

function schedule() {
  const c = ctx!;
  while (nextAt < c.currentTime + 1.5) {
    const chord = CHORDS[bar % CHORDS.length];
    keys(c, nextAt, chord, BEAT * 3.6);
    bass(c, nextAt, chord[0]);
    bass(c, nextAt + BEAT * 2.5, chord[0] + 7);
    for (let i = 0; i < 8; i++) hat(c, nextAt + i * (BEAT / 2) + (i % 2 ? BEAT * 0.08 : 0), i % 2 ? 0.02 : 0.035);
    nextAt += BEAT * 4;
    bar++;
  }
}

export const music = {
  get playing() {
    return playing;
  },
  start() {
    const c = ensure();
    if (playing) return;
    playing = true;
    nextAt = c.currentTime + 0.1;
    crackleSrc = crackle(c);
    master!.gain.cancelScheduledValues(c.currentTime);
    master!.gain.linearRampToValueAtTime(0.9, c.currentTime + 1.5);
    schedule();
    timer = window.setInterval(schedule, 500);
  },
  stop() {
    if (!ctx || !playing) return;
    playing = false;
    clearInterval(timer);
    master!.gain.cancelScheduledValues(ctx.currentTime);
    master!.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.8);
    const src = crackleSrc;
    setTimeout(() => src?.stop(), 900);
  },
  /** Rain on the roof and windows, 0 = none … 1 = heavy. */
  setRain(strength: number) {
    if (strength <= 0 && !rainNode) return;
    const c = ensure();
    if (!rainNode) {
      const s = c.createBufferSource();
      s.buffer = noiseBuffer(c, 3);
      s.loop = true;
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1800;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 300;
      const gain = c.createGain();
      gain.gain.value = 0;
      s.connect(hp).connect(lp).connect(gain).connect(c.destination);
      s.start();
      rainNode = { gain };
    }
    rainNode.gain.gain.linearRampToValueAtTime(strength * 0.12, c.currentTime + 2);
  },
};
