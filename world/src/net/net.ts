import { useSyncExternalStore } from 'react';
import { RealtimeClient, type RealtimeChannel } from '@supabase/realtime-js';
import { CHANNEL, REALTIME_KEY, REALTIME_URL } from './config';
import { world } from '../world/state';
import type { VehicleKind } from '../world/vehicleModels';

/*
 * Everyone shares one town. Each visitor broadcasts where they are a few times a
 * second (only while something changes, plus a heartbeat); everyone else draws them.
 * Chat goes over the same channel. Nothing is stored anywhere.
 */

export const LOOKS = ['rider', 'barista', 'receptionist'] as const;
export const KINDS: VehicleKind[] = ['scooter', 'auto', 'car', 'cycle'];

/** 0 walking, 1 sitting, 2 riding */
export type Mode = 0 | 1 | 2;

export interface VehicleState {
  kind: VehicleKind;
  color: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
  ridden: boolean;
}

export interface Peer {
  id: string;
  name: string;
  look: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  mode: Mode;
  /** metres per second, from the last two updates (for the walk animation) */
  speed: number;
  vehicle: VehicleState | null;
  heard: number;
  bubble: { text: string; at: number } | null;
}

export interface ChatLine {
  id: number;
  from: string;
  name: string;
  text: string;
  mine: boolean;
  at: number;
}

export interface Profile {
  name: string;
  look: number;
}

const PROFILE_KEY = 'es-world-profile';
const DEBUG = new URLSearchParams(location.search).has('debug');
const SEND_EVERY = 150; // ms
const HEARTBEAT = 2500;
const TIMEOUT = 10000;
export const MAX_CHAT = 160;

export const me = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4), name: '', look: 0 };
export const peers = new Map<string, Peer>();

type Status = 'off' | 'connecting' | 'online' | 'offline';
let status = 'off' as Status;
let chat: ChatLine[] = [];
let roster: Peer[] = [];
let chatId = 0;
const listeners = new Set<() => void>();
const emit = () => {
  roster = [...peers.values()];
  listeners.forEach((l) => l());
};

/* ── Profile ─────────────────────────────────────────────────── */

export function loadProfile(): Profile {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? 'null');
    if (saved && typeof saved.name === 'string') return { name: cleanName(saved.name) || randomName(), look: cleanLook(saved.look) };
  } catch {
    /* private window */
  }
  return { name: randomName(), look: Math.floor(Math.random() * LOOKS.length) };
}

function saveProfile(p: Profile) {
  try {
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch {
    /* fine */
  }
}

function randomName() {
  const names = ['Mango', 'Kingfisher', 'Monsoon', 'Coconut', 'Jasmine', 'Pepper', 'Cardamom', 'Lotus', 'Sparky', 'Tamarind'];
  return `${names[Math.floor(Math.random() * names.length)]} ${10 + Math.floor(Math.random() * 90)}`;
}

/* ── Checking what arrives (anyone can send anything) ────────── */

const cleanText = (s: unknown, max: number) =>
  typeof s === 'string'
    ? s
        .replace(/[\u0000-\u001f\u007f​-‏‪-‮]/g, '')
        .trim()
        .slice(0, max)
    : '';
const cleanName = (s: unknown) => cleanText(s, 20);
const cleanLook = (n: unknown) => (typeof n === 'number' && n >= 0 && n < LOOKS.length ? Math.floor(n) : 0);
const num = (n: unknown, lim = 2000) => (typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < lim ? n : null);
const cleanId = (s: unknown) => (typeof s === 'string' && /^[a-z0-9]{6,24}$/.test(s) ? s : null);
const cleanColor = (s: unknown) => (typeof s === 'string' && /^#[0-9a-f]{6}$/i.test(s) ? s : '');

/* ── Sending ─────────────────────────────────────────────────── */

let client: RealtimeClient | null = null;
let channel: RealtimeChannel | null = null;
let last = { x: 0, y: 0, z: 0, yaw: 0, mode: -1, vx: 0, vz: 0, vyaw: 0, vr: false, hasV: false, at: 0 };
let timer = 0;
let lastChat = 0;

const r2 = (n: number) => Math.round(n * 100) / 100;

function snapshot() {
  const p = world.avatar;
  const v = world.vehicle;
  return {
    i: me.id,
    n: me.name,
    l: me.look,
    p: [r2(p.x), r2(p.y), r2(p.z)],
    h: r2(world.heading),
    m: world.riding ? 2 : world.seat ? 1 : 0,
    v: v ? [v.kind, v.color, r2(v.x), r2(v.y), r2(v.z), r2(v.yaw), r2(v.speed), v.ridden ? 1 : 0] : 0,
  };
}

function tick() {
  if (status !== 'online' || !channel) return;
  const now = performance.now();
  const p = world.avatar;
  const v = world.vehicle;
  const mode = world.riding ? 2 : world.seat ? 1 : 0;
  const moved =
    Math.hypot(p.x - last.x, p.z - last.z) > 0.04 ||
    Math.abs(p.y - last.y) > 0.05 ||
    Math.abs(world.heading - last.yaw) > 0.04 ||
    mode !== last.mode ||
    !!v !== last.hasV ||
    (v && (Math.hypot(v.x - last.vx, v.z - last.vz) > 0.04 || Math.abs(v.yaw - last.vyaw) > 0.03 || v.ridden !== last.vr));
  if (!moved && now - last.at < HEARTBEAT) return;
  last = { x: p.x, y: p.y, z: p.z, yaw: world.heading, mode, vx: v?.x ?? 0, vz: v?.z ?? 0, vyaw: v?.yaw ?? 0, vr: !!v?.ridden, hasV: !!v, at: now };
  channel.send({ type: 'broadcast', event: 's', payload: snapshot() });
}

/* ── Receiving ───────────────────────────────────────────────── */

function onState(d: Record<string, unknown>) {
  const id = cleanId(d.i);
  if (!id || id === me.id) return;
  const p = Array.isArray(d.p) ? d.p : [];
  const x = num(p[0]);
  const y = num(p[1], 200);
  const z = num(p[2]);
  const yaw = num(d.h, 100);
  if (x === null || y === null || z === null || yaw === null) return;
  let vehicle: VehicleState | null = null;
  if (Array.isArray(d.v)) {
    const [k, c, vx, vy, vz, vyaw, sp, r] = d.v;
    if (KINDS.includes(k) && num(vx) !== null && num(vy, 200) !== null && num(vz) !== null && num(vyaw, 100) !== null) {
      vehicle = { kind: k, color: cleanColor(c), x: vx, y: vy, z: vz, yaw: vyaw, speed: num(sp, 100) ?? 0, ridden: r === 1 };
    }
  }
  const now = performance.now();
  const mode = (d.m === 1 || d.m === 2 ? d.m : 0) as Mode;
  const known = peers.get(id);
  const name = cleanName(d.n) || 'Guest';
  const look = cleanLook(d.l);
  if (known) {
    const dt = Math.max((now - known.heard) / 1000, 0.05);
    known.speed = Math.min(Math.hypot(x - known.x, z - known.z) / dt, 12);
    const changed = known.name !== name || known.look !== look;
    Object.assign(known, { name, look, x, y, z, yaw, mode, vehicle, heard: now });
    if (changed) emit();
  } else {
    peers.set(id, { id, name, look, x, y, z, yaw, mode, speed: 0, vehicle, heard: now, bubble: null });
    addChat({ from: '', name: '', text: `${name} arrived in town 👋`, mine: false });
    emit();
  }
}

function addChat(line: Omit<ChatLine, 'id' | 'at'>) {
  chat = [...chat.slice(-39), { ...line, id: ++chatId, at: Date.now() }];
  listeners.forEach((l) => l());
}

function onChat(d: Record<string, unknown>) {
  const id = cleanId(d.i);
  const text = cleanText(d.t, MAX_CHAT);
  if (!id || id === me.id || !text) return;
  const peer = peers.get(id);
  const name = peer?.name ?? (cleanName(d.n) || 'Guest');
  if (peer) peer.bubble = { text, at: performance.now() };
  addChat({ from: id, name, text, mine: false });
}

function drop(id: string, quietly = false) {
  const p = peers.get(id);
  if (!p) return;
  peers.delete(id);
  if (!quietly) addChat({ from: '', name: '', text: `${p.name} left`, mine: false });
  emit();
}

/* ── Public API ──────────────────────────────────────────────── */

export const net = {
  /** Join the town under this name. */
  start(profile: Profile) {
    me.name = cleanName(profile.name) || randomName();
    me.look = cleanLook(profile.look);
    saveProfile({ name: me.name, look: me.look });
    if (client) return;
    status = 'connecting';
    emit();
    client = new RealtimeClient(REALTIME_URL, { params: { apikey: REALTIME_KEY, eventsPerSecond: 20 } });
    channel = client.channel(CHANNEL, { config: { broadcast: { self: false, ack: false } } });
    channel
      .on('broadcast', { event: 's' }, ({ payload }) => onState(payload ?? {}))
      .on('broadcast', { event: 'c' }, ({ payload }) => onChat(payload ?? {}))
      .on('broadcast', { event: 'hi' }, () => {
        // someone new: tell them about us soon (spread out so we don't all answer at once)
        setTimeout(() => (last.at = 0), Math.random() * 600);
      })
      .on('broadcast', { event: 'bye' }, ({ payload }) => {
        const id = cleanId(payload?.i);
        if (id) drop(id);
      })
      .subscribe((s, err) => {
        if (DEBUG) console.warn('[town]', s, err?.message ?? '');
        if (s === 'SUBSCRIBED') {
          const first = status !== 'online' && chat.length === 0;
          status = 'online';
          last.at = 0;
          channel?.send({ type: 'broadcast', event: 'hi', payload: { i: me.id } });
          if (first) addChat({ from: '', name: '', text: `Welcome to town, ${me.name}! Say hi 👋`, mine: false });
        } else if (s === 'TIMED_OUT') {
          // a slow start (the town is still warming up): the client keeps trying
          status = 'connecting';
        } else if (s === 'CHANNEL_ERROR' || s === 'CLOSED') {
          status = 'offline';
        }
        emit();
      });
    timer = window.setInterval(() => {
      tick();
      // forget people we haven't heard from in a while
      const now = performance.now();
      for (const p of peers.values()) if (now - p.heard > TIMEOUT) drop(p.id, true);
    }, SEND_EVERY);
    const bye = () => channel?.send({ type: 'broadcast', event: 'bye', payload: { i: me.id } });
    window.addEventListener('pagehide', bye);
  },

  say(text: string) {
    const t = cleanText(text, MAX_CHAT);
    if (!t) return false;
    const now = performance.now();
    if (now - lastChat < 900) return false;
    lastChat = now;
    channel?.send({ type: 'broadcast', event: 'c', payload: { i: me.id, n: me.name, t } });
    world.bubble = { text: t, at: now };
    addChat({ from: me.id, name: me.name, text: t, mine: true });
    return true;
  },

  stop() {
    window.clearInterval(timer);
  },
};

export function useNet() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => snapshotState()
  );
}

let cached: { status: Status; chat: ChatLine[]; roster: Peer[] } = { status, chat, roster };
function snapshotState() {
  if (cached.status !== status || cached.chat !== chat || cached.roster !== roster) cached = { status, chat, roster };
  return cached;
}
