// Downloads OpenStreetMap data for all of Kasaragod district (roads, buildings, water,
// coastline, railway, place names) from Overpass, in ~11 km squares, into a cache folder.
//   node tools/fetch-osm.mjs <cache-dir>
// Squares already downloaded are skipped, so it can be re-run after a failure.
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2];
if (!OUT) throw new Error('usage: node tools/fetch-osm.mjs <cache-dir>');
mkdirSync(OUT, { recursive: true });

// Kasaragod district (OSM relation 2018248), with a little margin
const BBOX = { s: 12.04, w: 74.86, n: 12.8, e: 75.44 };
const STEP = 0.1;
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const UA = 'electrosparkzz-town-map-builder/1.0';

const query = (s, w, n, e) => `[out:json][timeout:240][bbox:${s},${w},${n},${e}];
(
  way["highway"];
  way["building"];
  rel["building"];
  way["natural"="water"];
  rel["natural"="water"];
  way["waterway"~"^(riverbank|river|stream|canal)$"];
  rel["waterway"="riverbank"];
  way["landuse"="reservoir"];
  way["natural"="coastline"];
  way["railway"="rail"];
  node["place"~"^(city|town|village|suburb|hamlet)$"];
);
out geom;`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(q) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const url = SERVERS[attempt % SERVERS.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
      const text = await res.text();
      if (res.ok && text.startsWith('{') && !text.includes('"remark": "runtime error')) return text;
      console.warn(`  ${url} → ${res.status} ${text.slice(0, 120).replace(/\s+/g, ' ')}`);
    } catch (e) {
      console.warn(`  ${url} → ${e.message}`);
    }
    await sleep(Math.min(5000 * (attempt + 1), 60000));
  }
  throw new Error('Overpass kept failing');
}

// the district's outline, to keep only what's in Kasaragod
const outline = join(OUT, 'district.json');
if (!existsSync(outline)) writeFileSync(outline, await get('[out:json][timeout:120];rel(2018248);out geom;'));

// nearest the building first, so the town can be built and tried before the rest arrives
const SITE = { lat: 12.4996, lon: 74.9869 };
const jobs = [];
for (let s = BBOX.s; s < BBOX.n - 1e-9; s += STEP) for (let w = BBOX.w; w < BBOX.e - 1e-9; w += STEP) jobs.push([s, w]);
const far = ([s, w]) => Math.hypot(s + STEP / 2 - SITE.lat, w + STEP / 2 - SITE.lon);
jobs.sort((a, b) => far(a) - far(b));
let done = 0;
for (const [s, w] of jobs) {
  const n = Math.min(s + STEP, BBOX.n);
  const e = Math.min(w + STEP, BBOX.e);
  const file = join(OUT, `${s.toFixed(2)}_${w.toFixed(2)}.json`);
  done++;
  if (existsSync(file)) continue;
  console.log(`[${done}/${jobs.length}] ${s.toFixed(2)},${w.toFixed(2)}`);
  writeFileSync(file, await get(query(s.toFixed(4), w.toFixed(4), n.toFixed(4), e.toFixed(4))));
  await sleep(1500);
}
console.log('done');
