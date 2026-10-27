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

## Previews

These only change the view:

- `?time=19:30` — that time in Kasaragod today
- `?weather=clear|cloudy|rain|storm|fog`
- `?cam=x,z,yaw[,height,pitch]` — start somewhere else (height 4.5 = first floor)
- `?off=town,beach,vehicles,cafe,corner,library,held` — turn parts off (profiling)
- `?debug` — logs the town connection and exposes `esSay`, `esRide`, `esPeers`… on `window`

Time, sun and moon follow Kasaragod (12.50° N, 74.99° E); live weather comes from Open-Meteo.
Credits: see public/CREDITS.txt.
