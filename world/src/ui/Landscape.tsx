import { useEffect, useState } from 'react';
import { isTouch } from '../player/input';

const portraitQuery = matchMedia('(orientation: portrait)');

// installed to the home screen, or inside the ES Town Android app: already full screen and sideways
const standalone = matchMedia('(display-mode: fullscreen), (display-mode: standalone)').matches || navigator.userAgent.includes('ESTownApp');

/**
 * The town always fills the whole screen, with no browser bars: full screen on every
 * device, and on phones locked sideways where the browser lets us (Android). Call it from
 * a tap or click (browsers only allow full screen then).
 */
export function goFullscreen() {
  const el = document.documentElement;
  if (!document.fullscreenElement && !standalone && el.requestFullscreen) {
    el.requestFullscreen({ navigationUI: 'hide' })
      .then(lockLandscape)
      .catch(() => {
        /* not allowed (e.g. iPhone Safari): add to home screen instead; the rotate hint covers portrait */
      });
  } else lockLandscape();
}

function lockLandscape() {
  if (!isTouch) return;
  (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape').catch(() => {
    /* not supported */
  });
}

/** After leaving full screen (Esc, a swipe), the next tap, click or key goes back into it. */
export function keepFullscreen() {
  const back = (e: Event) => {
    if (document.fullscreenElement || standalone) return;
    if (e instanceof KeyboardEvent && (e.code === 'Escape' || e.key === 'F11')) return;
    goFullscreen();
  };
  window.addEventListener('pointerup', back, true);
  window.addEventListener('keydown', back, true);
  return () => {
    window.removeEventListener('pointerup', back, true);
    window.removeEventListener('keydown', back, true);
  };
}

export function usePortrait() {
  const [portrait, setPortrait] = useState(isTouch && portraitQuery.matches);
  useEffect(() => {
    if (!isTouch) return;
    const on = () => setPortrait(portraitQuery.matches);
    portraitQuery.addEventListener('change', on);
    return () => portraitQuery.removeEventListener('change', on);
  }, []);
  return portrait;
}

/** Covers the town while a phone is held upright. */
export function RotateHint() {
  const portrait = usePortrait();
  if (!portrait) return null;
  return (
    <div className="rotate">
      <div className="rotate-phone" aria-hidden="true">📱</div>
      <h2>Turn your phone sideways</h2>
      <p>The town is made for landscape. Rotate your phone to walk, ride and chat.</p>
      <button type="button" onClick={() => goFullscreen()}>
        Go full screen
      </button>
    </div>
  );
}
