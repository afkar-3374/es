# Electrosparkzz World

The 3D street in Kasaragod at electrosparkzz.in/world (React Three Fiber + Rapier).

```bash
cd world
npm install
npm run dev        # http://localhost:5173/world/
npm run build      # the Deploy workflow builds this and publishes it under /world
```

Preview a moment without waiting for it (these only change the view, nothing else):

- `?time=19:30` — that time in Kasaragod today
- `?weather=clear|cloudy|rain|storm|fog`
- `?cam=x,z,yaw[,height,pitch]` — start somewhere else (the street runs along x; the building is at z −20…0; height 4.5 = first floor)

Time, sun and moon follow Kasaragod (12.50° N, 74.99° E); live weather comes from Open-Meteo.
Credits: see public/CREDITS.txt.
