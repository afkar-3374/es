import { useRef, useState } from 'react';
import { input } from '../player/input';

/**
 * Phone controls: a joystick on the left to walk, drag anywhere on the right to look.
 */
export function TouchControls() {
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const RANGE = 48;

  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const leftSide = t.clientX < window.innerWidth * 0.45;
      if (leftSide && !stick.current) {
        stick.current = { id: t.identifier, x: t.clientX, y: t.clientY };
        setKnob({ x: 0, y: 0, active: true });
      } else if (!look.current) {
        look.current = { id: t.identifier, x: t.clientX, y: t.clientY };
      }
    }
  };
  const onMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (stick.current?.id === t.identifier) {
        let dx = t.clientX - stick.current.x;
        let dy = t.clientY - stick.current.y;
        const d = Math.hypot(dx, dy);
        if (d > RANGE) {
          dx = (dx / d) * RANGE;
          dy = (dy / d) * RANGE;
        }
        input.joystick.x = dx / RANGE;
        input.joystick.y = -dy / RANGE;
        setKnob({ x: dx, y: dy, active: true });
      } else if (look.current?.id === t.identifier) {
        input.lookYaw -= (t.clientX - look.current.x) * 0.0055;
        input.lookPitch -= (t.clientY - look.current.y) * 0.0045;
        look.current.x = t.clientX;
        look.current.y = t.clientY;
      }
    }
  };
  const onEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (stick.current?.id === t.identifier) {
        stick.current = null;
        input.joystick.x = 0;
        input.joystick.y = 0;
        setKnob({ x: 0, y: 0, active: false });
      }
      if (look.current?.id === t.identifier) look.current = null;
    }
  };

  return (
    <div className="touch" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <div className={`stick${knob.active ? ' on' : ''}`}>
        <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <p className="look-hint">Drag here to look around</p>
    </div>
  );
}
