import { useState } from 'react';
import type { Conditions } from '../env/kasaragod';
import { music } from '../audio/music';

/** Kasaragod's live time and weather, plus a way back to the classic site. */
export function Hud({ c }: { c: Conditions }) {
  const w = c.weather;
  const [on, setOn] = useState(music.playing);
  return (
    <div className="hud">
      <div className="pill" title={w.live ? 'Live weather in Kasaragod (Open-Meteo)' : 'Live weather unavailable: typical weather for the season'}>
        <span>📍 Kasaragod</span>
        <b>{c.clock}</b>
        <span>
          {w.emoji} {w.temperature}° · {w.label}
        </span>
      </div>
      <div className="hud-right">
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
        <a className="pill link" href="../">
          📖 Classic site
        </a>
      </div>
    </div>
  );
}
