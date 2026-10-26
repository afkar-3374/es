import type { Conditions } from '../env/kasaragod';

/** Kasaragod's live time and weather, plus a way back to the classic site. */
export function Hud({ c }: { c: Conditions }) {
  const w = c.weather;
  return (
    <div className="hud">
      <div className="pill" title={w.live ? 'Live weather in Kasaragod (Open-Meteo)' : 'Live weather unavailable: typical weather for the season'}>
        <span>📍 Kasaragod</span>
        <b>{c.clock}</b>
        <span>
          {w.emoji} {w.temperature}° · {w.label}
        </span>
      </div>
      <a className="pill link" href="../">
        📖 Classic site
      </a>
    </div>
  );
}
