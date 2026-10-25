<div align="center">

# Distributed Acoustic Incident Localization

### HackTX 2026 · School Safety Prototype

**This is A phone-based sensor network that compares sound timing and loudness to estimate where a sudden acoustic event originated.**

**Next.js** · **TypeScript** · **Web Audio API** · **Supabase**

[How it works](#how-it-works) · [Run locally](#getting-started) · [Demo](#testing-and-demonstration) · [API](#api-reference)

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
| **Position registration** | Tells the estimator where each microphone is | Room centers or manually selected X/Y positions |

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
  incident/             Incident interface
  calibrate/            Calibration interface
  qr/                   QR-based device setup

lib/
  floorplan.ts          Room positions and local map geometry
  localize.ts           Primary grid-search localization algorithm
  localize.test.ts      Localization tests
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

If initializing a new database, apply the project's SQL schema and seed data. The previous project README referenced `supabase/schema.sql` and `supabase/seed.sql`; **confirm those files are present in the branch you are using** before following that step.

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

**Simulated error is not real-world accuracy.** Synthetic data follow simplifying assumptions that actual phones and environments may violate.

### Option B: Phones listening to harmless test sounds

1. Start the application using an **HTTPS deployment or tunnel** reachable from the phones, such as a Vercel deployment or an ngrok HTTPS tunnel.
2. Open `/phone` on each participating device.
3. Choose a room or local X/Y spot and press **Start listening**; grant microphone permission.
4. Use the app's calibration controls where appropriate.
5. Make a **controlled clap** in an authorized test area and check the activity log and incident display.
6. Compare any reported location with the known test spot. Record the errors across repeated tests rather than reporting a single best case.

Do not use real weapons or alarming simulated gunfire in a public space for testing.

> [!NOTE]
> **Browsers impose practical restrictions.** A local URL such as `http://192.168.x.x:3000` generally does not provide the secure context needed for mobile microphone and GPS APIs. Also, locked screens and background browser tabs can suspend listening. The app attempts to keep screens awake but cannot guarantee uninterrupted recording.

## GPS integration (work in progress)

The browser-side GPS helper obtains the **device's estimated latitude and longitude** after permission is granted:

```typescript
import { getLocation } from "@/location/src/static_location_finder";

const { latitude, longitude } = await getLocation();
```

The import path above assumes the current helper is `location/src/static_location_finder.ts`; adjust it if the file is renamed.

This function can be called from a **client-side** Next.js component. It cannot run directly in a Node.js server function or standalone Python script.

For integration with the existing localization model, the intended process is:

1. Obtain the phone's GPS coordinates at check-in.
2. Convert each position into a shared local **X/Y coordinate system in meters**.
3. Send and store those coordinates against the registered device ID.
4. Continue using the existing detection API, which already identifies each phone by ID.

**Current status:** The helper exists independently. The shown `/phone` page still uses room/manual X/Y selection, and GPS-to-check-in conversion has not been confirmed as integrated. GPS also returns an estimate, **not an exact physical position**.

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
| `GET` | `/api/incidents/current` | Read the active incident |

The phone client also uses **timing calibration** endpoints (`/api/timing-cal` and `/api/timing-cal/report`).

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

The client adds its device ID and clock synchronization values before sending the actual check-in request. GPS latitude/longitude should **not** simply be substituted for meter-based `x`/`y`.



### Responsible use

This prototype **estimates the origin of an acoustic event**, not the identity or present location of a shooter. False positives and large position errors are possible. Any future deployment in schools would require independent validation, consent and data policies, secure access controls, and a clear process for human review.

---

<div align="center">

**Built for HackTX 2026** · Experimental distributed sensing for safer, more informed emergency response.

</div>
