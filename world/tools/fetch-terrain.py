# Downloads ground heights for Kasaragod district from the AWS Terrain Tiles open dataset
# (Mapzen "terrarium" PNGs, mostly SRTM; https://registry.opendata.aws/terrain-tiles/) and
# writes one grid the map builder samples:
#   <cache>/terrain.bin   int16 little-endian metres, row by row from the north-west corner
#   <cache>/terrain.json  { "west", "north", "east", "south", "width", "height" }
#   python3 tools/fetch-terrain.py <cache-dir>
import json, math, os, sys, urllib.request
from io import BytesIO
from PIL import Image

CACHE = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: fetch-terrain.py <cache-dir>")
Z = 12  # about 37 m a pixel here
BBOX = {"s": 12.0, "w": 74.82, "n": 12.85, "e": 75.5}
URL = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"


def tile_xy(lat, lon):
    n = 2**Z
    x = (lon + 180) / 360 * n
    s = math.sin(math.radians(lat))
    y = (0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n
    return x, y


x0, y0 = tile_xy(BBOX["n"], BBOX["w"])
x1, y1 = tile_xy(BBOX["s"], BBOX["e"])
tx0, ty0, tx1, ty1 = int(x0), int(y0), int(x1), int(y1)
W = (tx1 - tx0 + 1) * 256
H = (ty1 - ty0 + 1) * 256
grid = bytearray(W * H * 2)
tiles = os.path.join(CACHE, "terrain-tiles")
os.makedirs(tiles, exist_ok=True)
for ty in range(ty0, ty1 + 1):
    for tx in range(tx0, tx1 + 1):
        path = os.path.join(tiles, f"{Z}_{tx}_{ty}.png")
        if not os.path.exists(path):
            req = urllib.request.Request(URL.format(z=Z, x=tx, y=ty), headers={"User-Agent": "electrosparkzz-town"})
            with urllib.request.urlopen(req, timeout=120) as r, open(path, "wb") as f:
                f.write(r.read())
        im = Image.open(path).convert("RGB")
        px = im.load()
        for j in range(256):
            for i in range(256):
                r, g, b = px[i, j]
                h = round(r * 256 + g + b / 256 - 32768)
                h = max(-32768, min(32767, h))
                o = (((ty - ty0) * 256 + j) * W + (tx - tx0) * 256 + i) * 2
                grid[o : o + 2] = int(h).to_bytes(2, "little", signed=True)
        print(f"tile {tx},{ty}", flush=True)


def lonlat(px, py):
    n = 2**Z * 256
    lon = (tx0 * 256 + px) / n * 360 - 180
    lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * (ty0 * 256 + py) / n))))
    return lon, lat


west, north = lonlat(0, 0)
east, south = lonlat(W, H)
with open(os.path.join(CACHE, "terrain.bin"), "wb") as f:
    f.write(grid)
# rows follow the web-map projection: sample with the tile origin, not by latitude
json.dump({"west": west, "north": north, "east": east, "south": south, "width": W, "height": H, "zoom": Z, "tx0": tx0, "ty0": ty0}, open(os.path.join(CACHE, "terrain.json"), "w"))
print("done", W, "x", H)
