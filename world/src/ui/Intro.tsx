import { useProgress } from '@react-three/drei';
import { isTouch } from '../player/input';
import type { Conditions } from '../env/kasaragod';

/** The welcome card: what this is, loading progress, and the Enter button. */
export function Intro({ c, onEnter }: { c: Conditions; onEnter: () => void }) {
  const { progress, active } = useProgress();
  const ready = !active && progress >= 100;
  return (
    <div className="intro">
      <div className="card">
        <p className="eyebrow">Electrosparkzz</p>
        <h1>Come on in.</h1>
        <p className="lead">
          Our building in Kasaragod, Kerala. The sky, the light and the weather here follow Kasaragod right now:{' '}
          <b>
            {c.clock}, {c.weather.emoji} {c.weather.label.toLowerCase()}, {c.weather.temperature}°
          </b>
          .
        </p>
        <ul className="keys">
          {isTouch ? (
            <>
              <li>🕹️ Left thumb: walk</li>
              <li>👆 Right thumb: look around</li>
            </>
          ) : (
            <>
              <li>⌨️ W A S D or arrows: walk</li>
              <li>🖱️ Mouse: look around · Shift: run</li>
              <li>⎋ Esc: free your mouse</li>
            </>
          )}
        </ul>
        <button type="button" className="enter" disabled={!ready} onClick={onEnter}>
          {ready ? 'Enter the street →' : `Building the street… ${Math.round(progress)}%`}
        </button>
        <a className="classic" href="../">
          or read our books on the classic site
        </a>
      </div>
    </div>
  );
}
