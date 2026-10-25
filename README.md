# Gunshot Detection & Localization — Server

Next.js (App Router) API + Supabase (Postgres + Realtime). Phones POST gunshot detections (metadata only, never audio); the server groups them into shots, localizes the source with a grid search over the floor plan, and raises a building-wide alert. Clients subscribe to `incidents`, `alerts` and `statuses` via Supabase Realtime.

## Setup

### 1. Env vars

```sh
cp .env.example .env.local
```

| Var | Where to find it | Used by |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase → Project Settings → API | server + browser |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Project Settings → API Keys → `sb_publishable_...` | browser only (read + Realtime) |
| `SUPABASE_SECRET_KEY` | Project Settings → API Keys → `sb_secret_...` | **server only** — never expose to the browser |
| `NEXT_PUBLIC_MAP_CENTER` | optional, `lat,lng` | where the real map opens before a GPS fix (default: UT Austin) |
| `SERPAPI_KEY` | optional, serpapi.com | nearby buildings on the incident map |

### 2. Schema + seed

In the Supabase dashboard → SQL Editor, run `supabase/schema.sql` and then `supabase/seed.sql`. Both can be re-run safely. (Or from a terminal: `psql "$DB_URL" -f supabase/schema.sql -f supabase/seed.sql`.)

The seed creates 5 classrooms (201–205, 6 m apart along y = 0) and 3 hallway zones at y = 4. Keep `ROOMS` in `lib/floorplan.ts` in sync with the seed if you change it — the simulator uses it.

### 3. Run

```sh
npm install
npm run dev        # http://localhost:3000
npm test           # vitest: localization math
```

### 4. Simulate a shooting

With the dev server running:

```sh
npx tsx scripts/simulate.ts 9 2                                   # source at (9, 2) m
npx tsx scripts/simulate.ts 2 -2 http://localhost:3000 --shots 3 --move 4   # moving source
npx tsx scripts/simulate.ts 9 2 https://your-app.vercel.app       # against a deployment
npx tsx scripts/simulate.ts 9 2 http://localhost:3000 --geo 30.2849,-97.7341           # on the real map
npx tsx scripts/simulate.ts 9 2 http://localhost:3000 --geo 30.2849,-97.7341 --gps 15  # phones placed by GPS, ~15 m off
```

It checks in one fake phone per room (random clock skew ±3 s and mic gain ±6 dB, corrected by clock sync + calibration), then posts each phone's detection with ±5 ms / ±2 dB jitter, and prints the estimate vs. the true source. It sends **all-clear first** to start a fresh incident; pass `--keep` to add to the current one.

### 5. Deploy to Vercel

1. Push to GitHub, import the repo in Vercel (framework auto-detected as Next.js).
2. Add the three env vars under Project → Settings → Environment Variables.
3. Deploy. Point phones at `https://<app>.vercel.app/api/...`.

### 6. Real phones

Open `/phone` on each phone (or scan a room's code from `/qr`), pick the room, and tap **Start listening**. Tap **Calibrate** and clap once about 1 m away.

### 7. Real map (OpenStreetMap)

On `/phone`, choose **Real map** instead of Room / Exact spot. The phone asks for its location and drops a pin with an accuracy circle. Indoors, GPS is usually off by 15–50 m, and every meter of phone-position error moves the shot estimate too, so **drag the pin to exactly where the phone is** (that counts as ±4 m). An optional label ("Room 214") names the spot in alerts.

An incident is on one map: the first detection decides whether it's the demo floor plan or the real map, and phones checked in the other way are turned away (`409`) until all-clear. On the real map the incident dashboard shows the heatmap, phones (with accuracy circles), shot trail and estimate on OpenStreetMap. Tiles come from `tile.openstreetmap.org`, which is fine for demos; heavy production use needs another tile provider ([usage policy](https://operations.osmfoundation.org/policies/tiles/)).

The mic only works over HTTPS, and phones can't reach `localhost`. Use one of these:
- **Vercel deploy** (easiest), or
- **A tunnel:** `ngrok http 3000`, then open the https URL on the phones, or
- **Local HTTPS:** `npm run dev:https`, then open `https://<laptop-LAN-IP>:3000` and accept the certificate warning.

Phone code lives in `app/phone/`:
- `audio.ts` opens the mic and timestamps each spike at the moment it reached the mic.
- `api.ts` handles clock sync, check-in (repeated every 3 min) and sending with retries.
- `detector.ts` is a **placeholder** that accepts any sharp impulse, including claps. Replace `classify()` with your model.

## API

All bodies are JSON; invalid input returns `400 { error }`.

| Route | Body | Returns |
|---|---|---|
| `GET /api/time` | — | `{ serverTime }` |
| `POST /api/checkin` | `{ deviceId?, roomId?, x?, y?, lat?, lng?, accuracyM?, label?, clockOffsetMs, clockRttMs? }`: send exactly one of `roomId`, `x`/`y` in meters (room = nearest), or `lat`/`lng` with `accuracyM` (≤ 100 m) | `{ deviceId, frame, roomId, x, y, lat, lng }` |
| `POST /api/calibrate` | `{ deviceId, peakDb }` | `{ deviceId, gainOffsetDb }` |
| `POST /api/detection` | `{ deviceId, localSpikeTsMs, peakDb, confidence, label }` | `{ incidentId, estimate: { x, y, lat, lng, roomId, label, deviceCount } }`; `409` if the active incident is on the other map |
| `POST /api/status` | `{ deviceId, status: "safe" \| "need_help" \| "injured" }` | `{ deviceId, roomId, status }` |
| `POST /api/alert` | — | `{ incidentId }` |
| `POST /api/all-clear` | — | `{ incidentId }` |
| `GET /api/incidents/current` | — | active incident + `detections`, or `null` |

**Clock sync (phone side):** call `/api/time` ~5 times; for each, `offset = serverTime − (t0 + t1)/2`; keep the sample with the smallest `t1 − t0`. Send that as `clockOffsetMs` on check-in.

**Heatmap format:** `{ width, height, resolution, originX, originY, values }`, row-major — cell `(col, row)` is at `(originX + col·resolution, originY + row·resolution)`, value `values[row·width + col]` in 0..1. On the real map (`incident.frame = "geo"`), x/y, `trail` and the heatmap are meters east/north of `incident.origin_lat/origin_lng` (the first phone that heard it); `best_lat/best_lng` give the estimate directly.

## Localization

`lib/localize.ts` — pure functions, tunables exported at the top (`LOUD_SIGMA_DB`, `TIME_SIGMA_*`, `CLIP_DB`, `SHOT_WINDOW_MS`, ...). For every 0.5 m cell, cost = χ² of the loudness model (inverse-square falloff with fitted source level, σ = 4 dB; clipped peaks count only as lower bounds) + χ² of arrival times (fitted fire time; each detection's σ from timing calibration, clock-sync round trip and position accuracy). Position error also widens the loudness term close to a phone. The best cell is the estimate; the heatmap is exp(−Δχ²/2), the likelihood relative to that cell, so the ≥ 0.1 region is roughly a 90% confidence area.

On the real map, `lib/geo.ts` projects lat/lng to meters around the incident's first phone and searches the phones' bounding box plus 30 m (coarser than 0.5 m over large areas, at most ~40k cells).

Known limit: phones checked in by room only report their room center, and loudness/order can't tell which side of a line of phones a sound came from. That's why the hallway has three reference zones — with a single hallway point, sources near the ends often get mirrored across y = 0.

## Python trilateration prototype

Trilateration software in `sound_changes/src/` (`localization.py`, `audio_processing.py`, `microphone.py`, `test_audio_localization.py`), sample audio in `sound_changes/audio/`. Install with `pip install -r sound_changes/requirements.txt`.
