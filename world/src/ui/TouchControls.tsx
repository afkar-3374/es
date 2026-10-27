import { useEffect, useRef, useState } from 'react';
import { input } from '../player/input';
import { requestUse, useUiValue } from '../world/interact';
import type { VehicleKind } from '../world/vehicleModels';

/**
 * Phone controls: a joystick on the left to walk, drag anywhere on the right to look.
 * Riding, the joystick gives way to a steering wheel (car) or handlebar, and pedals.
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
  const wheel = useRef<{ id: number; cx: number; cy: number; from: number; at: number } | null>(null);
  const bar = useRef<{ id: number; x: number } | null>(null);
  const [steer, setSteer] = useState(0);
  const [pedal, setPedal] = useState<'gas' | 'brake' | null>(null);
  const pedalTouch = useRef<number | null>(null);
  const car = kind === 'car';
  // how far the wheel turns (degrees) for full lock; a handlebar turns much less
  const LOCK = car ? 150 : 38;

  useEffect(
    () => () => {
      input.joystick.x = 0;
      input.joystick.y = 0;
    },
    []
  );
  const setS = (v: number) => {
    const c = Math.max(-1, Math.min(1, v));
    input.joystick.x = c;
    setSteer(c);
  };
  const press = (p: 'gas' | 'brake' | null) => {
    input.joystick.y = p === 'gas' ? 1 : p === 'brake' ? -1 : 0;
    setPedal(p);
  };

  const onStart = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const el = (t.target as HTMLElement).closest('[data-ctl]') as HTMLElement | null;
      const ctl = el?.dataset.ctl;
      if (ctl === 'wheel' && !wheel.current && !bar.current) {
        const r = el!.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        if (car) wheel.current = { id: t.identifier, cx, cy, from: Math.atan2(t.clientY - cy, t.clientX - cx), at: steer * LOCK };
        else bar.current = { id: t.identifier, x: t.clientX - steer * 70 };
      } else if ((ctl === 'gas' || ctl === 'brake') && pedalTouch.current === null) {
        pedalTouch.current = t.identifier;
        press(ctl);
      } else if (!ctl) look.start(t);
    }
  };
  const onMove = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      const w = wheel.current;
      if (w?.id === t.identifier) {
        // turn the wheel by the angle your thumb has gone round its middle
        const a = Math.atan2(t.clientY - w.cy, t.clientX - w.cx);
        let d = ((a - w.from) * 180) / Math.PI;
        d = ((d + 540) % 360) - 180;
        w.from = a;
        w.at = Math.max(-LOCK, Math.min(LOCK, w.at + d));
        setS(w.at / LOCK);
      } else if (bar.current?.id === t.identifier) {
        setS((t.clientX - bar.current.x) / 70);
      } else if (pedalTouch.current === t.identifier) {
        // slide between the pedals
        const el = document.elementFromPoint(t.clientX, t.clientY)?.closest('[data-ctl]') as HTMLElement | null;
        const ctl = el?.dataset.ctl;
        if (ctl === 'gas' || ctl === 'brake') press(ctl);
      } else look.move(t);
    }
  };
  const onEnd = (e: React.TouchEvent) => {
    for (const t of Array.from(e.changedTouches)) {
      if (wheel.current?.id === t.identifier || bar.current?.id === t.identifier) {
        // let go: it straightens itself
        wheel.current = null;
        bar.current = null;
        setS(0);
      } else if (pedalTouch.current === t.identifier) {
        pedalTouch.current = null;
        press(null);
      } else look.end(t);
    }
  };

  return (
    <div className="touch drive" onTouchStart={onStart} onTouchMove={onMove} onTouchEnd={onEnd} onTouchCancel={onEnd}>
      <div className={`steer ${car ? 'wheel' : 'bar'}${wheel.current || bar.current ? ' held' : ''}`} data-ctl="wheel" aria-label={car ? 'Steering wheel' : 'Handlebar'}>
        <div className="steer-turn" style={{ transform: `rotate(${steer * LOCK}deg)` }}>
          {car ? <SteeringWheel /> : <Handlebar />}
        </div>
      </div>
      <div className="pedals">
        <div className={`pedal brake${pedal === 'brake' ? ' on' : ''}`} data-ctl="brake" aria-label="Brake">
          <span>BRAKE</span>
        </div>
        <div className={`pedal gas${pedal === 'gas' ? ' on' : ''}`} data-ctl="gas" aria-label="Accelerator">
          <span>GO</span>
        </div>
      </div>
    </div>
  );
}

function SteeringWheel() {
  return (
    <svg viewBox="0 0 120 120" aria-hidden="true">
      <defs>
        <radialGradient id="rim" cx="50%" cy="40%" r="60%">
          <stop offset="0" stopColor="#4a4452" />
          <stop offset="1" stopColor="#1d1922" />
        </radialGradient>
      </defs>
      <circle cx="60" cy="60" r="52" fill="none" stroke="url(#rim)" strokeWidth="12" />
      <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="2" />
      {/* three spokes and the hub */}
      <path d="M14 66 L46 62 M106 66 L74 62 M60 74 L60 106" stroke="#2c2733" strokeWidth="10" strokeLinecap="round" />
      <circle cx="60" cy="62" r="17" fill="#2c2733" stroke="#4a4452" strokeWidth="2" />
      <text x="60" y="67" textAnchor="middle" fontSize="13" fontWeight="800" fill="#f472b6" fontFamily="Nunito, sans-serif">
        ES
      </text>
      {/* the top of the wheel, so you can see which way it's turned */}
      <path d="M52 8.5 A52 52 0 0 1 68 8.5" stroke="#f97316" strokeWidth="12" fill="none" />
    </svg>
  );
}

function Handlebar() {
  return (
    <svg viewBox="0 0 160 70" aria-hidden="true">
      {/* the bar, grips, levers and the middle with its little speedo */}
      <path d="M14 34 Q80 22 146 34" stroke="#3a3540" strokeWidth="9" fill="none" strokeLinecap="round" />
      <rect x="4" y="26" width="30" height="16" rx="7" fill="#1d1922" transform="rotate(-6 19 34)" />
      <rect x="126" y="26" width="30" height="16" rx="7" fill="#1d1922" transform="rotate(6 141 34)" />
      <path d="M34 40 L52 48 M126 40 L108 48" stroke="#8d9095" strokeWidth="4" strokeLinecap="round" />
      <circle cx="80" cy="30" r="13" fill="#2c2733" stroke="#4a4452" strokeWidth="2" />
      <path d="M72 33 A9 9 0 0 1 88 33" stroke="#f97316" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="74" y="42" width="12" height="22" rx="4" fill="#3a3540" />
    </svg>
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
