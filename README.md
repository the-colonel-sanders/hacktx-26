<div align="center">

# Distributed Acoustic Incident Localization

### HackTX 2026 · School Safety Prototype

**This is A phone based sensor network that compares sound timing and loudness to estimate where a sudden loud event originated.**

**Next.js** · **TypeScript** · **Web Audio API** · **Supabase**

[How it works](#how-it-works) · [Run locally](#getting-started) · [Demo](#testing-and-demonstration) · [API](#api-reference)

**Judges: start with [DEMO.md](DEMO.md)**, a step-by-step guide to running it with three listeners on one laptop or a real phone.

</div>

> [!IMPORTANT]
> **Research and hackathon demonstration only.** This prototype is not a validated gunshot detector, a guaranteed way to locate a person, or an emergency dispatch system. Do not use its results to make real emergency-response decisions.

## Overview

During a possible emergency, a single report often cannot establish where a sound originated. Our prototype explores whether **multiple participating smartphones** can provide a more useful shared picture.

Each phone joins the network at a known position and, when its user starts a listening session, analyzes microphone input **on the device**. If it identifies a sharp acoustic impulse, it sends limited metadata to a central server: **which phone detected it, when it was detected, and how loud it was**. The server compares reports from different phones and searches for a possible source location. The application displays the resulting estimate and incident information.

The central idea is straightforward: **the same sound generally reaches nearby phones sooner and louder than more distant phones**. The server uses those differences, rather than any one phone's report, to estimate where the sound might have originated.



## How it works

### 1. Register each phone

Participants open the existing [`/phone`](app/phone) interface and press **Start listening**.

(will update this section when code is updated)

### 2. Detect a sharp sound locally

The phone requests microphone permission and uses the **Web Audio API** and an **AudioWorklet** to identify sudden sound spikes.

When a spike occurs, the app passes a short audio sample to the classifier. The current classifier looks for a fast rise and decay in sound level. **It is a placeholder impulse detector, not a trained AI gunshot classifier.** Claps and other sharp noises may trigger it.

The short audio samples are processed in the browser. The demonstrated detection request does **not** upload raw audio recordings.

### 3. Compare observations from different phones

For each accepted detection, a phone sends the server:

| Field | Why it matters |
| --- | --- |
| `deviceId` | Identifies the sensor and its registered location |
| `localSpikeTsMs` | Records when that phone detected the sound |
| `peakDb` | Provides a relative measurement of sound level |
| `confidence` | Reports the local classifier's score |
| `label` | Describes the type of event detected by the classifier |

The server associates reports that may describe the same event. It can then compare arrival times and loudness across the registered sensors.

### 4. Estimate a source location

Rather than taking the nearest or loudest phone as the answer, the TypeScript localizer in [`lib/localize.ts`](lib/localize.ts) examines many **possible source locations**.

At each candidate point it asks two questions:

1. **Timing:** If a sound originated here, would its travel time explain when the different phones heard it?
2. **Loudness:** Would this point reasonably explain why some phones reported a stronger impulse than others?


<img width="1536" height="1024" alt="image" src="https://github.com/user-attachments/assets/a6ab38aa-b61c-421e-adff-c0ee8f32c1f5" />


*The illustrated dB levels and arrival order are examples for the sake of explanation, not measured data. Microphone sensitivity and sound reflections can affect loudness as well as distance.*

> **What does the map show?** An **estimated acoustic origin**, not the exact confirmed position of a person. Sensor placement, echoes, microphone differences, GPS errors, and synchronization can all shift the result.

### 5. Show incident information

The server uses Supabase for incident-related data and Realtime updates. The phone interface can display an active incident, an estimated room, and optional status reporting such as **safe**, **need help**, or **injured**. There is also an optional lockdown-style screen for demonstration.

**For this prototype, alerts and estimated locations must be treated as test information**, not verified emergency instructions.

## Why synchronization and calibration matter

For localization, the phones must measure the **same event** in ways that can be compared.

| Component | Role | Current implementation |
| --- | --- | --- |
| **Clock synchronization** | Helps put phones' event timestamps on a common time scale | Multiple `/api/time` requests; the best round-trip sample is retained and synchronization repeats periodically |
| **Microphone calibration** | Helps compensate for differences in device microphone levels | User makes a controlled clap; a gain offset is recorded |
| **Timing calibration** | Tests or compensates for differences in observed acoustic event timing | Separate timing-calibration workflow in the phone app |
| **Position registration** | Tells the estimator where each microphone is | Room centers, manually selected X/Y positions, or a real-map position (GPS, refined by dropping a pin); each phone's position accuracy is factored into the estimate |

These steps improve comparability but do not prove that audio is synchronized to millisecond precision. **Real outdoor accuracy remains to be measured.**

## Privacy and user control

Privacy is a design priority because participating devices may be used around students.

**Present in the supplied phone implementation:**

- **User activation:** A participant explicitly starts listening and grants microphone permission.
- **On-device audio analysis:** The microphone stream and short classifier samples are processed locally.
- **Metadata-only detection reports:** The shown `/api/detection` request transmits timestamps, levels, device identity and classification results, **not audio clips**.
- **Visible listening status:** The phone interface shows when monitoring is active.
- **Screen-awake handling:** The browser tries to keep the session active while the page remains open, subject to device restrictions.

**Proposed, not yet implemented or verified:**

- Automatically stop monitoring after school hours or when an authorized session expires.
- Minimize retention of device-location and incident metadata.
- Add clearer controls for ending a session and managing participation.
- Define permission and access policies appropriate for a school setting.

**Privacy Note:** The application processes microphone samples locally, so it does not transmit raw audio recordings to the server.

## Technologies

| Technology | Purpose |
| --- | --- |
| **Next.js App Router + React** | Web app, phone interface, incident pages and API routes |
| **TypeScript** | Client logic, server logic and the primary localization estimator |
| **Web Audio API + AudioWorklet** | Microphone capture, spike detection and audio timing |
| **Supabase (Postgres + Realtime)** | Incident storage and live application updates |
| **Vitest** | Tests for the localization calculations |
| **Python** | Separate exploratory scripts, not required by the main Next.js detection pipeline |

## Project structure (placeholder)

```text
app/
  api/                  Server endpoints
  phone/                Phone UI, audio capture, detection and check-in
  incident/             Incident interface (floor plan or OpenStreetMap)
  map/                  Shared Leaflet/OpenStreetMap base map
  calibrate/            Calibration interface
  qr/                   QR-based device setup

lib/
  floorplan.ts          Room positions and local map geometry
  geo.ts                Lat/lng ↔ local meters, search area and position accuracy for the real map
  localize.ts           Primary grid-search localization algorithm
  localize.test.ts      Localization tests (plus geo.test.ts)
  supabase.ts           Server-side Supabase helpers
  supabaseBrowser.ts    Browser-side Realtime helpers
  timingCal.ts          Timing calibration logic

location/
  src/                  Standalone location experiments / GPS helper
  data/                 Local test data

public/
  spike-detector.js     AudioWorklet for impulse detection

scripts/
  simulate.ts           Generate synthetic multi-phone detections

sound_changes/          Separate Python audio/localization experiments

docs/assets/            Diagrams used in this README
```

The independent Python experiments are **not** the algorithm used by the main application's `lib/localize.ts`.

## Getting started

### Requirements

- Node.js and npm, compatible with the project dependencies
- A Supabase project configured for this application's tables and Realtime subscriptions
- A supported browser; **HTTPS** is generally required for microphone and geolocation permission on phones

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy the existing example environment file, if present:

```bash
cp .env.example .env.local
```

Add the keys documented by the project:

| Variable | Use |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Server-side only; **never expose it to client code or commit it** |
| `NEXT_PUBLIC_MAP_CENTER` | Optional `lat,lng` where the real map opens before a GPS fix (default: UT Austin) |
| `SERPAPI_KEY` | Optional; shows nearby buildings on the real-map incident view |

In the Supabase SQL editor, run `supabase/schema.sql` and then `supabase/seed.sql`. Both are safe to re-run. **Re-run `schema.sql` after pulling changes that add columns** (the real-map mode does); until then the API fails with errors like `column devices.frame does not exist`.

The documented seed uses classrooms **201–205** and several hallway reference zones. If you edit the map or seed, keep the server's database positions and [`lib/floorplan.ts`](lib/floorplan.ts) consistent.

### 3. Start the application

```bash
npm run dev
```

Open **http://localhost:3000** on the development computer.

### 4. Run tests

```bash
npm test
```

This is expected to run the project's Vitest localization tests, as documented in the existing README. It does **not** validate outdoor microphone or GPS precision.

## Testing and demonstration

### Option A: Synthetic multi-phone demo

With the development server running, execute:

```bash
npx tsx scripts/simulate.ts 9 2
```

The arguments specify the **simulated source position in local meters**, here `(9, 2)`.

For multiple simulated events with a moving source:

```bash
npx tsx scripts/simulate.ts 2 -2 http://localhost:3000 --shots 3 --move 4
```

The simulator registers fake phones at the predefined room positions, introduces synthetic clock skew and microphone gain differences, posts fabricated sound detections, and reports the **known simulated position versus the calculated estimate**.

Additional flags documented by the current script:

| Flag | Meaning |
| --- | --- |
| `--shots 3` | Number of simulated events |
| `--move 4` | Move the simulated source 4 m along X between events |
| `--rooms 202,204` | Limit the synthetic sensor set |
| `--keep` | Preserve an existing incident instead of clearing it first |
| `--space K7Q2` | Run in that demo space instead of the shared one |
| `--parallel` | Send every phone's report at the same instant, like real phones (exercises batched localization) |
| `--geo 30.2849,-97.7341` | Put the simulated phones on the real map around that point (X = meters east, Y = meters north), as hand-placed pins |
| `--gps 15` | With `--geo`: place the phones by simulated GPS, about 15 m off, instead of by pin |

**Simulated error is not real-world accuracy.** Synthetic data follow simplifying assumptions that actual phones and environments may violate.

### Option B: Phones listening to harmless test sounds

1. Start the application using an **HTTPS deployment or tunnel** reachable from the phones, such as a Vercel deployment or an ngrok HTTPS tunnel.
2. Open `/phone` on each participating device.
3. In the admin panel (`/admin`), set **All phones → Location** to Room, Exact spot or Real map. Each phone then picks its room, spot or map pin and presses **Start listening**; grant microphone permission.
4. Calibrate each phone's mic from the admin panel (the phone waits for one clap about 1 m away), and run timing calibration where appropriate.
5. Make a **controlled clap** in an authorized test area and check the activity log and incident display.
6. Compare any reported location with the known test spot. Record the errors across repeated tests rather than reporting a single best case.

Do not use real weapons or alarming simulated gunfire in a public space for testing.

> [!NOTE]
> **Browsers impose practical restrictions.** A local URL such as `http://192.168.x.x:3000` generally does not provide the secure context needed for mobile microphone and GPS APIs. Also, locked screens and background browser tabs can suspend listening. The app attempts to keep screens awake but cannot guarantee uninterrupted recording.

## Real map (OpenStreetMap)

On `/phone`, choose **Real map** instead of Room or Exact spot. The phone asks for location permission, watches GPS for up to 30 seconds, and drops a pin with an accuracy circle. Indoors, GPS is usually off by 15–50 m, and every meter of phone-position error shifts the estimate too, so **drag the pin to exactly where the phone is** (a hand-placed pin counts as ±4 m). An optional label such as "Room 214" names the spot in alerts.

- **One map per incident.** The first detection decides whether an incident uses the demo floor plan or the real map; phones checked in the other way are turned away (`409`) until all-clear.
- **Localization** stays in meters: [`lib/geo.ts`](lib/geo.ts) projects each phone's lat/lng to meters east/north of the incident's first phone, and the search covers the phones' bounding box plus 30 m. Each phone's position accuracy widens its timing and loudness error, so a rough GPS phone counts for less.
- **The incident dashboard** draws the heatmap, phones (with accuracy circles), shot trail and estimate on OpenStreetMap with Leaflet. Tiles come from `tile.openstreetmap.org`, which suits demos; heavy use needs another tile provider ([usage policy](https://operations.osmfoundation.org/policies/tiles/)).
- **Timing calibration** works on the real map too, for phones whose pin is within ±5 m.

The standalone helper in `location/src/static_location_finder.ts` also returns the **device's estimated latitude and longitude** after permission is granted:

```typescript
import { getLocation } from "@/location/src/static_location_finder";

const { latitude, longitude } = await getLocation();
```

The import path above assumes the current helper is `location/src/static_location_finder.ts`; adjust it if the file is renamed.

This function can be called from a **client-side** Next.js component. It cannot run directly in a Node.js server function or standalone Python script.

The `/phone` page uses its own watcher (`app/phone/gps.ts`), which keeps the most accurate fix and its accuracy radius. GPS returns an estimate, **not an exact physical position**.

## Demo spaces

Several people can demo at once without interfering: each **demo space** has its own phones, incident, alerts, status reports, timing calibration and phone settings.

- Open **`/spaces`** and press **Create space**. You get a 4-character code (e.g. `K7Q2`) and a QR code for phones.
- Phones join by scanning it or opening **`/join/K7Q2`** (add `?to=incident`, `admin`, `calibrate` or `spaces` to land elsewhere; `&room=203` also works). The space is remembered in that browser.
- The nav bar shows which space you're in. **Leave space** goes back to the **shared demo space**, where everything without a code lands (including all data from before spaces existed).
- Scripts pick a space with an `x-space: K7Q2` header or `?space=K7Q2`; the simulator takes `--space K7Q2`.
- A phone always reports into the space it checked in to.

## API reference

The existing app documents these JSON endpoints. Check the individual route implementations before changing request fields.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/time` | Server time for approximate clock alignment |
| `POST` | `/api/checkin` | Register/update device position and clock information |
| `POST` | `/api/calibrate` | Register a microphone gain calibration measurement |
| `POST` | `/api/detection` | Report a detected acoustic event |
| `POST` | `/api/status` | Report a participant's status for the active incident |
| `POST` | `/api/alert` | Trigger an incident alert |
| `POST` | `/api/all-clear` | Clear an active incident |
| `GET` | `/api/incidents/current` | Read the active incident, with heatmap and detections (dashboard) |
| `GET` | `/api/incidents/summary` | Just the active incident's id and estimated place (what phones poll) |
| `GET` | `/api/phones` | Recently active phones, where each is checked in, and its settings (admin panel) |
| `GET` | `/api/phones/settings?deviceId=` | The settings a phone should follow (phones poll this) |
| `POST` | `/api/phones/settings` | `{ target: deviceId \| "all", patch }`: change phone settings from the admin panel |
| `POST` | `/api/phones/calibrate-mic` | `{ deviceId }`: ask a phone to calibrate its mic on the next clap |

The phone client also uses **timing calibration** endpoints (`/api/timing-cal` and `/api/timing-cal/report`).

**Phone settings** are managed from the admin panel (`/admin`), not on the phones: which kind of location each phone gives (the phone still picks the room, spot or pin itself), lockdown screen, follow location, timing method, whether the **Simulate shot** button shows and what loudness/delay it reports, and mic calibration. A phone uses the built-in defaults (`lib/phoneSettings.ts`), overridden by the **All phones** row, overridden by its own row; phones pick up changes within about 2 seconds.

**Detection request example** (illustrative values):

```json
{
  "deviceId": "example-device-id",
  "localSpikeTsMs": 1792886400123.5,
  "peakDb": -16.2,
  "confidence": 0.83,
  "label": "impulse (placeholder)"
}
```

**Check-in location formats currently used by the phone client:**

```json
{ "roomId": "203" }
```

or

```json
{ "x": 9.0, "y": 2.0 }
```

or, on the real map (`accuracyM` is the reported accuracy radius in meters, at most 100):

```json
{ "lat": 30.28612, "lng": -97.73941, "accuracyM": 4, "label": "Room 214" }
```

The client adds its device ID and clock synchronization values (`clockOffsetMs`, `clockRttMs`) before sending the actual check-in request. Send exactly one location format; lat/lng is **not** a substitute for meter-based `x`/`y`, which are floor-plan coordinates.

On the real map, the incident's `best_lat`/`best_lng` give the estimate directly; its `best_x`/`best_y`, `trail` and `heatmap` are in meters east/north of `origin_lat`/`origin_lng`.



### Responsible use

This prototype **estimates the origin of an acoustic event**, not the identity or present location of a shooter. False positives and large position errors are possible. Any future deployment in schools would require independent validation, consent and data policies, secure access controls, and a clear process for human review.

---

<div align="center">

**Built for HackTX 2026** · Experimental distributed sensing for safer, more informed emergency response.

</div>
