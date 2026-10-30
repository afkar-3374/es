import * as THREE from 'three';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useFrame, useThree } from '@react-three/fiber';
import { TilesRenderer } from '3d-tiles-renderer';
import { GoogleCloudAuthPlugin, ReorientationPlugin, TileCompressionPlugin, UpdateOnChangePlugin, UnloadTilesPlugin } from '3d-tiles-renderer/plugins';
import { GOOGLE_TILES_KEY } from '../net/config';
import { groundAt, useMeta } from './map';
import { world } from './state';
import { useQuality } from './quality';

/*
 * Google's Photorealistic 3D Tiles, placed on our map: the tiles are centred on the site
 * (Mogral) with x west and z north, which our east/south frame turns by half a turn, then
 * onto the world axes like everything else from latitude and longitude (meta.frame).
 * Their heights are above the ellipsoid, ours above the site's ground: the difference is
 * measured once under you (a ray down onto the tiles) and taken off.
 */

const DEG = Math.PI / 180;

export function GoogleTiles() {
  const meta = useMeta();
  const { camera, gl, scene } = useThree();
  const { level } = useQuality();
  const lift = useRef<THREE.Group>(null);
  const [credits, setCredits] = useState('');

  const tiles = useMemo(() => {
    if (!meta || !GOOGLE_TILES_KEY) return null;
    const t = new TilesRenderer();
    t.registerPlugin(new GoogleCloudAuthPlugin({ apiToken: GOOGLE_TILES_KEY, autoRefreshToken: true }));
    t.registerPlugin(new TileCompressionPlugin());
    t.registerPlugin(new UpdateOnChangePlugin());
    t.registerPlugin(new UnloadTilesPlugin());
    t.registerPlugin(new ReorientationPlugin({ lat: meta.site.lat * DEG, lon: meta.site.lon * DEG, height: 0 }));
    return t;
  }, [meta]);

  useEffect(() => {
    if (!tiles) return;
    tiles.setCamera(camera);
    return () => {
      tiles.deleteCamera(camera);
      tiles.dispose();
    };
  }, [tiles, camera]);

  // phones: coarser tiles (fewer, faster)
  useEffect(() => {
    if (tiles) tiles.errorTarget = [24, 14, 8][level];
  }, [tiles, level]);

  // the far view opens right up: no haze, and the camera sees kilometres
  useEffect(() => {
    const fog = scene.fog as THREE.FogExp2 | null;
    const was = fog?.density;
    const far = (camera as THREE.PerspectiveCamera).far;
    if (fog) fog.density = 0.00012;
    (camera as THREE.PerspectiveCamera).far = 40000;
    camera.updateProjectionMatrix();
    return () => {
      if (fog && was !== undefined) fog.density = was;
      (camera as THREE.PerspectiveCamera).far = far;
      camera.updateProjectionMatrix();
    };
  }, [scene, camera]);

  const level0 = useRef({ done: false, tries: 0, at: 0, x: 0, z: 0 });
  const ray = useMemo(() => new THREE.Raycaster(), []);
  useFrame(({ clock }) => {
    if (!tiles || !lift.current) return;
    // (atmosphere's fog is set again when the weather changes)
    const fog = scene.fog as THREE.FogExp2 | null;
    if (fog && fog.density > 0.0003) fog.density = 0.00012;
    camera.updateMatrixWorld();
    tiles.setResolutionFromRenderer(camera, gl);
    tiles.update();
    // match their ground to ours, under you (every few seconds until it's found)
    const l = level0.current;
    // (the Earth curves away under a flat map: about 30 m lower 20 km off, so measure again as you travel)
    if (l.done && Math.hypot(world.player.x - l.x, world.player.z - l.z) > 700) Object.assign(l, { done: false, tries: 0 });
    if (!l.done && clock.elapsedTime - l.at > 1.5) {
      l.at = clock.elapsedTime;
      const p = world.player;
      ray.set(new THREE.Vector3(p.x, 3000, p.z), new THREE.Vector3(0, -1, 0));
      ray.far = 6000;
      const hit = ray.intersectObject(tiles.group, true)[0];
      if (hit) {
        lift.current.position.y += groundAt(p.x, p.z) - hit.point.y;
        l.done = ++l.tries >= 2;
        l.x = p.x;
        l.z = p.z;
      }
    }
    if (Math.round(clock.elapsedTime * 2) % 6 === 0) {
      const c = [...new Set(tiles.getAttributions().filter((a) => a.type === 'string').map((a) => String(a.value)))].join(' · ');
      if (c !== credits) setCredits(c);
    }
  });

  if (!tiles || !meta?.frame) return null;
  const f = meta.frame;
  const yaw = Math.atan2(f.ax[1], f.ax[0]);
  // the site (east/south 0, 0) in the world
  const ox = -(f.origin[0] * f.ax[0] + f.origin[1] * f.ax[1]);
  const oz = -(f.origin[0] * f.az[0] + f.origin[1] * f.az[1]);
  return (
    <>
      <group position={[ox, 0, oz]} rotation={[0, yaw, 0]}>
        <group ref={lift}>
          {/* x west / z north → our x east / z south */}
          <group rotation={[0, Math.PI, 0]}>
            <primitive object={tiles.group} />
          </group>
        </group>
      </group>
      {createPortal(
        <div className="google-credit">
          <img src="https://www.gstatic.com/images/branding/googlelogo/2x/googlelogo_light_color_68x28dp.png" alt="Google" height="16" />
          <span>{credits}</span>
        </div>,
        document.body
      )}
    </>
  );
}
