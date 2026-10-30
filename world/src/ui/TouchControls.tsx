import { useEffect, useRef, useState } from 'react';
import { input } from '../player/input';
import { requestUse, useUiValue } from '../world/interact';
import type { VehicleKind } from '../world/vehicleModels';

/**
 * Phone controls: a joystick on the left to walk, drag anywhere on the right to look.
 * Riding, there are just two pedals (brake on the left, go on the right): drag to look,
 * and the vehicle steers that way.
 */
export function TouchControls() {
  const riding = useUiValue((s) => s.riding);
  return riding ? <DriveControls kind={riding.id as VehicleKind} /> : <WalkControls />;
}

/** Drag anywhere that isn't a control to look around (and a quick tap uses what's there). */
function useLook() {
  const look = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t: number } | null>(null);
  return {
    start(t: React.Touch) {
      if (look.current) return false;
      look.current = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() };
      return true;
    },
    move(t: React.Touch) {
      if (look.current?.id !== t.identifier) return false;
      input.lookYaw -= (t.clientX - look.current.x) * 0.0055;
      input.lookPitch -= (t.clientY - look.current.y) * 0.0045;
      look.current.x = t.clientX;
      look.current.y = t.clientY;
      return true;
    },
    end(t: React.Touch) {
      const l = look.current;
      if (l?.id !== t.identifier) return false;
      if (Math.hypot(t.clientX - l.sx, t.clientY - l.sy) < 12 && performance.now() - l.t < 350) {
        requestUse((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
      }
      look.current = null;
      return true;
    },
  };
}

function DriveControls({ kind }: { kind: VehicleKind }) {
  const look = useLook();
  const [pedal, setPedal] = useState<'gas' | 'brake' | null>(null);
  const pedalTouch = useRef<number | null>(null);
  void kind;

  useEffect(
    () => () => {
      input.joystick.x = 0;
      input.joystick.y = 0;
    },
    []
  );
  const press = (p: 'gas' | 'brake' | null) => {
    input.joystick.y = p === 'gas' ? 1 : p === 'brake' ? -1 : 0;
    setPedal(p);
  };

  // drag anywhere to look, and the vehicle turns that way; the pedals go and stop
  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const el = (t.target as HTMLElement).closest('[data-ctl]') as HTMLElement | null;
      const ctl = el?.dataset.ctl;
      if ((ctl === 'gas' || ctl === 'brake') && pedalTouch.current === null) {
        pedalTouch.current = t.identifier;
        press(ctl);
      } else if (!ctl) look.start(t);
    }
  };
  const onMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (pedalTouch.current === t.identifier) {
        // slide between the pedals
        const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-ctl]') as HTMLElement | null;
        const ctl = el?.dataset.ctl;
        if (ctl === 'gas' || ctl === 'brake') press(ctl);
      } else look.move(t);
    }
  };
  const onEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (pedalTouch.current === t.identifier) {
        pedalTouch.current = null;
        press(null);
      } else look.end(t);
    }
  };

  return (
    <div className="touch drive" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <p className="look-hint">Drag to steer</p>
      <div className={`pedal brake${pedal === 'brake' ? ' on' : ''}`} data-ctl="brake" aria-label="Brake">
        <span>BRAKE</span>
      </div>
      <div className={`pedal gas${pedal === 'gas' ? ' on' : ''}`} data-ctl="gas" aria-label="Accelerator">
        <span>GO</span>
      </div>
    </div>
  );
}

function WalkControls() {
  const stick = useRef<{ id: number; x: number; y: number } | null>(null);
  const look = useRef<{ id: number; x: number; y: number; sx: number; sy: number; t: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0, active: false });
  const RANGE = 48;

  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const leftSide = t.clientX < window.innerWidth * 0.45;
      if (leftSide && !stick.current) {
        stick.current = { id: t.identifier, x: t.clientX, y: t.clientY };
        setKnob({ x: 0, y: 0, active: true });
      } else if (!look.current) {
        look.current = { id: t.identifier, x: t.clientX, y: t.clientY, sx: t.clientX, sy: t.clientY, t: performance.now() };
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
      if (look.current?.id === t.identifier) {
        // a quick tap without dragging uses whatever is under the finger
        const l = look.current;
        if (Math.hypot(t.clientX - l.sx, t.clientY - l.sy) < 12 && performance.now() - l.t < 350) {
          requestUse((t.clientX / window.innerWidth) * 2 - 1, -(t.clientY / window.innerHeight) * 2 + 1);
        }
        look.current = null;
      }
    }
  };

  return (
    <div className="touch" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <div className={`stick${knob.active ? ' on' : ''}`}>
        <div className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
      </div>
      <p className="look-hint">Drag to look · tap things</p>
    </div>
  );
}
