import * as THREE from "three";
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Environment, Sky, Stars } from "@react-three/drei";
import { skyDirection, type Conditions } from "../env/kasaragod";
import { world } from "./state";
import { useQuality } from "./quality";
import { canvasTexture } from "./materials";

const lerp = THREE.MathUtils.lerp;
const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * Sky, sun, moon, stars, clouds and fog for the current time and weather in Kasaragod.
 */
export function Atmosphere({ c }: { c: Conditions }) {
  const sunDir = useMemo(
    () => new THREE.Vector3(...skyDirection(c.sunAltitude, c.sunAzimuth)),
    [c.sunAltitude, c.sunAzimuth],
  );
  const moonDir = useMemo(
    () => new THREE.Vector3(...skyDirection(c.moonAltitude, c.moonAzimuth)),
    [c.moonAltitude, c.moonAzimuth],
  );
  const cloud = c.weather.cloudCover;
  const rainy = clamp01(c.weather.rain / 4);
  const foggy = c.weather.code === 45 || c.weather.code === 48 ? 1 : 0;
  const day = c.daylight;
  const sunLow = clamp01(1 - c.sunAltitude / 0.35); // warm light near sunrise/sunset

  // Light colours and strengths
  const sunColor = useMemo(
    () =>
      new THREE.Color("#fff4e6").lerp(
        new THREE.Color("#ff9a5a"),
        sunLow * 0.85,
      ),
    [sunLow],
  );
  const sunIntensity = day * lerp(4.2, 1.1, cloud) * (1 - rainy * 0.5);
  const skyTint = useMemo(() => {
    const dayCol = new THREE.Color("#bcd6ee").lerp(
      new THREE.Color("#9aa3ad"),
      cloud * 0.8,
    );
    const nightCol = new THREE.Color("#0d1424");
    return nightCol.lerp(dayCol, day);
  }, [day, cloud]);
  const groundTint = useMemo(
    () => new THREE.Color("#1a1410").lerp(new THREE.Color("#7a6a58"), day),
    [day],
  );
  const fogColor = useMemo(() => {
    const dusk = new THREE.Color("#e7b9a0");
    const base = skyTint
      .clone()
      .lerp(new THREE.Color("#c9cfd6"), cloud * 0.5 * day);
    return base.lerp(dusk, sunLow * day * 0.35 * (1 - cloud));
  }, [skyTint, cloud, day, sunLow]);

  const { scene } = useThree();
  useEffect(() => {
    // clear days see the hills a couple of kilometres off; rain and mist close in
    scene.fog = new THREE.FogExp2(
      fogColor,
      0.0011 + rainy * 0.01 + foggy * 0.03 + cloud * 0.0015,
    );
    scene.background = fogColor;
  }, [scene, fogColor, rainy, foggy, cloud]);

  // Shared live values for lamps, wet roads, swaying palms
  useEffect(() => {
    world.night = clamp01(1 - day * 1.4);
    world.wind = c.weather.wind;
    world.rain = c.weather.rain > 0.05 ? rainy : 0;
  }, [day, c.weather.wind, c.weather.rain, rainy]);
  useFrame((_, dt) => {
    const targetWet = c.weather.rain > 0.05 ? clamp01(0.45 + rainy) : 0;
    world.wet += (targetWet - world.wet) * Math.min(dt * 0.15, 1);
  });

  // The sun follows the visitor so shadows stay sharp nearby (over a smaller area on slow machines)
  const { settings } = useQuality();
  const sun = useRef<THREE.DirectionalLight>(null);
  useEffect(() => {
    const l = sun.current;
    if (!l) return;
    const b = settings.shadowBox;
    Object.assign(l.shadow.camera, { left: -b, right: b, top: b, bottom: -b });
    l.shadow.camera.updateProjectionMatrix();
    if (l.shadow.mapSize.x !== settings.shadowMap) {
      l.shadow.mapSize.set(settings.shadowMap, settings.shadowMap);
      l.shadow.map?.dispose();
      (l.shadow as { map: THREE.WebGLRenderTarget | null }).map = null;
    }
  }, [settings.shadowBox, settings.shadowMap]);
  const moon = useRef<THREE.DirectionalLight>(null);
  useFrame(() => {
    const p = world.player;
    if (sun.current) {
      sun.current.position.set(
        p.x + sunDir.x * 80,
        Math.max(sunDir.y, 0.05) * 80,
        p.z + sunDir.z * 80,
      );
      sun.current.target.position.set(p.x, 0, p.z);
      sun.current.target.updateMatrixWorld();
    }
    if (moon.current) {
      moon.current.position.set(
        p.x + moonDir.x * 80,
        Math.max(moonDir.y, 0.05) * 80,
        p.z + moonDir.z * 80,
      );
      moon.current.target.position.set(p.x, 0, p.z);
      moon.current.target.updateMatrixWorld();
    }
  });

  const skySun: [number, number, number] = [
    sunDir.x * 100,
    sunDir.y * 100,
    sunDir.z * 100,
  ];
  const envKey = `${Math.round(c.sunAltitude * 40)}-${Math.round(cloud * 10)}-${Math.round(rainy * 5)}`;
  const moonUp = c.moonAltitude > 0 && day < 0.6;

  return (
    <>
      <FollowCamera>
        <Sky
          distance={4000}
          sunPosition={skySun}
          turbidity={lerp(4, 16, Math.max(cloud, rainy))}
          rayleigh={lerp(1.2, 0.4, cloud) + sunLow * 1.2}
          mieCoefficient={0.006}
          mieDirectionalG={0.85}
        />
        <Overcast
          amount={Math.max(cloud * 0.75, rainy * 0.95)}
          color={fogColor}
        />
        <Clouds
          cover={cloud * settings.clouds}
          day={day}
          wind={c.weather.wind}
        />
        {day < 0.35 && cloud < 0.85 && (
          <Stars
            radius={600}
            depth={80}
            count={2500}
            factor={6}
            saturation={0}
            fade
            speed={0.4}
          />
        )}
      </FollowCamera>

      {/* Reflections on glass, metal and wet roads come from the same sky */}
      <Environment
        key={envKey}
        resolution={64}
        frames={1}
        background={false}
        environmentIntensity={0.35 + day * 0.35}
      >
        <Sky
          distance={4000}
          sunPosition={skySun}
          turbidity={lerp(4, 16, cloud)}
          rayleigh={1}
          mieCoefficient={0.006}
          mieDirectionalG={0.85}
        />
        <mesh scale={900}>
          <sphereGeometry args={[1, 16, 8]} />
          <meshBasicMaterial
            color={skyTint}
            side={THREE.BackSide}
            transparent
            opacity={0.4 + (1 - day) * 0.55}
          />
        </mesh>
      </Environment>

      <hemisphereLight
        args={[
          skyTint,
          groundTint,
          lerp(0.12, 0.5, day) * (1 - rainy * 0.2) + cloud * 0.25 * day,
        ]}
      />
      <directionalLight
        ref={sun}
        color={sunColor}
        intensity={sunIntensity}
        castShadow={day > 0.05}
        shadow-camera-near={1}
        shadow-camera-far={200}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight
        ref={moon}
        color="#9db4ff"
        intensity={moonUp ? 0.35 * (1 - cloud * 0.7) : 0}
      />
      <Lightning active={c.weather.code >= 95} />
    </>
  );
}

/** A grey dome that hides the blue sky when it's overcast or raining. */
function Overcast({ amount, color }: { amount: number; color: THREE.Color }) {
  if (amount < 0.02) return null;
  return (
    <mesh scale={1500} renderOrder={-1}>
      <sphereGeometry args={[1, 24, 12]} />
      <meshBasicMaterial
        color={color}
        side={THREE.BackSide}
        transparent
        opacity={amount}
        depthWrite={false}
        fog={false}
      />
    </mesh>
  );
}

/** The sky, clouds and stars go wherever you go (Kasaragod is wider than the sky dome). */
function FollowCamera({ children }: { children: React.ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ camera }) =>
    group.current?.position.set(camera.position.x, 0, camera.position.z),
  );
  return <group ref={group}>{children}</group>;
}

/** Soft cloud billboards drifting with the wind. */
function Clouds({
  cover,
  day,
  wind,
}: {
  cover: number;
  day: number;
  wind: number;
}) {
  const count = Math.round(cover * 46);
  const texture = useMemo(
    () =>
      canvasTexture(256, 128, (g) => {
        g.clearRect(0, 0, 256, 128);
        for (let i = 0; i < 14; i++) {
          const x = 40 + Math.random() * 176;
          const y = 50 + Math.random() * 40;
          const r = 22 + Math.random() * 34;
          const grad = g.createRadialGradient(x, y, 0, x, y, r);
          grad.addColorStop(0, "rgba(255,255,255,0.9)");
          grad.addColorStop(1, "rgba(255,255,255,0)");
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x, y, r, 0, Math.PI * 2);
          g.fill();
        }
      }),
    [],
  );
  const clouds = useMemo(
    () =>
      Array.from({ length: 46 }, () => {
        const a = Math.random() * Math.PI * 2;
        const d = 220 + Math.random() * 520;
        return {
          x: Math.cos(a) * d,
          z: Math.sin(a) * d,
          y: 140 + Math.random() * 120,
          s: 120 + Math.random() * 160,
        };
      }),
    [],
  );
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (group.current)
      group.current.position.x =
        (group.current.position.x + dt * wind * 0.08) % 400;
  });
  const shade = new THREE.Color("#ffffff").lerp(
    new THREE.Color("#2a3140"),
    1 - day,
  );
  return (
    <group ref={group}>
      {clouds.slice(0, count).map((cl, i) => (
        <sprite
          key={i}
          position={[cl.x, cl.y, cl.z]}
          scale={[cl.s, cl.s * 0.45, 1]}
        >
          <spriteMaterial
            map={texture}
            color={shade}
            transparent
            opacity={0.55 + cover * 0.4}
            depthWrite={false}
            fog={false}
          />
        </sprite>
      ))}
    </group>
  );
}

/** Thunderstorms: the odd flash of lightning. */
function Lightning({ active }: { active: boolean }) {
  const light = useRef<THREE.AmbientLight>(null);
  const next = useRef(0);
  useFrame(({ clock }) => {
    if (!light.current) return;
    const t = clock.elapsedTime;
    if (!active) {
      light.current.intensity = 0;
      return;
    }
    if (t > next.current) next.current = t + 6 + Math.random() * 14;
    const since = next.current - t;
    // two quick flickers right before the next scheduled time
    light.current.intensity =
      since < 0.12 || (since > 0.2 && since < 0.28)
        ? 2.5
        : light.current.intensity * 0.85;
  });
  return <ambientLight ref={light} color="#dfe7ff" intensity={0} />;
}
