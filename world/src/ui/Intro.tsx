import { useState } from 'react';
import { useProgress } from '@react-three/drei';
import { isTouch } from '../player/input';
import { loadProfile, LOOKS, type Profile } from '../net/net';
import type { Conditions } from '../env/kasaragod';

const LOOK_LABELS: Record<(typeof LOOKS)[number], string> = { rider: '🧢 Casual', barista: '☕ Café', receptionist: '💼 Smart' };

/** The welcome card: your name and look, loading progress, and the way in. */
export function Intro({ c, onEnter }: { c: Conditions; onEnter: (p: Profile) => void }) {
  const { progress, active } = useProgress();
  const ready = !active && progress >= 100;
  const [profile, setProfile] = useState(loadProfile);
  return (
    <div className="intro">
      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault();
          if (ready) onEnter(profile);
        }}
      >
        <p className="eyebrow">Electrosparkzz Town</p>
        <h1>Come on in.</h1>
        <p className="lead">
          A little Kasaragod town by the sea, shared with everyone here right now. The sky and weather follow Kasaragod live:{' '}
          <b>
            {c.clock}, {c.weather.emoji} {c.weather.label.toLowerCase()}, {c.weather.temperature}°
          </b>
          .
        </p>
        <label className="name-field">
          <span>Your name in town</span>
          <input value={profile.name} maxLength={20} autoComplete="nickname" onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
        </label>
        <div className="looks" role="radiogroup" aria-label="How you look">
          {LOOKS.map((l, i) => (
            <button key={l} type="button" role="radio" aria-checked={profile.look === i} className={profile.look === i ? 'on' : ''} onClick={() => setProfile({ ...profile, look: i })}>
              {LOOK_LABELS[l]}
            </button>
          ))}
        </div>
        <ul className="keys">
          {isTouch ? (
            <>
              <li>🕹️ Left thumb: walk · 👆 right thumb: look</li>
              <li>🛵 Call your own vehicle · 💬 chat with everyone</li>
              <li>🔄 Best held sideways (landscape)</li>
            </>
          ) : (
            <>
              <li>⌨️ W A S D: walk · 🖱️ mouse: look · Shift: run</li>
              <li>🛵 V: your vehicle · 💬 Enter: chat · 🗺️ M: map</li>
              <li>⎋ Esc: free your mouse</li>
            </>
          )}
        </ul>
        <button type="submit" className="enter" disabled={!ready || !profile.name.trim()}>
          {ready ? 'Enter town →' : `Building the town… ${Math.round(progress)}%`}
        </button>
        <a className="classic" href="/book.html">
          or read our books on the classic site
        </a>
      </form>
    </div>
  );
}
