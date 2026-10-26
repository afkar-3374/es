import * as THREE from 'three';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useConditions } from './env/useConditions';
import { Atmosphere } from './world/Atmosphere';
import { Rain } from './world/Rain';
import { Street } from './world/Street';
import { Neighbours } from './world/Neighbours';
import { Building } from './world/Building';
import { Interior } from './world/Interior';
import { Stairs } from './world/Stairs';
import { Library } from './world/Library';
import { ReadingCorner } from './world/ReadingCorner';
import { music } from './audio/music';
import { Interactor } from './world/Interactor';
import { requestUse } from './world/interact';
import { Palms, type PalmSpot } from './world/Palms';
import { Player } from './player/Player';
import { Hud } from './ui/Hud';
import { Intro } from './ui/Intro';
import { TouchControls } from './ui/TouchControls';
import { Overlay } from './ui/Overlay';
import { BookReader } from './ui/BookReader';
import { useUi } from './world/interact';
import { world } from './world/state';
import { isTouch } from './player/input';

/** Lock the mouse to the world for looking around (browsers may refuse; that's fine). */
function lockPointer() {
  try {
    const result = document.querySelector('canvas')?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    result?.catch?.(() => {});
  } catch {
    /* not allowed here */
  }
}

// For previews: ?cam=x,z,yaw starts the visitor somewhere else
const cam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
const START: [number, number, number] = cam && cam.length >= 2 ? [cam[0], 1.2 + (cam[3] || 0), cam[1]] : [0, 1.2, 16.5];
const START_YAW = cam && cam.length >= 3 ? cam[2] : 0;
const START_PITCH = cam && cam.length >= 5 ? cam[4] : -0.05;

// For previews: ?debug exposes a way to press "use" from the console
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esUse: requestUse, esWorld: world });

// Coconut palms along both footpaths (not in front of the entrance)
const PALMS: PalmSpot[] = [
  ...[-58, -44, -27, 27, 44, 58, 80, -80, 104, -104].map((x) => ({ x, z: 3.6 })),
  ...[-70, -50, -31, -12, 7, 26, 47, 68, 92, -92].map((x) => ({ x, z: 16.9 })),
];

export default function App() {
  const c = useConditions();
  const [entered, setEntered] = useState(false);
  const { book } = useUi();
  // the sound of rain follows the weather (once you've entered, so audio is allowed)
  useEffect(() => {
    if (entered) music.setRain(c.weather.rain > 0.05 ? Math.min(0.3 + c.weather.rain / 4, 1) : 0);
  }, [entered, c.weather.rain]);

  const enter = useCallback(() => {
    setEntered(true);
    music.setRain(world.rain);
    if (!isTouch) lockPointer();
  }, []);

  return (
    <>
      <Canvas
        shadows="soft"
        dpr={[1, Math.min(window.devicePixelRatio, isTouch ? 1.5 : 2)]}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 70, near: 0.08, far: 1600, position: [0, 1.85, 16.5] }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 0.95;
        }}
        onClick={() => {
          if (!entered || isTouch) return;
          // first click locks the mouse; after that a click uses what's under the crosshair
          if (!document.pointerLockElement) lockPointer();
          else requestUse(0, 0);
        }}
      >
        <Suspense fallback={null}>
          <Atmosphere c={c} />
          <Physics gravity={[0, -9.81, 0]}>
            <Street />
            <Neighbours />
            <Building />
            <Interior />
            <Stairs />
            <Library />
            <ReadingCorner />
            <Player start={START} startYaw={START_YAW} startPitch={START_PITCH} />
          </Physics>
          <Palms spots={PALMS} />
          <Interactor />
          <Rain intensity={c.weather.rain > 0.05 ? Math.min(0.25 + c.weather.rain / 5, 1) : 0} wind={c.weather.wind} />
        </Suspense>
      </Canvas>

      {entered && <Hud c={c} />}
      {entered && isTouch && !book && <TouchControls />}
      {entered && <Overlay />}
      <BookReader />
      {!entered && <Intro c={c} onEnter={enter} />}
    </>
  );
}
