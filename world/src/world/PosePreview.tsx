import { useMemo } from 'react';
import { RUN_FRAMES, usePersonSource, walkCycle, WALK_FRAMES } from './people';
import { LOOKS } from '../net/net';

/*
 * Previews only (?debug&poses): every look in a row of walk, run, standing, sitting
 * and riding frames, side-on, at x 0…, z −30, so the poses can be checked by eye.
 */
function Row({ look, z }: { look: string; z: number }) {
  const cycle = walkCycle(usePersonSource(look));
  const items = useMemo(
    () => [
      ...[0, 1, 2, 3, 4, 5].map((i) => cycle.frames[(i * WALK_FRAMES) / 6]),
      ...[0, 1, 2, 3].map((i) => cycle.run[(i * RUN_FRAMES) / 4]),
      cycle.stand,
      cycle.sit,
      cycle.bike,
    ].map((f) => f.clone()),
    [cycle]
  );
  return (
    <group position={[0, 0, z]}>
      {items.map((m, i) => (
        <primitive key={i} object={m} position={[i * 1.1, 0, 0]} rotation-y={Math.PI / 2} />
      ))}
    </group>
  );
}

export function PosePreview() {
  return (
    <group position={[-7, 0.16, 0]}>
      {LOOKS.map((l, i) => (
        <Row key={l} look={l} z={-30 - i * 2.5} />
      ))}
    </group>
  );
}
