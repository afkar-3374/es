import { useEffect, useRef, useState } from 'react';
import { BEACH, BOUNDS, PLACES, ROADS } from '../world/layout';
import { BUILDING, world } from '../world/state';
import { me, peers } from '../net/net';
import { typing } from '../player/input';

/** A colour for each visitor, the same on everyone's map. */
export function peerColor(id: string) {
  const hues = [330, 200, 160, 35, 270, 10, 95, 220];
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return `hsl(${hues[h % hues.length]} 75% 50%)`;
}

/**
 * The town map: a small one in the corner that follows you (north is up), and the
 * whole town when you open it (M). Dots are the other people in town.
 */
export function Minimap() {
  const small = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'KeyM') setOpen((o) => !o);
      if (e.code === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 120) return;
      last = t;
      if (small.current) draw(small.current, 'follow');
      if (open && big.current) draw(big.current, 'all');
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  return (
    <>
      <button type="button" className="minimap" onClick={() => setOpen(true)} aria-label="Open the town map (M)" title="Town map (M)">
        <canvas ref={small} width={300} height={300} />
      </button>
      {open && (
        <div className="map-wrap" onClick={() => setOpen(false)}>
          <div className="map-card" onClick={(e) => e.stopPropagation()}>
            <canvas ref={big} width={1000} height={860} />
            <div className="map-legend">
              <span>
                <i className="dot you" /> You
              </span>
              <span>
                <i className="dot them" /> People in town
              </span>
              <span>
                <i className="dot es" /> Electrosparkzz
              </span>
              <button type="button" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function draw(canvas: HTMLCanvasElement, mode: 'follow' | 'all') {
  const g = canvas.getContext('2d')!;
  const W = canvas.width;
  const H = canvas.height;
  const p = world.player;
  // world → canvas
  const view =
    mode === 'follow'
      ? { cx: p.x, cz: p.z, scale: W / 220 }
      : { cx: (BOUNDS.minX - 20 + BOUNDS.maxX) / 2, cz: (BOUNDS.minZ + BOUNDS.maxZ) / 2, scale: Math.min(W / (BOUNDS.maxX - BOUNDS.minX + 40), H / (BOUNDS.maxZ - BOUNDS.minZ + 20)) };
  const X = (x: number) => W / 2 + (x - view.cx) * view.scale;
  const Z = (z: number) => H / 2 + (z - view.cz) * view.scale;
  const rect = (x0: number, z0: number, x1: number, z1: number, fill: string) => {
    g.fillStyle = fill;
    g.fillRect(X(x0), Z(z0), (x1 - x0) * view.scale, (z1 - z0) * view.scale);
  };

  g.fillStyle = '#e3eccf';
  g.fillRect(0, 0, W, H);
  rect(-2000, -2000, BEACH.waterline, 2000, '#86c9d6');
  rect(BEACH.waterline, -2000, BEACH.sandTop, 2000, '#f3e2b5');
  rect(PLACES.ground.x0, PLACES.ground.z0, PLACES.ground.x1, PLACES.ground.z1, '#a9d58e');
  rect(PLACES.market.x0, PLACES.market.z0, PLACES.market.x1, PLACES.market.z1, '#f7cf9a');
  for (const r of ROADS) {
    const [x0, x1, z0, z1] = r.axis === 'x' ? [r.from, r.to, r.c - r.w / 2, r.c + r.w / 2] : [r.c - r.w / 2, r.c + r.w / 2, r.from, r.to];
    rect(x0 - 1.5, z0 - 1.5, x1 + 1.5, z1 + 1.5, '#cbbfa6');
  }
  for (const r of ROADS) {
    const [x0, x1, z0, z1] = r.axis === 'x' ? [r.from, r.to, r.c - r.w / 2, r.c + r.w / 2] : [r.c - r.w / 2, r.c + r.w / 2, r.from, r.to];
    rect(x0, z0, x1, z1, '#fffdf8');
  }
  rect(BUILDING.minX, BUILDING.minZ, BUILDING.maxX, BUILDING.maxZ, '#f472b6');

  // labels on the big map
  if (mode === 'all') {
    g.font = '600 22px Nunito, sans-serif';
    g.textAlign = 'center';
    g.fillStyle = '#5b4f66';
    for (const r of ROADS) {
      const mid = r.id === 'main' ? 60 : r.axis === 'x' ? (r.from + r.to) / 2 + 50 : (r.from + r.to) / 2 + 60;
      g.save();
      g.translate(r.axis === 'x' ? X(mid) : X(r.c), r.axis === 'x' ? Z(r.c) + 7 : Z(mid));
      if (r.axis === 'z') g.rotate(-Math.PI / 2);
      g.fillText(r.name, 0, r.axis === 'z' ? 7 : 0);
      g.restore();
    }
    g.fillStyle = '#2f7f95';
    g.fillText('Arabian Sea', X(-275), Z(-150));
    g.fillStyle = '#4a7a3a';
    g.fillText(PLACES.ground.name, X((PLACES.ground.x0 + PLACES.ground.x1) / 2), Z((PLACES.ground.z0 + PLACES.ground.z1) / 2) + 7);
    g.fillStyle = '#9a5a1a';
    g.fillText(PLACES.market.name, X((PLACES.market.x0 + PLACES.market.x1) / 2), Z((PLACES.market.z0 + PLACES.market.z1) / 2) + 7);
    g.fillStyle = '#be3c86';
    g.fillText('Electrosparkzz', X(0), Z(BUILDING.minZ) - 8);
    g.fillStyle = '#a0763a';
    g.fillText('Beach', X(-238), Z(30));
  }

  // other people
  const dot = mode === 'follow' ? 7 : 8;
  for (const peer of peers.values()) {
    const x = peer.mode === 2 && peer.vehicle ? peer.vehicle.x : peer.x;
    const z = peer.mode === 2 && peer.vehicle ? peer.vehicle.z : peer.z;
    g.beginPath();
    g.arc(X(x), Z(z), dot, 0, Math.PI * 2);
    g.fillStyle = peerColor(peer.id);
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = '#fff';
    g.stroke();
    if (mode === 'all') {
      g.font = '700 20px Nunito, sans-serif';
      g.fillStyle = '#2b2238';
      g.fillText(peer.name, X(x), Z(z) - 14);
    }
  }
  // your own vehicle, parked
  const v = world.vehicle;
  if (v && !v.ridden) {
    g.fillStyle = '#2b2238';
    g.font = `${mode === 'follow' ? 22 : 24}px sans-serif`;
    g.textAlign = 'center';
    g.fillText({ scooter: '🛵', auto: '🛺', car: '🚗', cycle: '🚲' }[v.kind], X(v.x), Z(v.z) + 8);
  }

  // you: an arrow pointing where you look
  g.save();
  g.translate(X(p.x), Z(p.z));
  g.rotate(-world.heading);
  g.beginPath();
  g.moveTo(0, -14);
  g.lineTo(9, 9);
  g.lineTo(0, 4);
  g.lineTo(-9, 9);
  g.closePath();
  g.fillStyle = '#ec4899';
  g.fill();
  g.lineWidth = 3;
  g.strokeStyle = '#fff';
  g.stroke();
  g.restore();
  if (mode === 'all') {
    g.font = '800 20px Nunito, sans-serif';
    g.fillStyle = '#be185d';
    g.textAlign = 'center';
    g.fillText(me.name || 'You', X(p.x), Z(p.z) - 20);
  }
}
