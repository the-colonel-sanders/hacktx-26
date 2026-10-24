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
```

It checks in one fake phone per room (random clock skew ±3 s and mic gain ±6 dB, corrected by clock sync + calibration), then posts each phone's detection with ±5 ms / ±2 dB jitter, and prints the estimate vs. the true source. It sends **all-clear first** to start a fresh incident; pass `--keep` to add to the current one.

### 5. Deploy to Vercel

1. Push to GitHub, import the repo in Vercel (framework auto-detected as Next.js).
2. Add the three env vars under Project → Settings → Environment Variables.
3. Deploy. Point phones at `https://<app>.vercel.app/api/...`.

### 6. Real phones

Open `/phone` on each phone (or scan a room's code from `/qr`), pick the room, and tap **Start listening**. Tap **Calibrate** and clap once about 1 m away.

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
| `POST /api/checkin` | `{ deviceId?, roomId?, x?, y?, lat?, lng?, clockOffsetMs }`: send `roomId` or `x`/`y` in meters (room = nearest) | `{ deviceId, roomId, x, y }` |
| `POST /api/calibrate` | `{ deviceId, peakDb }` | `{ deviceId, gainOffsetDb }` |
| `POST /api/detection` | `{ deviceId, localSpikeTsMs, peakDb, confidence, label }` | `{ incidentId, estimate: { x, y, roomId, deviceCount } }` |
| `POST /api/status` | `{ deviceId, status: "safe" \| "need_help" \| "injured" }` | `{ deviceId, roomId, status }` |
| `POST /api/alert` | — | `{ incidentId }` |
| `POST /api/all-clear` | — | `{ incidentId }` |
| `GET /api/incidents/current` | — | active incident + `detections`, or `null` |

**Clock sync (phone side):** call `/api/time` ~5 times; for each, `offset = serverTime − (t0 + t1)/2`; keep the sample with the smallest `t1 − t0`. Send that as `clockOffsetMs` on check-in.

**Heatmap format:** `{ width, height, resolution, originX, originY, values }`, row-major — cell `(col, row)` is at `(originX + col·resolution, originY + row·resolution)`, value `values[row·width + col]` in 0..1.

## Localization

`lib/localize.ts` — pure functions, tunables exported at the top (`W_LOUD`, `W_ORDER`, `HEATMAP_T`, `SHOT_WINDOW_MS`, ...). For every 0.5 m cell, cost = loudness-model residuals (inverse-square falloff with fitted source level) + 10 × arrival-order violations; the best cell is the estimate.

Known limit: phones only report their room center, and loudness/order can't tell which side of a line of phones a sound came from. That's why the hallway has three reference zones — with a single hallway point, sources near the ends often get mirrored across y = 0.

## Python trilateration prototype

Trilateration software (`localization.py`, `audio_processing.py`, `microphone.py`, `test_audio_localization.py`). Install with `pip install -r requirements.txt`.
