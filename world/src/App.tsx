import * as THREE from 'three';
import { Suspense, useCallback, useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Physics } from '@react-three/rapier';
import { useConditions } from './env/useConditions';
import { Atmosphere } from './world/Atmosphere';
import { Rain } from './world/Rain';
import { Street } from './world/Street';
import { Roads } from './world/Roads';
import { Town, TOWN } from './world/Town';
import { Beach, BEACH_PALMS } from './world/Beach';
import { Peers } from './world/Peers';
import { Chat } from './ui/Chat';
import { Minimap } from './ui/Minimap';
import { goLandscape, RotateHint } from './ui/Landscape';
import { net, peers, type Profile } from './net/net';
import { Neighbours } from './world/Neighbours';
import { Building } from './world/Building';
import { Interior } from './world/Interior';
import { Stairs } from './world/Stairs';
import { Library } from './world/Library';
import { ReadingCorner } from './world/ReadingCorner';
import { Cafe } from './world/Cafe';
import { Held } from './world/Held';
import { Vehicles } from './world/Vehicles';
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
import { input, isTouch } from './player/input';
import { ride } from './world/ride';

/** Lock the mouse to the world for looking around (browsers may refuse; that's fine). */
function lockPointer() {
  try {
    const result = document.querySelector('canvas')?.requestPointerLock?.() as unknown as Promise<void> | undefined;
    result?.catch?.(() => {});
  } catch {
    /* not allowed here */
  }
}

// Everyone arrives on the footpath opposite the Electrosparkzz building (a step apart).
// For previews: ?cam=x,z,yaw starts the visitor somewhere else
const cam = new URLSearchParams(location.search).get('cam')?.split(',').map(Number);
const START: [number, number, number] = cam && cam.length >= 2 ? [cam[0], 1.2 + (cam[3] || 0), cam[1]] : [(Math.random() - 0.5) * 8, 1.2, 16.2 + Math.random() * 0.8];
const START_YAW = cam && cam.length >= 3 ? cam[2] : 0;
const START_PITCH = cam && cam.length >= 5 ? cam[4] : -0.05;

// For profiling: ?off=vehicles,cafe,corner,library,held turns parts off
const OFF = new Set((new URLSearchParams(location.search).get('off') ?? '').split(','));

// For previews: ?debug exposes a way to press "use" from the console
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esUse: requestUse, esWorld: world, esSay: net.say, esRide: ride, esInput: input, esPeers: peers });

// Coconut palms along both footpaths (not in front of the entrance), in the groves and on the beach
const PALMS: PalmSpot[] = [
  ...[-58, -44, -27, 27, 44, 58, 80, -80, 125, -125, 150, -150, 178, -178].map((x) => ({ x, z: 3.6 })),
  ...[-70, -50, -31, -12, 7, 26, 47, 68, 88, -88, 130, -130, 172, -172].map((x) => ({ x, z: 16.9 })),
  ...TOWN.palms,
  ...BEACH_PALMS,
];

export default function App() {
  const c = useConditions();
  const [entered, setEntered] = useState(false);
  const { book } = useUi();
  // the sound of rain follows the weather (once you've entered, so audio is allowed)
  useEffect(() => {
    if (entered) music.setRain(c.weather.rain > 0.05 ? Math.min(0.3 + c.weather.rain / 4, 1) : 0);
  }, [entered, c.weather.rain]);

  const enter = useCallback((profile: Profile) => {
    setEntered(true);
    net.start(profile);
    goLandscape();
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
            <Roads />
            {!OFF.has('town') && <Town />}
            {!OFF.has('beach') && <Beach />}
            <Neighbours />
            <Building />
            <Interior />
            <Stairs />
            {!OFF.has('library') && <Library />}
            {!OFF.has('corner') && <ReadingCorner />}
            {!OFF.has('cafe') && <Cafe />}
            {!OFF.has('vehicles') && <Vehicles c={c} />}
            {entered && <Peers />}
            <Player start={START} startYaw={START_YAW} startPitch={START_PITCH} />
          </Physics>
          <Palms spots={PALMS} />
          <Interactor />
          {!OFF.has('held') && <Held />}
          <Rain intensity={c.weather.rain > 0.05 ? Math.min(0.25 + c.weather.rain / 5, 1) : 0} wind={c.weather.wind} />
        </Suspense>
      </Canvas>

      {entered && isTouch && !book && <TouchControls />}
      {entered && <Hud c={c} />}
      {entered && <Overlay />}
      {entered && <Chat />}
      {entered && <Minimap />}
      <BookReader />
      {!entered && <Intro c={c} onEnter={enter} />}
      {entered && <RotateHint />}
    </>
  );
}
