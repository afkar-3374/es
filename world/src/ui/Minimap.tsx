import { useEffect, useRef, useState } from 'react';
import { BUILDING, world } from '../world/state';
import { getMeta, loadedTile, loadMeta, RAIL, waterRects, type Tile } from '../world/map';
import { me, peers } from '../net/net';
import { typing } from '../player/input';

/** A colour for each visitor, the same on everyone's map. */
export function peerColor(id: string) {
  const hues = [330, 200, 160, 35, 270, 10, 95, 220];
  const h = [...id].reduce((a, c) => a + c.charCodeAt(0), 0);
  return `hsl(${hues[h % hues.length]} 75% 50%)`;
}

/** The street, building and shops modelled by hand (the map leaves this bit clear). */
const SITE = { x0: -60, x1: 60, z0: -16, z1: 34 };

/**
 * The map: a small one in the corner that follows you, and the whole of Kasaragod
 * district when you open it (M): drag to move around, scroll or +/− to zoom.
 * Dots are the other people in town.
 */
export function Minimap() {
  const small = useRef<HTMLCanvasElement>(null);
  const big = useRef<HTMLCanvasElement>(null);
  const [open, setOpen] = useState(false);
  // the big map's view: centre and pixels per metre
  const view = useRef({ cx: 0, cz: 0, scale: 0.12 });

  useEffect(() => {
    loadMeta();
    const onKey = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.code === 'KeyM') setOpen((o) => !o);
      if (e.code === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) view.current = { cx: world.player.x, cz: world.player.z, scale: 0.12 };
  }, [open]);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 120) return;
      last = t;
      if (small.current) draw(small.current, { cx: world.player.x, cz: world.player.z, scale: small.current.width / 260 }, false);
      if (open && big.current) draw(big.current, view.current, true);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  // drag to move, wheel / pinch to zoom
  useEffect(() => {
    const canvas = big.current;
    if (!open || !canvas) return;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const zoom = (k: number) => (view.current.scale = Math.min(4, Math.max(0.006, view.current.scale * k)));
    const down = (e: PointerEvent) => {
      canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size === 1) {
        view.current.cx -= (e.clientX - p.x) / view.current.scale;
        view.current.cz -= (e.clientY - p.y) / view.current.scale;
      }
      p.x = e.clientX;
      p.y = e.clientY;
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) zoom(d / pinch);
        pinch = d;
      }
    };
    const up = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.0015));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    };
  }, [open]);

  const zoomBy = (k: number) => (view.current.scale = Math.min(4, Math.max(0.006, view.current.scale * k)));

  return (
    <>
      <button type="button" className="minimap" onClick={() => setOpen(true)} aria-label="Open the map (M)" title="Map (M)">
        <canvas ref={small} width={300} height={300} />
      </button>
      {open && (
        <div className="map-wrap" onClick={() => setOpen(false)}>
          <div className="map-card" onClick={(e) => e.stopPropagation()}>
            <div className="map-view">
              <canvas ref={big} width={1000} height={860} />
            </div>
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
              <span className="map-zoom">
                <button type="button" onClick={() => zoomBy(1.6)} aria-label="Zoom in">
                  +
                </button>
                <button type="button" onClick={() => zoomBy(1 / 1.6)} aria-label="Zoom out">
                  −
                </button>
                <button type="button" onClick={() => (view.current = { ...view.current, cx: world.player.x, cz: world.player.z })}>
                  Me
                </button>
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

/* ── Tile drawings, made once per tile (in world metres) ─────────── */

interface TilePaths {
  water: Path2D;
  roads: { width: number; path: Path2D; cls: number }[];
  buildings: Path2D;
}
const paths = new WeakMap<Tile, TilePaths>();

function tilePaths(t: Tile): TilePaths {
  const cached = paths.get(t);
  if (cached) return cached;
  const meta = getMeta()!;
  const ox = t.i * meta.tile;
  const oz = t.j * meta.tile;
  const water = new Path2D();
  for (const [a, b, e, f] of waterRects(t)) water.rect(ox + a * meta.cell, oz + b * meta.cell, (e - a) * meta.cell, (f - b) * meta.cell);
  const byWidth = new Map<string, { width: number; path: Path2D; cls: number }>();
  for (const r of t.data.b) {
    const key = `${r[0]}_${r[1]}`;
    if (!byWidth.has(key)) byWidth.set(key, { width: r[1], path: new Path2D(), cls: r[0] });
    const p = byWidth.get(key)!.path;
    p.moveTo(ox + r[3] / 10, oz + r[4] / 10);
    for (let k = 5; k + 1 < r.length; k += 2) p.lineTo(ox + r[k] / 10, oz + r[k + 1] / 10);
  }
  const buildings = new Path2D();
  for (const b of t.data.h) {
    buildings.moveTo(ox + b[2] / 10, oz + b[3] / 10);
    for (let k = 4; k + 1 < b.length; k += 2) buildings.lineTo(ox + b[k] / 10, oz + b[k + 1] / 10);
    buildings.closePath();
  }
  const out = { water, roads: [...byWidth.values()].sort((a, b) => b.cls - a.cls), buildings };
  paths.set(t, out);
  return out;
}

let overview: HTMLImageElement | null = null;
function overviewImage() {
  if (!overview) {
    overview = new Image();
    overview.src = `${import.meta.env.BASE_URL}map/overview.png`;
  }
  return overview.complete && overview.naturalWidth ? overview : null;
}

const ROAD_COLOUR = ['#f2a65a', '#f6c46a', '#fbe08a', '#fffdf8', '#fffdf8', '#fbf8f2', '#e2c9a6', '#e6ddcf', '#9a8f99'];

/** `view.scale` is in screen (CSS) pixels per metre for the big map, canvas pixels for the small one. */
function draw(canvas: HTMLCanvasElement, view: { cx: number; cz: number; scale: number }, full: boolean) {
  const g = canvas.getContext('2d')!;
  // the big map matches its size on screen, sharp at any pixel density; sizes below are screen pixels
  const base = full ? window.devicePixelRatio || 1 : 1;
  if (full) {
    const w = Math.round(canvas.clientWidth * base);
    const h = Math.round(canvas.clientHeight * base);
    if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
      canvas.width = w;
      canvas.height = h;
    }
  }
  const W = canvas.width / base;
  const H = canvas.height / base;
  const { cx, cz, scale } = view;
  const X = (x: number) => W / 2 + (x - cx) * scale;
  const Z = (z: number) => H / 2 + (z - cz) * scale;
  const meta = getMeta();

  g.setTransform(base, 0, 0, base, 0, 0);
  g.fillStyle = '#d9e4c4';
  g.fillRect(0, 0, W, H);

  // world metres → pixels
  g.setTransform(scale * base, 0, 0, scale * base, base * (W / 2 - cx * scale), base * (H / 2 - cz * scale));
  const img = meta && overviewImage();
  if (img && meta) {
    g.drawImage(img, meta.overview.x0, meta.overview.z0, meta.overview.w * meta.overview.mpp, meta.overview.h * meta.overview.mpp);
  }
  // close up, the tiles that have loaded (around you) in full detail
  if (meta && scale > 0.25) {
    const x0 = cx - W / 2 / scale;
    const x1 = cx + W / 2 / scale;
    const z0 = cz - H / 2 / scale;
    const z1 = cz + H / 2 / scale;
    const tiles: Tile[] = [];
    for (let i = Math.floor(x0 / meta.tile); i <= Math.floor(x1 / meta.tile); i++)
      for (let j = Math.floor(z0 / meta.tile); j <= Math.floor(z1 / meta.tile); j++) {
        const t = loadedTile(`${i}_${j}`);
        if (t) tiles.push(t);
      }
    for (const t of tiles) {
      // land first, so the low-detail picture underneath doesn't show through
      g.fillStyle = '#e3eccf';
      g.fillRect(t.i * meta.tile, t.j * meta.tile, meta.tile, meta.tile);
      g.fillStyle = '#86c9d6';
      g.fill(tilePaths(t).water);
    }
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const t of tiles)
      for (const r of tilePaths(t).roads) {
        g.strokeStyle = ROAD_COLOUR[r.cls] ?? '#fff';
        g.lineWidth = r.cls === RAIL ? Math.max(1.5, 1.5 / scale) : Math.max(r.width, 1.2 / scale);
        g.stroke(r.path);
      }
    g.fillStyle = '#c9bfae';
    for (const t of tiles) g.fill(tilePaths(t).buildings);
  }
  // the hand-made street and its shops
  if (scale > 0.25) {
    g.fillStyle = '#c9bfae';
    g.fillRect(SITE.x0 + 2, SITE.z0, SITE.x1 - SITE.x0 - 4, 16);
    g.fillRect(SITE.x0 + 2, 18, SITE.x1 - SITE.x0 - 4, SITE.z1 - 18);
    g.fillStyle = '#fffdf8';
    g.fillRect(SITE.x0, 5, SITE.x1 - SITE.x0, 10);
  }
  g.fillStyle = '#f472b6';
  const minEs = 5 / scale;
  const esW = Math.max(BUILDING.maxX - BUILDING.minX, minEs);
  const esD = Math.max(BUILDING.maxZ - BUILDING.minZ, minEs);
  g.fillRect((BUILDING.minX + BUILDING.maxX) / 2 - esW / 2, (BUILDING.minZ + BUILDING.maxZ) / 2 - esD / 2, esW, esD);
  g.setTransform(base, 0, 0, base, 0, 0);

  // labels already on the map, so new ones can keep clear of them
  const taken: [number, number, number, number][] = [];
  const free = (x: number, y: number, w: number, h: number) => !taken.some(([a, b, c, d]) => x - w / 2 < c && x + w / 2 > a && y - h < d && y > b);
  const take = (x: number, y: number, w: number, h: number) => taken.push([x - w / 2, y - h, x + w / 2, y]);

  // your own name goes under your arrow: keep that spot clear
  if (full) {
    g.font = '800 20px Nunito, sans-serif';
    take(X(world.player.x), Z(world.player.z) + 37, g.measureText(me.name || 'You').width + 8, 24);
  }

  // place names on the big map (towns always, villages closer in); bigger places first, none on top of another
  if (full && meta) {
    g.textAlign = 'center';
    const rankOf = (k: string) => (k === 'city' || k === 'town' ? 0 : k === 'suburb' || k === 'village' ? 1 : 2);
    for (const p of [...meta.places].sort((a, b) => rankOf(a.k) - rankOf(b.k))) {
      const rank = rankOf(p.k);
      if ((rank === 1 && scale < 0.03) || (rank === 2 && scale < 0.15)) continue;
      const x = X(p.x);
      const y = Z(p.z);
      if (x < -60 || x > W + 60 || y < -20 || y > H + 20) continue;
      g.font = rank === 0 ? '800 22px Nunito, sans-serif' : rank === 1 ? '700 17px Nunito, sans-serif' : '600 14px Nunito, sans-serif';
      const tw = g.measureText(p.n).width + 8;
      const th = rank === 0 ? 24 : rank === 1 ? 19 : 16;
      if (!free(x, y + 4, tw, th)) continue;
      take(x, y + 4, tw, th);
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(255, 253, 248, 0.85)';
      g.strokeText(p.n, x, y);
      g.fillStyle = rank === 0 ? '#3b2f4a' : '#5b4f66';
      g.fillText(p.n, x, y);
    }
    // (zoomed out, the pink square under you says it; the name would sit on yours)
    if (scale > 0.3 || Math.hypot(world.player.x, world.player.z) * scale > 60) {
      g.font = '800 20px Nunito, sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(255, 253, 248, 0.9)';
      g.strokeText('Electrosparkzz', X(0), Z(BUILDING.minZ) - 12);
      g.fillStyle = '#be3c86';
      g.fillText('Electrosparkzz', X(0), Z(BUILDING.minZ) - 12);
    }
  }

  // other people
  const dot = full ? 8 : 7;
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
    if (full) {
      // people standing together: stack their names instead of printing one over another
      g.font = '700 18px Nunito, sans-serif';
      g.textAlign = 'center';
      const tw = g.measureText(peer.name).width + 6;
      let y = Z(z) - 14;
      for (let k = 0; k < 6 && !free(X(x), y + 3, tw, 20); k++) y -= 20;
      take(X(x), y + 3, tw, 20);
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(255, 253, 248, 0.85)';
      g.strokeText(peer.name, X(x), y);
      g.fillStyle = '#2b2238';
      g.fillText(peer.name, X(x), y);
    }
  }
  // your own vehicle, parked
  const v = world.vehicle;
  if (v && !v.ridden) {
    g.fillStyle = '#2b2238';
    g.font = `${full ? 24 : 22}px sans-serif`;
    g.textAlign = 'center';
    g.fillText({ bike: '🏍️', auto: '🛺', car: '🚗', cycle: '🚲' }[v.kind], X(v.x), Z(v.z) + 8);
  }

  // you: an arrow pointing where you look
  const p = world.player;
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
  if (full) {
    g.font = '800 20px Nunito, sans-serif';
    g.fillStyle = '#be185d';
    g.textAlign = 'center';
    g.fillText(me.name || 'You', X(p.x), Z(p.z) + 34);
  }

  // which way is north
  if (meta) {
    const r = full ? 26 : 22;
    const ox = full ? W - 46 : W / 2 + Math.SQRT1_2 * (W / 2 - 34);
    const oy = full ? 46 : H / 2 - Math.SQRT1_2 * (H / 2 - 34);
    const [nx, nz] = meta.north;
    g.save();
    g.translate(ox, oy);
    g.beginPath();
    g.arc(0, 0, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255, 253, 248, 0.9)';
    g.fill();
    // a red pointer on the rim, N in the middle
    g.rotate(Math.atan2(nx, -nz));
    g.beginPath();
    g.moveTo(0, -r + 3);
    g.lineTo(7, -r + 14);
    g.lineTo(-7, -r + 14);
    g.closePath();
    g.fillStyle = '#d6455d';
    g.fill();
    g.rotate(-Math.atan2(nx, -nz));
    g.font = `800 ${full ? 15 : 13}px Nunito, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#2b2238';
    g.fillText('N', 0, 1);
    g.textBaseline = 'alphabetic';
    g.restore();
  }
}
