import { useEffect, useState } from 'react';
import { useProgress } from '@react-three/drei';
import { isTouch } from '../player/input';
import { loadProfile, LOOKS, type Profile } from '../net/net';
import { useMeta } from '../world/map';
import type { Destination } from '../world/cab';
import type { Conditions } from '../env/kasaragod';

const LOOK_LABELS: Record<(typeof LOOKS)[number], string> = {
  rider: '👔 Shirt',
  kurta: '🕌 Kurta',
  hoodie: '🧢 Hoodie',
  jacket: '🧥 Jacket',
  receptionist: '💼 Smart',
  barista: '☕ Café',
  salwar: '🧕 Salwar',
  dress: '👗 Dress',
};
/** Men's looks first, then women's (the order on the card, not in the list) */
const CARD_ORDER: (typeof LOOKS)[number][] = ['rider', 'kurta', 'hoodie', 'jacket', 'receptionist', 'barista', 'salwar', 'dress'];

/** The welcome card: your name and look, loading progress, and the way in. */
export function Intro({ c, onEnter }: { c: Conditions; onEnter: (p: Profile) => void }) {
  const { progress, active } = useProgress();
  // once the town is ready it stays ready (more pieces load later, e.g. the map around you)
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!active && progress >= 100) setReady(true);
  }, [active, progress]);
  const [profile, setProfile] = useState(loadProfile);
  const places = ((useMeta() as { destinations?: Destination[] } | null)?.destinations ?? []).filter((d) => !d.home);
  return (
    <div className="intro">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onEnter(profile);
        }}
      >
        <div className="intro-head">
          <p className="eyebrow">Electrosparkzz Town · Kasaragod</p>
          <h1>Come on in.</h1>
          <p className="lead">
            All of Kasaragod district in 3D — its real roads, 400,000 buildings, hills, forts and temples, buses and autos — shared with everyone here right now. The sky and weather follow Kasaragod live:{' '}
            <b>
              {c.clock}, {c.weather.emoji} {c.weather.label.toLowerCase()}, {c.weather.temperature}°
            </b>
            .
          </p>
        </div>
        <div className="intro-form">
          <label className="name-field">
            <span>Your name in town</span>
            <input value={profile.name} maxLength={20} autoComplete="nickname" onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
          </label>
          <label className="name-field start-field">
            <span>Where are you? Start there</span>
            <select value={profile.start ?? ''} onChange={(e) => setProfile({ ...profile, start: e.target.value || undefined })}>
              <option value="">⚡ Electrosparkzz, Mogral (by the bus stop)</option>
              {places.map((d) => (
                <option key={d.n} value={d.n}>
                  {d.e} {d.n}
                </option>
              ))}
            </select>
          </label>
          <div className="looks" role="radiogroup" aria-label="How you look">
            {CARD_ORDER.map((l) => {
              const i = LOOKS.indexOf(l);
              return (
                <button key={l} type="button" role="radio" aria-checked={profile.look === i} className={profile.look === i ? 'on' : ''} onClick={() => setProfile({ ...profile, look: i })}>
                  {LOOK_LABELS[l]}
                </button>
              );
            })}
          </div>
          <ul className="keys">
            {isTouch ? (
              <>
                <li>🕹️ Left thumb: walk · 👆 right thumb: look</li>
                <li>🛵 Your own vehicle: drag to steer, GO & BRAKE · 🚕 book a cab</li>
                <li>🔄 Best held sideways (landscape)</li>
              </>
            ) : (
              <>
                <li>⌨️ W A S D: walk · 🖱️ mouse: look · Shift: run</li>
                <li>🛵 V: your vehicle (steer by looking) · 🚕 C: cab · 💬 Enter: chat · 🗺️ M: map</li>
                <li>⎋ Esc: free your mouse</li>
              </>
            )}
          </ul>
          <button type="submit" className="enter" disabled={!ready || !profile.name.trim()} aria-busy={!ready}>
            {ready ? (
              'Enter town →'
            ) : (
              <>
                <span className="ring" aria-hidden="true" /> Getting the town ready
              </>
            )}
          </button>
          <a className="classic" href="/book.html">
            or read our books on the classic site
          </a>
        </div>
      </form>
    </div>
  );
}
