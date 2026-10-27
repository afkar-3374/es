# Downloads Microsoft Rocketbox avatars (MIT licence) and makes them web-sized for the
# town: public/people/<look>/ gets model.fbx plus body/head colour and normal maps and
# the hair/lashes opacity map as .webp (colour 1024 px, normals 512 px).
#   python3 tools/fetch-people.py <cache-dir>
# Needs Pillow. Files come from jsDelivr's mirror of the GitHub repo (much faster), or GitHub itself.
import json, os, sys, urllib.error, urllib.request
from PIL import Image

CACHE = sys.argv[1] if len(sys.argv) > 1 else sys.exit("usage: fetch-people.py <cache-dir>")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "public", "people")
REPO = "microsoft/Microsoft-Rocketbox"
CDN = f"https://cdn.jsdelivr.net/gh/{REPO}@master/Assets/Avatars/Adults/"

# look name in the town → Rocketbox avatar
LOOKS = {
    "kurta": "Male_Adult_15",
    "hoodie": "Male_Adult_17",
    "jacket": "Male_Adult_04",
    "salwar": "Female_Adult_06",
    "dress": "Female_Adult_11",
}
PARTS = {"body_color": 1024, "body_normal": 512, "head_color": 1024, "head_normal": 512, "opacity_color": 1024}


RAW = f"https://raw.githubusercontent.com/{REPO}/master/Assets/Avatars/Adults/"


def get(url, path):
    if os.path.exists(path):
        return path
    print("  downloading", url.rsplit("/", 1)[-1], flush=True)
    # jsDelivr is faster but refuses some files: then straight from GitHub
    for u in (url, url.replace(CDN, RAW)):
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "electrosparkzz-town"})
            with urllib.request.urlopen(req, timeout=900) as r, open(path + ".part", "wb") as f:
                f.write(r.read())
            os.rename(path + ".part", path)
            return path
        except urllib.error.HTTPError as e:
            print("   ", e.code, "from", u.split("/")[2], flush=True)
    raise SystemExit(f"could not download {url}")


os.makedirs(CACHE, exist_ok=True)
for look, avatar in LOOKS.items():
    print(look, "←", avatar, flush=True)
    src = os.path.join(CACHE, avatar)
    os.makedirs(src, exist_ok=True)
    # texture names carry an id (m204_…): ask GitHub which files there are
    listing = os.path.join(src, "textures.json")
    if not os.path.exists(listing):
        req = urllib.request.Request(f"https://api.github.com/repos/{REPO}/contents/Assets/Avatars/Adults/{avatar}/Textures", headers={"User-Agent": "electrosparkzz-town"})
        with urllib.request.urlopen(req, timeout=60) as r, open(listing, "wb") as f:
            f.write(r.read())
    names = [x["name"] for x in json.load(open(listing))]
    dst = os.path.join(OUT, look)
    os.makedirs(dst, exist_ok=True)
    fbx = get(f"{CDN}{avatar}/Export/{avatar}.fbx", os.path.join(src, f"{avatar}.fbx"))
    with open(fbx, "rb") as a, open(os.path.join(dst, "model.fbx"), "wb") as b:
        b.write(a.read())
    for part, size in PARTS.items():
        file = next((n for n in names if n.endswith(f"_{part}.tga")), None)
        out = os.path.join(dst, f"{part}.webp")
        if not file:
            # no hair or lashes: a clear stand-in so the model still loads
            Image.new("RGBA", (4, 4), (0, 0, 0, 0)).save(out, "WEBP")
            continue
        im = Image.open(get(f"{CDN}{avatar}/Textures/{file}", os.path.join(src, file)))
        im = im.convert("RGBA" if part == "opacity_color" else "RGB").resize((size, size), Image.LANCZOS)
        im.save(out, "WEBP", quality=80, method=6)
    print("  done:", ", ".join(f"{f} {os.path.getsize(os.path.join(dst, f)) // 1024} KB" for f in sorted(os.listdir(dst))), flush=True)
