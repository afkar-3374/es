import { useEffect, useState } from 'react';
import type { Conditions } from '../env/kasaragod';
import { music } from '../audio/music';
import { useNet } from '../net/net';
import { ui, useUi } from '../world/interact';
import { ride } from '../world/ride';
import { SPECS } from '../world/vehicleModels';
import { KINDS } from '../net/net';
import { typing } from '../player/input';
import { quality, useQuality } from '../world/quality';

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || ui.get().card || ui.get().book) return;
      if (e.code === 'KeyV') chooseVehicle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const here = roster.length + 1;
  return (
    <div className="hud">
      <div className="hud-left">
        <div className="pill" title={w.live ? 'Live weather in Kasaragod (Open-Meteo)' : 'Live weather unavailable: typical weather for the season'}>
          <span>📍 Kasaragod</span>
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
        {!riding && !card && !book && (
          <button type="button" className="pill link" onClick={chooseVehicle} title="Call your own vehicle (V)">
            🛵 My vehicle
          </button>
        )}
        <button
          type="button"
          className="pill link"
          title="Graphics: Auto adjusts to keep things smooth; Fast for older devices; Pretty for strong ones"
          onClick={() => quality.setMode(gfx.mode === 'auto' ? 'fast' : gfx.mode === 'fast' ? 'pretty' : 'auto')}
        >
          ⚙️ {gfx.mode === 'auto' ? 'Auto' : gfx.mode === 'fast' ? 'Fast' : 'Pretty'}
        </button>
        <button
          type="button"
          className="pill link"
          aria-pressed={on}
          title="Soft lo-fi music"
          onClick={() => {
            if (music.playing) music.stop();
            else music.start();
            setOn(music.playing);
          }}
        >
          {on ? '🎵 On' : '🎵'}
        </button>
        <a className="pill link" href="/book.html">
          📖 Classic site
        </a>
      </div>
    </div>
  );
}
