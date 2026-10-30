// Pulls Kasaragod's buildings out of a Google Open Buildings v3 file (CC BY-4.0 / ODbL:
// https://sites.research.google/open-buildings/), streaming it, so the 4.8 GB download
// never has to fit in memory. Keeps buildings the model is fairly sure of.
//   node tools/extract-buildings.mjs <3bb_buildings.csv.gz> <cache-dir>/footprints/kasaragod.csv.gz
// Output: the same CSV (latitude, longitude, area_in_meters, confidence, geometry, full_plus_code).
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createGunzip, createGzip } from 'node:zlib';
import { createInterface } from 'node:readline';

const [src, out] = process.argv.slice(2);
if (!src || !out) throw new Error('usage: node tools/extract-buildings.mjs <buildings.csv.gz> <out.csv.gz>');

// Kasaragod district with a little margin (the map builder trims to the district itself)
const BBOX = { s: 12.02, w: 74.84, n: 12.82, e: 75.46 };
const MIN_CONFIDENCE = 0.72;

mkdirSync(dirname(out), { recursive: true });
const gz = createGzip();
gz.pipe(createWriteStream(out));
const lines = createInterface({ input: createReadStream(src).pipe(createGunzip()), crlfDelay: Infinity });
let seen = 0;
let kept = 0;
let header = true;
for await (const line of lines) {
  if (header) {
    gz.write(line + '\n');
    header = false;
    continue;
  }
  if (++seen % 5e6 === 0) console.log(`${(seen / 1e6).toFixed(0)} M read, ${kept} kept`);
  // latitude and longitude come first, so most lines are dropped without parsing the rest
  const c1 = line.indexOf(',');
  const c2 = line.indexOf(',', c1 + 1);
  const lat = +line.slice(0, c1);
  const lon = +line.slice(c1 + 1, c2);
  if (lat < BBOX.s || lat > BBOX.n || lon < BBOX.w || lon > BBOX.e) continue;
  const c3 = line.indexOf(',', c2 + 1);
  const c4 = line.indexOf(',', c3 + 1);
  if (+line.slice(c3 + 1, c4) < MIN_CONFIDENCE) continue;
  gz.write(line + '\n');
  kept++;
}
gz.end();
console.log(`done: ${seen} buildings read, ${kept} in Kasaragod`);
