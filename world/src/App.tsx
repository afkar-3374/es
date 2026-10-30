import * as THREE from 'three';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Preload } from '@react-three/drei';
import { QualityControl } from './world/QualityControl';
import { useQuality } from './world/quality';
import { LampPool } from './world/Lamps';
import { Merged } from './world/Merged';
import { Physics } from '@react-three/rapier';
import { useConditions } from './env/useConditions';
import { Atmosphere } from './world/Atmosphere';
import { Rain } from './world/Rain';
import { Street } from './world/Street';
import { MapTiles } from './world/MapTiles';
import { Landmarks } from './world/Landmarks';
import { GoogleTiles } from './world/GoogleTiles';
import { BusStops } from './world/BusStops';
import { useReal } from './world/real';
import { Cab } from './world/Cab';
import { CabUi } from './ui/Cab';
import { groundAt, inGap, useMeta } from './world/map';
import { cab, nearestRoad } from './world/cab';
import { ui } from './world/interact';
import { Peers } from './world/Peers';
import { Chat } from './ui/Chat';
import { Minimap } from './ui/Minimap';
import { goFullscreen, keepFullscreen, RotateHint } from './ui/Landscape';
import { net, peers, type Profile } from './net/net';
import { voice } from './net/voice';
import { Neighbours } from './world/Neighbours';
import { Building } from './world/Building';
import { Interior } from './world/Interior';
import { Stairs } from './world/Stairs';
import { Library } from './world/Library';
import { ReadingCorner } from './world/ReadingCorner';
import { Cafe } from './world/Cafe';
import { Held } from './world/Held';
import { Vehicles } from './world/Vehicles';
import { Traffic } from './world/Traffic';
import { music } from './audio/music';
import { Interactor } from './world/Interactor';
import { requestUse } from './world/interact';
import { Palms, type PalmSpot } from './world/Palms';
import { Player } from './player/Player';
import { PosePreview } from './world/PosePreview';
import { Hud } from './ui/Hud';
import { Intro } from './ui/Intro';
import { TouchControls } from './ui/TouchControls';
import { Overlay } from './ui/Overlay';
import { BookReader } from './ui/BookReader';
import { useUiValue } from './world/interact';
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

const DEBUG = new URLSearchParams(location.search).has('debug');
// For previews: ?debug exposes a way to press "use" from the console
if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { esUse: requestUse, esWorld: world, esSay: net.say, esRide: ride, esInput: input, esPeers: peers, esGround: groundAt });

// Coconut palms along both footpaths (not in front of the entrance)
const PALMS: PalmSpot[] = [
  ...[-54, -44, -27, 27, 44, 54].map((x) => ({ x, z: 3.6 })),
  ...[-50, -31, -16, 13, 34, 50].map((x) => ({ x, z: 16.9 })), // (none right where people arrive: it hides the sign)
];

/** The building's insides are only drawn when you're close enough to see them. */
function NearBuilding({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  // indoors the roof is in the sun's way anyway: skip all of this in the shadow pass
  const frame = useRef(0);
  useFrame(() => {
    if (++frame.current % 30 === 1) group.current?.traverse((o) => (o.castShadow = false));
    const p = world.player;
    if (group.current) group.current.visible = Math.hypot(p.x, p.z + 10) < 75;
  });
  return <group ref={group}>{children}</group>;
}

export default function App() {
  const c = useConditions();
  const [entered, setEntered] = useState(false);
  const book = useUiValue((s) => s.book);
  const gfx = useQuality();
  const realView = useReal();
  // no palm in the middle of a side road
  const gaps = useMeta()?.gaps;
  const palms = useMemo(() => PALMS.filter((p) => !inGap(gaps, p.z < 10 ? 'n' : 's', p.x - 1, p.x + 1)), [gaps]);
  // the sound of rain follows the weather (once you've entered, so audio is allowed)
  useEffect(() => {
    if (entered) music.setRain(c.weather.rain > 0.05 ? Math.min(0.3 + c.weather.rain / 4, 1) : 0);
  }, [entered, c.weather.rain]);
  // once in town, stay full screen
  useEffect(() => (entered ? keepFullscreen() : undefined), [entered]);

  const enter = useCallback((profile: Profile) => {
    setEntered(true);
    // start where you said you are: on the nearest road, at its side
    const there = cab.destinations().find((d) => d.n === profile.start);
    if (there)
      nearestRoad(there.x, there.z).then((r) => {
        if (!r) return;
        const x = r.x + r.dz * 4;
        const z = r.z - r.dx * 4;
        world.dismountAt = new THREE.Vector3(x, groundAt(x, z) + 0.5, z);
        ui.toast(`${there.e} Welcome to ${there.n}!`);
      });
    net.start(profile);
    voice.start();
    goFullscreen();
    music.setRain(world.rain);
    if (!isTouch) lockPointer();
  }, []);

  return (
    <>
      <Canvas
        shadows="percentage"
        dpr={Math.min(gfx.settings.dpr, window.devicePixelRatio || 1)}
        gl={{ antialias: true, powerPreference: 'high-performance' }}
        camera={{ fov: 70, near: 0.1, far: 7000, position: [0, 1.85, 16.5] }}
        onCreated={({ gl }) => {
          if (DEBUG) Object.assign(window, { esGl: gl });
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
        <QualityControl />
        <Suspense fallback={null}>
          <Atmosphere c={c} />
          <LampPool />
          <Physics gravity={[0, -9.81, 0]}>
            <Street />
            {!OFF.has('map') && <MapTiles />}
            {!OFF.has('map') && <Landmarks />}
            {realView && <GoogleTiles />}
            {!OFF.has('map') && <BusStops />}
            <Neighbours />
            <Merged>
              <Building />
            </Merged>
            <NearBuilding>
              <Merged>
                <Interior />
                <Stairs />
                {!OFF.has('library') && <Library />}
                {!OFF.has('corner') && <ReadingCorner />}
                {!OFF.has('cafe') && <Cafe />}
              </Merged>
            </NearBuilding>
            {!OFF.has('vehicles') && <Vehicles />}
            {entered && !OFF.has('traffic') && <Traffic />}
            {entered && <Peers />}
            {entered && <Cab />}
            <Player start={START} startYaw={START_YAW} startPitch={START_PITCH} />
          </Physics>
          <Palms spots={palms} />
          {DEBUG && new URLSearchParams(location.search).has('poses') && <PosePreview />}
          <Interactor />
          {!OFF.has('held') && <Held />}
          <Preload all />
          <Rain intensity={c.weather.rain > 0.05 ? Math.min(0.25 + c.weather.rain / 5, 1) : 0} wind={c.weather.wind} />
        </Suspense>
      </Canvas>

      {entered && isTouch && !book && <TouchControls />}
      {entered && <Hud c={c} />}
      {entered && <Overlay />}
      {entered && <Chat />}
      {entered && <Minimap />}
      {entered && <CabUi />}
      <BookReader />
      {!entered && <Intro c={c} onEnter={enter} />}
      {entered && <RotateHint />}
    </>
  );
}
