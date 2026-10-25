// Simulate phones hearing a gunshot and reporting it to the server.
//
//   npx tsx scripts/simulate.ts <x> <y> [baseUrl] [--shots 3] [--move 4] [--rooms 202,204] [--keep]
//   npx tsx scripts/simulate.ts <x> <y> [baseUrl] --geo 30.2849,-97.7341 [--gps 15]
//
// Checks in one fake phone per room (each with a random clock skew and mic gain),
// syncs clocks via /api/time, calibrates, then posts detections for each shot.
// --move N moves the source N meters along +x between shots.
// --rooms limits the fake phones to those room ids (default: every room).
// --geo lat,lng puts the floor plan on the real map with (0, 0) at that point, +x east and +y north;
//   the phones check in by lat/lng as hand-placed pins. --gps N makes them GPS fixes off by ~N m instead.
// Clears any active incident first unless --keep is passed.

import { ROOMS } from "../lib/floorplan";
import { ACCURACY_PER_SIGMA, PIN_ACCURACY_M, toLatLng, toLocal, type LatLng } from "../lib/geo";
import { REFERENCE_DB } from "../lib/localize";

const SPEED_OF_SOUND = 343; // m/s
const SOURCE_DB_AT_1M = -5;
const SHOT_SPACING_MS = 2000;

function parseArgs() {
  const positional: string[] = [];
  const flags: Record<string, string | true> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[a.slice(2)] = next;
        i++;
      } else flags[a.slice(2)] = true;
    } else positional.push(a);
  }
  const x = Number(positional[0]);
  const y = Number(positional[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    console.error("Usage: npx tsx scripts/simulate.ts <x> <y> [baseUrl] [--shots 3] [--move 4] [--keep] [--geo lat,lng [--gps 15]]");
    process.exit(1);
  }
  const [lat, lng] = typeof flags.geo === "string" ? flags.geo.split(",").map(Number) : [];
  if (flags.geo && !(Number.isFinite(lat) && Number.isFinite(lng))) {
    console.error("--geo needs lat,lng, e.g. --geo 30.2849,-97.7341");
    process.exit(1);
  }
  return {
    x,
    y,
    baseUrl: (positional[2] ?? "http://localhost:3000").replace(/\/$/, ""),
    shots: Number(flags.shots ?? 1),
    move: Number(flags.move ?? 0),
    keep: flags.keep === true,
    rooms: typeof flags.rooms === "string" ? flags.rooms.split(",").map((r) => r.trim()) : null,
    anchor: flags.geo ? ({ lat, lng } as LatLng) : null,
    gpsErrorM: Number(flags.gps ?? 0),
  };
}

const jitter = (amp: number) => (Math.random() * 2 - 1) * amp;
const gauss = () => Math.sqrt(-2 * Math.log(Math.random() + 1e-12)) * Math.cos(2 * Math.PI * Math.random());

async function post<T = unknown>(baseUrl: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(baseUrl + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(data)}`);
  return data as T;
}

type FakePhone = { roomId: string; x: number; y: number; skewMs: number; gainDb: number; deviceId: string };

/** NTP-style: offset = serverTime − (t0+t1)/2, keeping the sample with the smallest round trip. */
async function syncClock(baseUrl: string, localNow: () => number): Promise<{ rtt: number; offset: number }> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 5; i++) {
    const t0 = localNow();
    const res = await fetch(`${baseUrl}/api/time`);
    const { serverTime } = (await res.json()) as { serverTime: number };
    const t1 = localNow();
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 };
  }
  return best;
}

async function main() {
  const { x, y, baseUrl, shots, move, keep, rooms, anchor, gpsErrorM } = parseArgs();
  const unknown = rooms?.filter((id) => !ROOMS.some((r) => r.id === id)) ?? [];
  if (unknown.length) {
    console.error(`Unknown room(s): ${unknown.join(", ")}. Valid: ${ROOMS.map((r) => r.id).join(", ")}`);
    process.exit(1);
  }

  if (!keep) await post(baseUrl, "/api/all-clear");

  // Check in + calibrate one phone per room.
  const phones: FakePhone[] = await Promise.all(
    ROOMS.filter((r) => !rooms || rooms.includes(r.id)).map(async (room) => {
      const skewMs = jitter(3000); // phone clocks are off by up to ±3 s
      const gainDb = jitter(6); // mics differ by up to ±6 dB
      const sync = await syncClock(baseUrl, () => Date.now() + skewMs);
      // On the real map, the phone reports a lat/lng: a hand-placed pin, or a GPS fix off by ~gpsErrorM.
      const where = anchor
        ? {
            ...toLatLng({ x: room.x + gauss() * gpsErrorM / Math.SQRT2, y: room.y + gauss() * gpsErrorM / Math.SQRT2 }, anchor),
            accuracyM: gpsErrorM ? gpsErrorM * ACCURACY_PER_SIGMA : PIN_ACCURACY_M,
            label: room.name,
          }
        : { roomId: room.id };
      const { deviceId } = await post<{ deviceId: string }>(baseUrl, "/api/checkin", {
        ...where,
        clockOffsetMs: sync.offset,
        clockRttMs: sync.rtt,
      });
      await post(baseUrl, "/api/calibrate", { deviceId, peakDb: REFERENCE_DB + gainDb + jitter(0.5) });
      return { roomId: room.id, x: room.x, y: room.y, skewMs, gainDb, deviceId };
    }),
  );
  console.log(
    `Checked in ${phones.length} phones at ${baseUrl}` +
      (anchor ? ` on the real map around ${anchor.lat}, ${anchor.lng}${gpsErrorM ? ` (GPS off by ~${gpsErrorM} m)` : ""}` : "") +
      "\n",
  );

  const start = Date.now();
  for (let s = 0; s < shots; s++) {
    const sx = x + s * move;
    const sy = y;
    const shotTime = start + s * SHOT_SPACING_MS;

    const reports = phones.map((p) => {
      const d = Math.max(0.5, Math.hypot(sx - p.x, sy - p.y));
      const trueTs = shotTime + (d / SPEED_OF_SOUND) * 1000 + jitter(5);
      return {
        deviceId: p.deviceId,
        localSpikeTsMs: trueTs + p.skewMs,
        peakDb: SOURCE_DB_AT_1M - 20 * Math.log10(d) + p.gainDb + jitter(2),
        confidence: 0.9 + Math.random() * 0.1,
        label: "gunshot",
        trueTs,
      };
    });

    // Send in arrival order, like real phones would.
    reports.sort((a, b) => a.trueTs - b.trueTs);
    type Estimate = { x: number; y: number; lat: number | null; lng: number | null; label: string | null; deviceCount: number };
    let last: { incidentId: string; estimate: Estimate } | null = null;
    for (const { trueTs: _, ...body } of reports) last = await post(baseUrl, "/api/detection", body);

    const e = last!.estimate;
    // On the real map the server's x/y are relative to the incident's first phone, so compare via lat/lng.
    const found = anchor ? toLocal({ lat: e.lat!, lng: e.lng! }, anchor) : e;
    const err = Math.hypot(found.x - sx, found.y - sy);
    const at = anchor ? ` = ${e.lat!.toFixed(6)}, ${e.lng!.toFixed(6)}` : "";
    console.log(
      `Shot ${s + 1}: true (${sx.toFixed(1)}, ${sy.toFixed(1)})  estimate (${found.x.toFixed(1)}, ${found.y.toFixed(1)})${at}` +
        `  near ${e.label}  error ${err.toFixed(2)} m  [${e.deviceCount} devices]`,
    );
    if (s === shots - 1) console.log(`\nIncident ${last!.incidentId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
