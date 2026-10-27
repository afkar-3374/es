import { useSyncExternalStore } from 'react';
import { hooks, me, net, peers } from './net';

/*
 * Voice: the whole town is one group call. Your microphone is on from the moment you
 * enter (until you mute it) and you hear everyone, wherever they are in town.
 *
 * Audio goes straight between browsers (WebRTC), not through the town server; the
 * town channel only carries the few messages that set each call up. Of every pair of
 * people, the one with the smaller id makes the offer, so two calls never cross.
 * Offers and answers are sent once ICE gathering finishes (no trickle), which keeps
 * the channel quiet.
 */

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
/** Direct connections get heavy past this many; the closest people beyond it wait their turn. */
const MAX_CALLS = 16;
const RETRY = 4000;

export type MicState = 'off' | 'asking' | 'on' | 'muted' | 'blocked';

interface Call {
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  level: number;
  retries: number;
}

const calls = new Map<string, Call>();
let mic: MediaStream | null = null;
let micState = 'off' as MicState;
let started = false;
let ctx: AudioContext | null = null;
let mine: AnalyserNode | null = null;
let myLevel = 0;
const buf = new Uint8Array(256);

const listeners = new Set<() => void>();
const emit = () => {
  snap = { mic: micState, talking: [...calls.values()].filter((c) => c.pc.connectionState === 'connected').length };
  listeners.forEach((l) => l());
};
let snap: { mic: MicState; talking: number } = { mic: micState, talking: 0 };

const DEBUG = new URLSearchParams(location.search).has('debug');
const log = (...a: unknown[]) => DEBUG && console.warn('[voice]', ...a);

function audioCtx() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function meter(stream: MediaStream) {
  try {
    const a = audioCtx().createAnalyser();
    a.fftSize = 256;
    audioCtx().createMediaStreamSource(stream).connect(a);
    return a;
  } catch {
    return null;
  }
}

function loudness(a: AnalyserNode | null) {
  if (!a) return 0;
  a.getByteTimeDomainData(buf);
  let sum = 0;
  for (let i = 0; i < a.fftSize; i++) sum += (buf[i] - 128) ** 2;
  return Math.sqrt(sum / a.fftSize) / 128;
}

/** Wait (briefly) until the connection knows its addresses, so one message carries them all. */
function gathered(pc: RTCPeerConnection) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise<void>((done) => {
    const t = setTimeout(done, 2500);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        done();
      }
    });
  });
}

function hangUp(id: string) {
  const c = calls.get(id);
  if (!c) return;
  calls.delete(id);
  c.pc.close();
  c.audio.srcObject = null;
  c.audio.remove();
  emit();
}

/** Put the microphone (if we have it) on a call's one audio line, sending and receiving. */
function attachMic(pc: RTCPeerConnection) {
  const tx = pc.getTransceivers()[0];
  if (!tx) return;
  tx.direction = 'sendrecv';
  const track = mic?.getAudioTracks()[0];
  if (track) tx.sender.replaceTrack(track).catch(() => {});
}

function newCall(id: string, offering: boolean): Call {
  hangUp(id);
  const pc = new RTCPeerConnection({ iceServers: ICE });
  const audio = document.createElement('audio');
  audio.autoplay = true;
  audio.setAttribute('playsinline', '');
  document.body.appendChild(audio);
  const call: Call = { pc, audio, analyser: null, level: 0, retries: calls.get(id)?.retries ?? 0 };
  // always send and receive; the microphone joins in whenever it's allowed
  // (the answering side gets its audio line from the offer instead)
  if (offering) {
    pc.addTransceiver('audio', { direction: 'sendrecv' });
    attachMic(pc);
  }
  pc.ontrack = (e) => {
    const stream = e.streams[0] ?? new MediaStream([e.track]);
    audio.srcObject = stream;
    audio.play().catch(() => {});
    call.analyser = meter(stream);
  };
  pc.onconnectionstatechange = () => {
    log(id, pc.connectionState);
    emit();
    if (pc.connectionState === 'failed' && calls.get(id) === call) {
      // try again from scratch a little later (the offerer redials)
      hangUp(id);
      call.retries++;
      if (call.retries < 4 && me.id < id) setTimeout(() => dial(id, call.retries), RETRY);
    }
  };
  calls.set(id, call);
  emit();
  return call;
}

async function dial(id: string, retries = 0) {
  if (!started || !peers.has(id) || calls.size >= MAX_CALLS) return;
  const call = newCall(id, true);
  call.retries = retries;
  try {
    await call.pc.setLocalDescription(await call.pc.createOffer());
    await gathered(call.pc);
    if (calls.get(id) !== call) return;
    net.direct(id, { v: 'offer', sdp: call.pc.localDescription?.sdp });
  } catch (e) {
    log('offer failed', e);
  }
}

async function onDirect(from: string, d: Record<string, unknown>) {
  if (!started || typeof d.sdp !== 'string' || d.sdp.length > 20000) return;
  try {
    if (d.v === 'offer') {
      if (calls.size >= MAX_CALLS && !calls.has(from)) return;
      const call = newCall(from, false);
      await call.pc.setRemoteDescription({ type: 'offer', sdp: d.sdp });
      attachMic(call.pc);
      await call.pc.setLocalDescription(await call.pc.createAnswer());
      await gathered(call.pc);
      if (calls.get(from) !== call) return;
      net.direct(from, { v: 'answer', sdp: call.pc.localDescription?.sdp });
    } else if (d.v === 'answer') {
      const call = calls.get(from);
      if (call && call.pc.signalingState === 'have-local-offer') await call.pc.setRemoteDescription({ type: 'answer', sdp: d.sdp });
    } else if (d.v === 'call') {
      // they'd like us to ring them (we have the smaller id)
      if (me.id < from && !calls.has(from)) dial(from);
    }
  } catch (e) {
    log('setup failed', e);
  }
}

function arrived(id: string) {
  if (!started) return;
  if (me.id < id) dial(id);
  // the other side dials us; if they never do (they joined before voice started), ask
  else setTimeout(() => !calls.has(id) && peers.has(id) && net.direct(id, { v: 'call', sdp: '' }), 3000);
}

async function openMic() {
  if (!navigator.mediaDevices?.getUserMedia) {
    micState = 'blocked';
    return emit();
  }
  micState = 'asking';
  emit();
  try {
    mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    const track = mic.getAudioTracks()[0];
    micState = 'on';
    mine = meter(mic);
    // put the microphone into every call already running
    for (const c of calls.values()) c.pc.getTransceivers()[0]?.sender.replaceTrack(track).catch(() => {});
  } catch (e) {
    log('microphone refused', e);
    micState = 'blocked';
  }
  emit();
}

export const voice = {
  /** Join the town call (from the Enter click, so the browser lets audio play). */
  start() {
    if (started) return;
    started = true;
    audioCtx();
    hooks.arrived = arrived;
    hooks.left = hangUp;
    hooks.direct = (from, d) => void onDirect(from, d);
    openMic();
    // anyone already here
    for (const id of peers.keys()) arrived(id);
  },

  toggleMute() {
    if (micState === 'blocked' || micState === 'off') return openMic();
    if (!mic) return;
    const on = micState !== 'on';
    mic.getAudioTracks().forEach((t) => (t.enabled = on));
    micState = on ? 'on' : 'muted';
    emit();
  },

  /** 0…1, how loud someone is right now (for the speaking ring on their name). */
  level(id: string) {
    const c = calls.get(id);
    if (!c) return 0;
    c.level = Math.max(loudness(c.analyser), c.level * 0.85);
    return c.level;
  },

  myLevel() {
    if (micState !== 'on') return 0;
    myLevel = Math.max(loudness(mine), myLevel * 0.85);
    return myLevel;
  },

  connected(id: string) {
    return calls.get(id)?.pc.connectionState === 'connected';
  },
};

if (DEBUG) Object.assign(window, { esVoice: voice, esCalls: calls });

export function useVoice() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snap
  );
}
