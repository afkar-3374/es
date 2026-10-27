import { useEffect, useMemo, useState } from 'react';
import { cab, useCab, type Destination } from '../world/cab';
import { ui, useUi } from '../world/interact';
import { world } from '../world/state';
import { typing } from '../player/input';

/*
 * Booking a cab: pick a place in Kasaragod (nearest first, or search), and a taxi takes
 * you there by road. While you ride: where you're going, how far, how long, fast travel,
 * skip to the end, or get out here.
 */

const km = (m: number) => (m < 950 ? `${Math.round(m / 50) * 50} m` : `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`);
const mins = (s: number) => (s < 90 ? '1 min' : s < 3600 ? `${Math.round(s / 60)} min` : `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`);

let openMenu: (open: boolean) => void = () => {};
/** Open the cab menu (from the HUD button or C). */
export const bookCab = () => {
  if (ui.get().riding) return ui.toast('Get off your vehicle first, then book a cab.');
  if (cab.get().status !== 'idle') return;
  if (document.pointerLockElement) document.exitPointerLock();
  openMenu(true);
};

export function CabUi() {
  const [open, setOpen] = useState(false);
  const s = useCab();
  const { card, book } = useUi();
  openMenu = setOpen;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e) || ui.get().card || ui.get().book) return;
      if (e.code === 'KeyC') bookCab();
      if (e.code === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (open && !card && !book) return <CabMenu onClose={() => setOpen(false)} />;
  if (s.status === 'finding') return <div className="cab-bar">🚕 Finding the best way…</div>;
  if (s.status === 'coming' || s.status === 'riding') return <CabBar />;
  return null;
}

function CabMenu({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const here = world.player;
  const list = useMemo(() => {
    const all = cab
      .destinations()
      .map((d) => ({ d, far: Math.hypot(d.x - here.x, d.z - here.z) }))
      .filter(({ far }) => far > 80);
    const words = q.trim().toLowerCase();
    return all.filter(({ d }) => !words || d.n.toLowerCase().includes(words)).sort((a, b) => a.far - b.far);
  }, [q, here.x, here.z]);

  const go = async (d: Destination) => {
    onClose();
    const r = await cab.book(d, world.player.x, world.player.z);
    if (r === 'no-route') ui.toast('No road goes there from here. Try another place.');
    if (r === 'offline') ui.toast('Couldn’t reach the cab office. Check your connection and try again.');
  };

  return (
    <div className="card-wrap" onClick={onClose}>
      <div className="cab-card" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Book a cab">
        <div className="cab-head">
          <span className="cab-emoji" aria-hidden="true">
            🚕
          </span>
          <div>
            <h2>Book a cab</h2>
            <p>A taxi takes you there by the real roads of Kasaragod.</p>
          </div>
          <button type="button" className="cab-x" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <input className="cab-search" placeholder="Where to? (Bekal Fort, bus stand…)" value={q} onChange={(e) => setQ(e.target.value)} autoFocus={!('ontouchstart' in window)} />
        <ul className="cab-list">
          {list.map(({ d, far }) => (
            <li key={d.n}>
              <button type="button" onClick={() => go(d)}>
                <span className="cab-place-emoji" aria-hidden="true">
                  {d.e}
                </span>
                <span className="cab-place">
                  <b>{d.n}</b>
                  <small>
                    about {km(far * 1.3)} · {mins((far * 1.3) / 9)}
                  </small>
                </span>
                <span className="cab-go">Go →</span>
              </button>
            </li>
          ))}
          {!list.length && <li className="cab-none">No place by that name yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function CabBar() {
  const s = useCab();
  const [, tick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tick((n) => n + 1), 500);
    return () => window.clearInterval(t);
  }, []);
  const route = s.route!;
  const left = Math.max(0, route.total - cab.live.done);
  const speed = Math.max(cab.live.speed * s.fast, 1);
  return (
    <div className="cab-bar riding">
      <div className="cab-to">
        <span aria-hidden="true">{s.to?.e ?? '🚕'}</span>
        <div>
          <b>{s.status === 'coming' ? 'Getting in…' : s.to?.n}</b>
          <small>
            {km(left)} · {mins(left / Math.max(speed, 8 * s.fast))} · {Math.round(cab.live.speed * 3.6)} km/h
          </small>
        </div>
      </div>
      <div className="cab-actions">
        <div className="cab-fast" role="radiogroup" aria-label="Fast travel">
          {([1, 4, 10] as const).map((f) => (
            <button key={f} type="button" role="radio" aria-checked={s.fast === f} className={s.fast === f ? 'on' : ''} onClick={() => cab.setFast(f)}>
              {f}×
            </button>
          ))}
        </div>
        <button type="button" className="ghost" onClick={() => cab.toggleView()} title="Watch from behind the taxi, or sit inside">
          {s.view === 'behind' ? '🪑 Inside' : '🎥 Behind'}
        </button>
        <button type="button" onClick={() => cab.skip()} title="Arrive now">
          ⏭ Skip
        </button>
        <button type="button" className="ghost" onClick={() => cab.end()} title="Get out here">
          Get out
        </button>
      </div>
    </div>
  );
}
