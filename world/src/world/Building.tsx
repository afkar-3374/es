import * as THREE from 'three';
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import { CuboidCollider, RigidBody, type RapierRigidBody } from '@react-three/rapier';
import { glassMaterial, usePBR } from './materials';
import { BUILDING, world } from './state';

const FONT = `${import.meta.env.BASE_URL}fonts/Poppins-SemiBold.ttf`;

/*
 * The Electrosparkzz building. Footprint x −12…12, z −20…0, front facing the road (+z).
 *   ground floor (arcade):   floor y = 0.3, ceiling 4.5
 *   sign band:               y 4.6 … 5.9
 *   first floor (library):   floor y = 4.8, windows y 6.2 … 8.4
 *   parapet top:             y ≈ 9.6
 */
const W = BUILDING.maxX - BUILDING.minX; // 24
const D = BUILDING.maxZ - BUILDING.minZ; // 20
const PLINTH = 0.3;
const GF_TOP = 4.5;
const ROOF = 9.0;
const WALL = 0.3;
const DOOR_W = 4; // entrance opening
const DOOR_X = 0;

/** The opening in the first floor where the stairs come up (x0, x1, z0, z1). */
export const STAIRWELL = { x0: -1.1, x1: 1.1, z0: -17.3, z1: -10.0 };
/** The slab around the stairwell, as rectangles [x0, x1, z0, z1]. */
const SLAB_PARTS: [number, number, number, number][] = [
  [BUILDING.minX, STAIRWELL.x0, BUILDING.minZ, BUILDING.maxZ],
  [STAIRWELL.x1, BUILDING.maxX, BUILDING.minZ, BUILDING.maxZ],
  [STAIRWELL.x0, STAIRWELL.x1, STAIRWELL.z1, BUILDING.maxZ],
  [STAIRWELL.x0, STAIRWELL.x1, BUILDING.minZ, STAIRWELL.z0],
];

export function Building() {
  const plaster = usePBR('painted_plaster_wall', [4, 2], { tint: '#f4ede3', normalScale: 0.5 });
  const plasterSide = usePBR('painted_plaster_wall', [7, 3], { tint: '#efe6da', normalScale: 0.5 });
  const terrazzo = usePBR('terrazzo_tiles', [8, 7]);
  const innerWall = usePBR('painted_plaster_wall', [6, 2], { tint: '#f7f3ee', normalScale: 0.35 });
  const concrete = usePBR('concrete', [8, 1]);
  const glass = useMemo(glassMaterial, []);
  const acp = useMemo(() => new THREE.MeshStandardMaterial({ color: '#25212e', roughness: 0.35, metalness: 0.6 }), []);
  const aluminium = useMemo(() => new THREE.MeshStandardMaterial({ color: '#c9ccd1', roughness: 0.3, metalness: 0.85 }), []);
  const ceiling = useMemo(() => new THREE.MeshStandardMaterial({ color: '#f4f2ee', roughness: 0.9 }), []);
  const panelLight = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#fff1dc', emissiveIntensity: 1.2 }), []);
  const signWhite = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ffffff', emissive: '#ffffff', emissiveIntensity: 0, toneMapped: false }), []);
  const signPink = useMemo(() => new THREE.MeshStandardMaterial({ color: '#ff5d8f', emissive: '#ff4f95', emissiveIntensity: 0, toneMapped: false }), []);
  const tank = useMemo(() => new THREE.MeshStandardMaterial({ color: '#151515', roughness: 0.35 }), []);

  const signLight = useRef<THREE.PointLight>(null);
  const lobbyLights = useRef<(THREE.PointLight | null)[]>([]);
  useFrame(() => {
    const n = world.night;
    signWhite.emissiveIntensity = 0.15 + n * 2.2;
    signPink.emissiveIntensity = 0.25 + n * 3;
    if (signLight.current) signLight.current.intensity = n * 14;
    // indoor lights are always on; they read brighter at night
    lobbyLights.current.forEach((l) => l && (l.intensity = 9 + n * 6));
  });

  const front = BUILDING.maxZ;
  const sideX = W / 2;

  return (
    <group>
      {/* Plinth and two front steps up to the entrance */}
      <mesh position={[0, PLINTH / 2, -D / 2]} receiveShadow material={concrete}>
        <boxGeometry args={[W, PLINTH, D]} />
      </mesh>
      <mesh position={[DOOR_X, 0.1, front + 0.9]} receiveShadow castShadow material={concrete}>
        <boxGeometry args={[DOOR_W + 2, 0.2, 1.2]} />
      </mesh>

      {/* Floors and ceilings */}
      <mesh position={[0, PLINTH + 0.01, -D / 2]} rotation-x={-Math.PI / 2} receiveShadow material={terrazzo}>
        <planeGeometry args={[W - WALL * 2, D - WALL * 2]} />
      </mesh>
      {/* first-floor slab, with the stairwell cut out of it */}
      {SLAB_PARTS.map(([x0, x1, z0, z1], i) => (
        <group key={i}>
          <mesh position={[(x0 + x1) / 2, GF_TOP + 0.15, (z0 + z1) / 2]} castShadow receiveShadow material={concrete}>
            <boxGeometry args={[x1 - x0, 0.3, z1 - z0]} />
          </mesh>
          <mesh position={[(x0 + x1) / 2, GF_TOP - 0.01, (z0 + z1) / 2]} rotation-x={Math.PI / 2} material={ceiling}>
            <planeGeometry args={[x1 - x0, z1 - z0]} />
          </mesh>
        </group>
      ))}
      {/* Ceiling light panels in the lobby */}
      {[-6, 0, 6].flatMap((x) =>
        [-4, -11, -17].filter((z) => !(x === 0 && z < STAIRWELL.z1)).map((z) => (
          <mesh key={`${x}${z}`} position={[x, GF_TOP - 0.03, z]} rotation-x={Math.PI / 2} material={panelLight}>
            <planeGeometry args={[1.2, 1.2]} />
          </mesh>
        ))
      )}
      {[-6, 6].map((x, i) => (
        <pointLight key={x} ref={(l) => (lobbyLights.current[i] = l)} position={[x, GF_TOP - 0.5, -8]} color="#fff0dc" distance={20} decay={1.5} />
      ))}

      {/* Back and side walls (outside: plaster; inside: soft grey plaster) */}
      <mesh position={[0, ROOF / 2, BUILDING.minZ + WALL / 2]} castShadow receiveShadow material={plasterSide}>
        <boxGeometry args={[W, ROOF, WALL]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (sideX - WALL / 2), ROOF / 2, -D / 2]} castShadow receiveShadow material={plasterSide}>
          <boxGeometry args={[WALL, ROOF, D]} />
        </mesh>
      ))}
      <mesh position={[0, GF_TOP / 2 + 0.2, BUILDING.minZ + WALL + 0.01]} material={innerWall}>
        <planeGeometry args={[W - WALL * 2, GF_TOP - 0.2]} />
      </mesh>
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * (sideX - WALL - 0.01), GF_TOP / 2 + 0.2, -D / 2]} rotation-y={-s * Math.PI / 2} material={innerWall}>
          <planeGeometry args={[D - WALL * 2, GF_TOP - 0.2]} />
        </mesh>
      ))}

      {/* ── Front facade ── */}
      {/* corner and entrance columns */}
      {[-sideX + 0.35, -DOOR_W / 2 - 0.35, DOOR_W / 2 + 0.35, sideX - 0.35].map((x) => (
        <mesh key={x} position={[x, GF_TOP / 2, front - 0.25]} castShadow receiveShadow material={plaster}>
          <boxGeometry args={[0.7, GF_TOP, 0.5]} />
        </mesh>
      ))}
      {/* shop-front glass either side of the entrance, with aluminium mullions */}
      {[-1, 1].map((s) => {
        const x0 = s * (DOOR_W / 2 + 0.7);
        const x1 = s * (sideX - 0.7);
        const cx = (x0 + x1) / 2;
        const w = Math.abs(x1 - x0);
        return (
          <group key={s}>
            <mesh position={[cx, PLINTH + 1.95, front - 0.3]} material={glass}>
              <boxGeometry args={[w, 3.9, 0.03]} />
            </mesh>
            {Array.from({ length: 4 }, (_, i) => (
              <mesh key={i} position={[x0 + (s * w * (i + 1)) / 5, PLINTH + 1.95, front - 0.28]} castShadow material={aluminium}>
                <boxGeometry args={[0.07, 3.9, 0.1]} />
              </mesh>
            ))}
            <mesh position={[cx, PLINTH + 0.05, front - 0.28]} material={aluminium}>
              <boxGeometry args={[w, 0.1, 0.12]} />
            </mesh>
          </group>
        );
      })}
      {/* glass above the doors */}
      <mesh position={[DOOR_X, PLINTH + 3.4, front - 0.3]} material={glass}>
        <boxGeometry args={[DOOR_W, 1.0, 0.03]} />
      </mesh>
      <mesh position={[DOOR_X, PLINTH + 2.85, front - 0.28]} material={aluminium}>
        <boxGeometry args={[DOOR_W, 0.1, 0.14]} />
      </mesh>
      <SlidingDoors glass={glass} frame={aluminium} />

      {/* entrance canopy with down-lights */}
      <mesh position={[DOOR_X, GF_TOP - 0.55, front + 1.1]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[DOOR_W + 3, 0.22, 2.2]} />
      </mesh>
      {[-2, 0, 2].map((x) => (
        <mesh key={x} position={[x, GF_TOP - 0.67, front + 1.3]} rotation-x={Math.PI / 2} material={panelLight}>
          <circleGeometry args={[0.12, 16]} />
        </mesh>
      ))}

      {/* sign band with the name */}
      <mesh position={[0, 5.25, front + 0.05]} castShadow material={acp}>
        <boxGeometry args={[W + 0.2, 1.35, 0.2]} />
      </mesh>
      <group position={[0, 5.22, front + 0.17]}>
        <Text font={FONT} fontSize={0.78} letterSpacing={0.14} anchorX="right" anchorY="middle" position={[0.15, 0, 0]} material={signWhite}>
          ELECTRO
        </Text>
        <Text font={FONT} fontSize={0.78} letterSpacing={0.14} anchorX="left" anchorY="middle" position={[0.25, 0, 0]} material={signPink}>
          SPARKZZ
        </Text>
      </group>
      {/* lights the sign from just below the library floor, so it can't leak onto the floor inside */}
      <pointLight ref={signLight} position={[0, 4.3, front + 1.7]} color="#ff7ab0" distance={6} decay={2} intensity={0} />

      {/* first floor: plaster with a long window band (the library) */}
      <mesh position={[0, 6.0, front - 0.15]} castShadow receiveShadow material={plaster}>
        <boxGeometry args={[W, 0.4, 0.3]} />
      </mesh>
      <mesh position={[0, 8.7, front - 0.15]} castShadow receiveShadow material={plaster}>
        <boxGeometry args={[W, 0.6, 0.3]} />
      </mesh>
      {[-sideX + 0.4, sideX - 0.4].map((x) => (
        <mesh key={x} position={[x, 7.3, front - 0.15]} castShadow material={plaster}>
          <boxGeometry args={[0.8, 2.6, 0.3]} />
        </mesh>
      ))}
      <mesh position={[0, 7.3, front - 0.32]} material={glass}>
        <boxGeometry args={[W - 1.6, 2.2, 0.03]} />
      </mesh>
      {Array.from({ length: 11 }, (_, i) => (
        <mesh key={i} position={[-sideX + 0.8 + ((W - 1.6) / 10) * i, 7.3, front - 0.3]} castShadow material={aluminium}>
          <boxGeometry args={[0.07, 2.2, 0.1]} />
        </mesh>
      ))}
      {/* concrete sunshade over the window band */}
      <mesh position={[0, 8.48, front + 0.35]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[W + 0.2, 0.1, 0.9]} />
      </mesh>

      {/* parapet, coping and the black water tank */}
      <mesh position={[0, ROOF + 0.45, front - 0.15]} castShadow material={plaster}>
        <boxGeometry args={[W, 0.9, 0.3]} />
      </mesh>
      <mesh position={[0, ROOF + 0.92, front - 0.1]} material={concrete}>
        <boxGeometry args={[W + 0.2, 0.08, 0.4]} />
      </mesh>
      <mesh position={[0, ROOF - 0.15, -D / 2]} castShadow receiveShadow material={concrete}>
        <boxGeometry args={[W, 0.3, D]} />
      </mesh>
      <mesh position={[8, ROOF + 0.8, -16]} castShadow material={tank}>
        <cylinderGeometry args={[0.8, 0.8, 1.6, 24]} />
      </mesh>

      {/* Walls you can't walk through (the entrance stays open; the doors have their own) */}
      <RigidBody type="fixed" colliders={false}>
        <CuboidCollider args={[W / 2, ROOF / 2, WALL / 2]} position={[0, ROOF / 2, BUILDING.minZ + WALL / 2]} />
        <CuboidCollider args={[WALL / 2, ROOF / 2, D / 2]} position={[-sideX + WALL / 2, ROOF / 2, -D / 2]} />
        <CuboidCollider args={[WALL / 2, ROOF / 2, D / 2]} position={[sideX - WALL / 2, ROOF / 2, -D / 2]} />
        {[-1, 1].map((s) => {
          const x0 = s * (DOOR_W / 2);
          const x1 = s * sideX;
          return <CuboidCollider key={s} args={[Math.abs(x1 - x0) / 2, ROOF / 2, 0.3]} position={[(x0 + x1) / 2, ROOF / 2, front - 0.3]} />;
        })}
        {/* floor of the plinth and the entrance step */}
        <CuboidCollider args={[W / 2, PLINTH / 2, D / 2]} position={[0, PLINTH / 2, -D / 2]} />
        <CuboidCollider args={[DOOR_W / 2 + 1, 0.1, 0.6]} position={[DOOR_X, 0.1, front + 0.9]} />
        {/* ceiling of the ground floor */}
        {SLAB_PARTS.map(([x0, x1, z0, z1], i) => (
          <CuboidCollider key={i} args={[(x1 - x0) / 2, 0.15, (z1 - z0) / 2]} position={[(x0 + x1) / 2, GF_TOP + 0.15, (z0 + z1) / 2]} />
        ))}
      </RigidBody>
    </group>
  );
}

/** Two glass doors that slide apart as you walk up to them. */
function SlidingDoors({ glass, frame }: { glass: THREE.Material; frame: THREE.Material }) {
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const leftBody = useRef<RapierRigidBody>(null);
  const rightBody = useRef<RapierRigidBody>(null);
  const open = useRef(0);
  const z = BUILDING.maxZ - 0.3;
  const panelW = DOOR_W / 2;

  useFrame((_, dt) => {
    const p = world.player;
    const near = Math.abs(p.x - DOOR_X) < 3.2 && Math.abs(p.z - z) < 3.4;
    open.current += ((near ? 1 : 0) - open.current) * Math.min(dt * 3.5, 1);
    const slide = open.current * (panelW - 0.15);
    const lx = DOOR_X - panelW / 2 - slide;
    const rx = DOOR_X + panelW / 2 + slide;
    left.current?.position.setX(lx);
    right.current?.position.setX(rx);
    leftBody.current?.setNextKinematicTranslation({ x: lx, y: PLINTH + 1.4, z });
    rightBody.current?.setNextKinematicTranslation({ x: rx, y: PLINTH + 1.4, z });
  });

  const panel = (
    <>
      <mesh material={glass}>
        <boxGeometry args={[panelW - 0.05, 2.75, 0.04]} />
      </mesh>
      <mesh position={[0, 1.36, 0]} material={frame}>
        <boxGeometry args={[panelW - 0.05, 0.06, 0.07]} />
      </mesh>
      <mesh position={[0, -1.36, 0]} material={frame}>
        <boxGeometry args={[panelW - 0.05, 0.06, 0.07]} />
      </mesh>
      <mesh position={[0, 0, 0.06]} material={frame}>
        <boxGeometry args={[0.03, 0.9, 0.03]} />
      </mesh>
    </>
  );

  return (
    <>
      <group ref={left} position={[DOOR_X - panelW / 2, PLINTH + 1.4, z]}>
        {panel}
      </group>
      <group ref={right} position={[DOOR_X + panelW / 2, PLINTH + 1.4, z]}>
        {panel}
      </group>
      <RigidBody ref={leftBody} type="kinematicPosition" colliders={false} position={[DOOR_X - panelW / 2, PLINTH + 1.4, z]}>
        <CuboidCollider args={[panelW / 2, 1.4, 0.05]} />
      </RigidBody>
      <RigidBody ref={rightBody} type="kinematicPosition" colliders={false} position={[DOOR_X + panelW / 2, PLINTH + 1.4, z]}>
        <CuboidCollider args={[panelW / 2, 1.4, 0.05]} />
      </RigidBody>
    </>
  );
}
