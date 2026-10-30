import { useEffect, useState } from 'react';
import type { Conditions } from '../env/kasaragod';
import { music } from '../audio/music';
import { useNet } from '../net/net';
import { ui, useUi } from '../world/interact';
import { ride } from '../world/ride';
import { SPECS } from '../world/vehicleModels';
import { KINDS } from '../net/net';
import { isTouch, typing } from '../player/input';
import { goFullscreen } from './Landscape';
import { quality, useQuality } from '../world/quality';
import { useVoice, voice } from '../net/voice';
import { bookCab } from './Cab';
import { cab, nearestRoad, useCab } from '../world/cab';
import { getMeta, groundAt } from '../world/map';
import { world } from '../world/state';
import * as THREE from 'three';

/** The name of the place you're in (the nearest town, village or suburb), as you go. */
function usePlace() {
  const [name, setName] = useState('Kasaragod');
  useEffect(() => {
    const tick = () => {
      const m = getMeta();
      if (!m) return;
      const p = world.player;
      let best = 'Kasaragod';
      let bd = Infinity;
      for (const q of m.places) {
        // towns reach further than hamlets
        const reach = q.k === 'town' ? 1 : q.k === 'suburb' || q.k === 'village' ? 1.6 : 2.4;
        const d = Math.hypot(q.x - p.x, q.z - p.z) * reach;
        if (d < bd) {
          bd = d;
          best = q.n;
        }
      }
      // near the building: Mogral
      if (Math.hypot(p.x, p.z) < 400) best = 'Mogral';
      setName(bd < 4000 || best === 'Mogral' ? best : 'Kasaragod');
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => clearInterval(t);
  }, []);
  return name;
}

/** Go straight to a place (by the nearest road there). */
export function jumpTo(n: string) {
  const d = cab.destinations().find((x) => x.n === n);
  if (!d || ui.get().riding) return ui.toast(ui.get().riding ? 'Get off first, then jump.' : 'Unknown place');
  if (d.home) {
    world.dismountAt = new THREE.Vector3((Math.random() - 0.5) * 6, 0.2, 16.5);
    return ui.toast('⚡ Back at Electrosparkzz, Mogral');
  }
  nearestRoad(d.x, d.z).then((r) => {
    if (!r) return;
    const x = r.x + r.dz * 4;
    const z = r.z - r.dx * 4;
    world.dismountAt = new THREE.Vector3(x, groundAt(x, z) + 0.5, z);
    ui.toast(`${d.e} ${d.n}`);
  });
}

/** Pick a vehicle; it turns up right in front of you. */
export function chooseVehicle() {
  if (ui.get().riding) return ui.toast('Get off first, then call another vehicle.');
  if (document.pointerLockElement) document.exitPointerLock();
  ui.showCard({
    emoji: '🔑',
    title: 'Your vehicle',
    text: 'Pick one and it’ll be parked right in front of you. Everyone in town can see it (only you can ride it).',
    actions: KINDS.map((k) => ({ label: `${SPECS[k].emoji} ${SPECS[k].name}`, run: () => ride.call(k) })),
  });
}

/** Kasaragod's live time and weather, who's in town, your vehicle, and the classic site. */
export function Hud({ c }: { c: Conditions }) {
  const w = c.weather;
  const [on, setOn] = useState(music.playing);
  const { roster, status } = useNet();
  const { riding, card, book } = useUi();
  const gfx = useQuality();
  const v = useVoice();
  const inCab = useCab().status !== 'idle';
  const [menu, setMenu] = useState(false);
  // the menu closes when you go back to the town
  useEffect(() => {
    if (!menu) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.('.hud-menu, .menu-btn')) setMenu(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [menu]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || ui.get().card || ui.get().book) return;
      if (e.code === 'KeyV' && !ui.get().riding) chooseVehicle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const here = roster.length + 1;
  const place = usePlace();
  return (
    <div className="hud">
      <div className="hud-left">
        <div className="pill" title={w.live ? 'Live weather in Kasaragod (Open-Meteo)' : 'Live weather unavailable: typical weather for the season'}>
          <span>📍 {place}</span>
          <b>{c.clock}</b>
          <span>
            {w.emoji} {w.temperature}° · {w.label}
          </span>
        </div>
        <div className={`pill people ${status}`} title={status === 'online' ? 'People in town right now' : 'Trying to reach the town…'}>
          {status === 'online' ? `👥 ${here} ${here === 1 ? 'person' : 'people'} in town` : status === 'offline' ? '⚠️ Offline: you’re on your own for now' : '⏳ Joining town…'}
        </div>
      </div>
      <div className="hud-right">
        <button
          type="button"
          className={`pill link mic ${v.mic}`}
          aria-pressed={v.mic === 'on'}
          title={
            v.mic === 'blocked'
              ? 'Your browser blocked the microphone: allow it in the address bar, then tap here'
              : `Everyone in town hears you while your mic is on${v.talking ? ` · in voice with ${v.talking}` : ''}`
          }
          onClick={() => voice.toggleMute()}
        >
          {v.mic === 'on' ? '🎙️ Mute' : v.mic === 'muted' ? '🔇 Unmute' : v.mic === 'asking' ? '🎙️ …' : '🎙️ Turn on mic'}
        </button>
        {!riding && !card && !book && !inCab && (
          <>
            <button type="button" className="pill link cab-pill" onClick={bookCab} title="Book a cab to anywhere in Kasaragod (C)">
              🚕 Cab
            </button>
            <button type="button" className="pill link" onClick={chooseVehicle} title="Call your own vehicle (V)">
              🏍️ My vehicle
            </button>
          </>
        )}
        <button type="button" className={`pill link menu-btn${menu ? ' on' : ''}`} aria-expanded={menu} aria-label="Menu" title="Menu" onClick={() => setMenu(!menu)}>
          ☰
        </button>
        {menu && (
          <div className="hud-menu" role="menu">
            <p className="hud-menu-title">Settings</p>
            <div className="hud-menu-row">
              <span>⚙️ Graphics</span>
              <div className="seg" role="radiogroup" aria-label="Graphics">
                {(['fast', 'auto', 'pretty'] as const).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={gfx.mode === m} className={gfx.mode === m ? 'on' : ''} onClick={() => quality.setMode(m)}>
                    {m === 'fast' ? 'Fast' : m === 'auto' ? 'Auto' : 'Pretty'}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="hud-menu-item"
              aria-pressed={on}
              onClick={() => {
                if (music.playing) music.stop();
                else music.start();
                setOn(music.playing);
              }}
            >
              <span>🎵 Music</span>
              <b>{on ? 'On' : 'Off'}</b>
            </button>
            <button type="button" className="hud-menu-item" onClick={() => (document.fullscreenElement ? document.exitFullscreen() : goFullscreen())}>
              <span>⛶ Full screen</span>
              <b>{document.fullscreenElement ? 'On' : 'Off'}</b>
            </button>
            <p className="hud-menu-title">Go to</p>
            <div className="hud-menu-row">
              <span>📍 Place</span>
              <select
                className="jump"
                value=""
                aria-label="Go to a place"
                onChange={(e) => {
                  if (e.target.value) jumpTo(e.target.value);
                  setMenu(false);
                }}
              >
                <option value="">Choose…</option>
                {cab.destinations().map((d) => (
                  <option key={d.n} value={d.n}>
                    {d.e} {d.n}
                  </option>
                ))}
              </select>
            </div>
            <p className="hud-menu-title">How to play</p>
            <ul className="hud-menu-keys">
              {isTouch ? (
                <>
                  <li>🕹️ Left thumb walks · drag the right side to look</li>
                  <li>👆 Tap people and things to use them</li>
                  <li>🚗 Riding: drag to steer where you look · GO & BRAKE pedals</li>
                </>
              ) : (
                <>
                  <li>⌨️ W A S D walk · mouse looks · Shift runs</li>
                  <li>🖱️ Click things to use them · Esc frees the mouse</li>
                  <li>🚗 Riding: look to steer · W go · S brake · V view · H horn</li>
                  <li>🚕 C cab · V vehicle · M map · Enter chat</li>
                </>
              )}
            </ul>
            <a className="hud-menu-item" href="/book.html">
              <span>📖 Classic site</span>
              <b>→</b>
            </a>
          </div>
        )}
      </div>
    </div>
  );
}
