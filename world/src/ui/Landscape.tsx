import { useEffect, useState } from 'react';
import { isTouch } from '../player/input';

const portraitQuery = matchMedia('(orientation: portrait)');

/** Phones play sideways: go full screen and lock to landscape where the browser lets us (Android). */
export async function goLandscape() {
  if (!isTouch) return;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
  } catch {
    /* not allowed (e.g. iPhone): the rotate hint takes over */
  }
  try {
    await (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }).lock?.('landscape');
  } catch {
    /* not supported */
  }
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
      <button type="button" onClick={() => goLandscape()}>
        Go full screen
      </button>
    </div>
  );
}
