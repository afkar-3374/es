# Electrosparkzz Town

The shared 3D town at electrosparkzz.in (React Three Fiber + Rapier). It is the home page;
the classic book site lives at /book.html.

```bash
cd world
npm install
npm run dev        # http://localhost:5173/
npm run build      # the Deploy workflow builds this and publishes it at the site root
```

## One town for everyone

Every visitor lands on the same footpath opposite the Electrosparkzz building and sees everyone
else who is there: their person (walking, sitting or riding), a name tag, chat bubbles and their
vehicle. It runs over Supabase Realtime **broadcast** on the Glazy project, channel
`es-world:town` (see `src/net/`). Nothing is stored: no tables, no history. Positions are sent
about 6 times a second while someone moves, plus a heartbeat every 2.5 s; people disappear after
10 s of silence.

- Enter / T: chat · V: call your own vehicle (scooter, auto, car or bicycle) · M: town map
- Phones play in landscape: entering goes full screen and locks sideways where the browser allows
  (Android); otherwise a "turn your phone sideways" screen shows until you rotate.

## The town

`src/world/layout.ts` is the plan: the main street (x −205…205, z 5…15), Temple Road (z −95),
School Road (z 115), Market Avenue (x −100), Station Avenue (x 100), Hill Road (x 205) and Beach
Road (x −205), with the beach and the Arabian Sea to the west. `Town.tsx` fills it with shops,
Kerala houses, coconut groves, a football ground and a market, all from fixed seeds so everyone
sees the same town. Traffic drives every road and gives way at the main street.

## Smoothness

- **Graphics** (⚙️ in the HUD): Auto watches the frame rate and moves between Fast (lower
  resolution, smaller shadow area), Balanced and Pretty; built-in graphics and phones start on
  Fast. `?quality=fast|pretty` pins it.
- Palms are low-poly instances in 64 m tiles; far tiles aren't drawn, only near ones sway or cast
  shadows. Vehicles, cupboards, the building and its interiors are merged into one mesh per
  material (`mergeStatic`; parts that move, come and go or can be clicked are tagged and kept).
- Only four real point lights exist; lamps borrow them by distance (`Lamps.tsx`), so the light
  count never changes and shaders never recompile mid-game.
- Riders, pedestrians and other visitors use baked poses and a baked 8-frame walk cycle instead
  of skeletons (no per-frame bone uploads). The building's insides are hidden beyond 75 m.

## Previews

These only change the view:

- `?time=19:30` — that time in Kasaragod today
- `?weather=clear|cloudy|rain|storm|fog`
- `?cam=x,z,yaw[,height,pitch]` — start somewhere else (height 4.5 = first floor)
- `?off=town,beach,people,vehicles,cafe,corner,library,held` — turn parts off (profiling)
- `?debug` — logs the town connection and exposes `esSay`, `esRide`, `esPeers`, `esGl`… on `window`;
  `esWorld.freeCam = { at, yaw, pitch }` looks from anywhere

Time, sun and moon follow Kasaragod (12.50° N, 74.99° E); live weather comes from Open-Meteo.
Credits: see public/CREDITS.txt.

## The town game

Points, life and a bag, on top of the town.

- **Pick** from the coconut palms, the mango trees, the hibiscus and jasmine shrubs and the marigold beds
  (aim at them, or tap). Each has a few to pick; they grow back on their own, a little at a time.
- **Sell** at the Fruit & Flower Mart 🧺 (on the footpath, left of the building). It also makes garlands
  from your flowers.
- **Buy** with points at the shops along the footpath: 💊 Medical Store (first-aid kits, tonics),
  🥤 Juice & Snack Bar (drinks and ice cream, which give life back), ☂️ Umbrella & Sun Shop, and
  🪖 Helmet & Gear. Gear is worn from then on.
- **Life** (❤️, 100 at the start) goes down in accidents (a vehicle that runs into you), in the rain
  without an umbrella and in the heat (33 °C and up) without a sun cap. It comes back slowly when you're
  safe. At 0 you faint: you're taken home to the building and drop 10% of your points.
- **B** opens your bag: what you carry, what you can use, what you wear.

Everything is tuned in `src/game/catalog.ts` (`TUNE`, `ITEMS`, `SHOPS`, `SOURCES`). Points, life, the bag
and gear are saved in this browser only (localStorage); nothing is shared between visitors. Harvest stock
lives in the page and resets on reload. `?debug` exposes `esGame` (the game state) and `esPick(x, y)`.
