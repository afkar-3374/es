# electrosparkzz.in (site repo)

The Electrosparkzz website and the shared 3D town. Deployed to GitHub Pages by `.github/workflows/deploy.yml` on every push to `main`.

## What is here
- `world/`: the 3D town (React, React Three Fiber, Rapier, Vite). It is the home page. See `world/README.md`.
- `book.html`, `triply.html`, `herai.html`, `glazy.html`, `404.html`: the book-style pages, with `book.js` and `styles.css`.
- `sw.js`, `pwa.js`, `offline.html`: the service worker that makes the site installable and usable offline.
- `assets/`, `robots.txt`, `sitemap.xml`, `CNAME`: site assets and metadata.

The workflow builds `world/` and copies its output to the site root. The manifest lives at `world/public/manifest.webmanifest` and icons at `world/public/icons/`.

## Progressive web app
- **Installable:** the manifest has name, icons (192, 512 and a maskable 512), `start_url`, `display` and a shortcut to the book. The service worker has a fetch handler, so Chrome and Edge offer install.
- **Offline:** the service worker precaches the home page, the book and the core icons and styles. Other pages and map tiles are cached on first use, up to 500 entries. Pages you have never opened show `offline.html`.
- **Updates:** a new `VERSION` in `sw.js` replaces the old cache on the next visit. Bump it whenever the precache list or caching rules change.
- **Never cached:** cross-origin requests (Supabase realtime, weather, fonts' origin is not cached beyond the browser's own cache), and range requests.

### Changing the PWA
- Edit `sw.js` and bump `VERSION`.
- Edit `world/public/manifest.webmanifest`. Keep the 512 maskable icon with the artwork inside the centre 80%.
- Every HTML page loads `pwa.js`. Keep that tag when adding pages.

### Check it locally
```sh
cd world && npm run build && cd ..
rsync -a --exclude .git --exclude .github --exclude world --exclude _site ./ /tmp/site/
cp -r world/dist/. /tmp/site/
cd /tmp/site && python3 -m http.server 8080
```
Open `http://localhost:8080/`. In DevTools, Application → Service Workers should show the worker as activated, and Application → Manifest should show no errors. Note that `/tmp` here is only an example; use any scratch folder.
