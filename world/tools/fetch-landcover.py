# Downloads what covers the ground in Kasaragod district from ESA WorldCover 2021 (10 m,
# CC BY 4.0, https://esa-worldcover.org): trees, shrubs, grass, crops (paddy), built-up,
# bare ground, water, wetland, mangroves. Only the parts of the big GeoTIFFs over the
# district are fetched (they're tiled inside), then put on one 20 m grid:
#   <cache>/landcover.bin   uint8 class codes, row by row from the north-west corner
#   <cache>/landcover.json  { "west", "north", "east", "south", "width", "height" }
#   python3 tools/fetch-landcover.py <cache-dir>
import json, os, struct, sys, urllib.request, zlib

CACHE = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: fetch-landcover.py <cache-dir>")
BBOX = {"s": 12.0, "w": 74.82, "n": 12.85, "e": 75.5}
URL = "https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{}_Map.tif"
# each file: 3° square, 36000 px a side (1/12000°), 1024 px tiles inside
SRC = {"N12E072": (15.0, 72.0), "N12E075": (15.0, 75.0)}
PX = 1 / 12000
STEP = 2  # keep every 2nd pixel: 20 m
WIDTH = round((BBOX["e"] - BBOX["w"]) / PX / STEP)
HEIGHT = round((BBOX["n"] - BBOX["s"]) / PX / STEP)
out = bytearray(WIDTH * HEIGHT)


def get(url, start, end):
    req = urllib.request.Request(url, headers={"User-Agent": "electrosparkzz-town", "Range": f"bytes={start}-{end}"})
    for _ in range(5):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except OSError as e:
            print("   retry:", e, flush=True)
    raise SystemExit(f"could not read {url}")


def ifd0(head):
    # the first image's size, tile size and where each tile is
    bo = "<" if head[:2] == b"II" else ">"
    off = struct.unpack(bo + "I", head[4:8])[0]
    count = struct.unpack(bo + "H", head[off : off + 2])[0]
    tags = {}
    for i in range(count):
        tag, typ, n, val = struct.unpack(bo + "HHII", head[off + 2 + i * 12 : off + 14 + i * 12])
        tags[tag] = (typ, n, val)
    w, tw = tags[256][2], tags[322][2]
    assert tags[259][2] == 8, "expected deflate"
    _, n, at = tags[324]
    offsets = struct.unpack(bo + f"{n}I", head[at : at + 4 * n])
    _, n, at = tags[325]
    counts = struct.unpack(bo + f"{n}I", head[at : at + 4 * n])
    return w, tw, offsets, counts


cache = os.path.join(CACHE, "landcover-tiles")
os.makedirs(cache, exist_ok=True)
for name, (north, west) in SRC.items():
    url = URL.format(name)
    w, tw, offsets, counts = ifd0(get(url, 0, 131071))
    per_row = (w + tw - 1) // tw
    # pixel range in this file over the district
    c0 = max(0, int((BBOX["w"] - west) / PX))
    c1 = min(w - 1, int((BBOX["e"] - west) / PX))
    r0 = max(0, int((north - BBOX["n"]) / PX))
    r1 = min(w - 1, int((north - BBOX["s"]) / PX))
    if c0 > c1:
        continue
    for ty in range(r0 // tw, r1 // tw + 1):
        for tx in range(c0 // tw, c1 // tw + 1):
            k = ty * per_row + tx
            path = os.path.join(cache, f"{name}_{k}.bin")
            if not os.path.exists(path):
                raw = get(url, offsets[k], offsets[k] + counts[k] - 1)
                with open(path, "wb") as f:
                    f.write(zlib.decompress(raw))
            px = open(path, "rb").read()
            # every 2nd pixel that falls in the district
            for j in range(0, tw, STEP):
                lat = north - (ty * tw + j + 0.5) * PX
                oy = int((BBOX["n"] - lat) / PX / STEP)
                if not 0 <= oy < HEIGHT:
                    continue
                row = j * tw
                for i in range(0, tw, STEP):
                    lon = west + (tx * tw + i + 0.5) * PX
                    ox = int((lon - BBOX["w"]) / PX / STEP)
                    if 0 <= ox < WIDTH:
                        out[oy * WIDTH + ox] = px[row + i]
            print(f"{name} tile {tx},{ty}", flush=True)

with open(os.path.join(CACHE, "landcover.bin"), "wb") as f:
    f.write(out)
json.dump({"west": BBOX["w"], "north": BBOX["n"], "east": BBOX["e"], "south": BBOX["s"], "width": WIDTH, "height": HEIGHT}, open(os.path.join(CACHE, "landcover.json"), "w"))
counts = {}
for v in out:
    counts[v] = counts.get(v, 0) + 1
print("done", WIDTH, "x", HEIGHT, {k: round(v / len(out) * 100, 1) for k, v in sorted(counts.items())})
