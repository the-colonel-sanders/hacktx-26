// Simulate phones hearing a gunshot and reporting it to the server.
//
//   npx tsx scripts/simulate.ts <x> <y> [baseUrl] [--shots 3] [--move 4] [--rooms 202,204] [--keep]
//
// Checks in one fake phone per room (each with a random clock skew and mic gain),
// syncs clocks via /api/time, calibrates, then posts detections for each shot.
// --move N moves the source N meters along +x between shots.
// --rooms limits the fake phones to those room ids (default: every room).
// Clears any active incident first unless --keep is passed.

import { ROOMS } from "../lib/floorplan";
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
    console.error("Usage: npx tsx scripts/simulate.ts <x> <y> [baseUrl] [--shots 3] [--move 4] [--keep]");
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
  };
}

const jitter = (amp: number) => (Math.random() * 2 - 1) * amp;

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
async function syncClock(baseUrl: string, localNow: () => number): Promise<number> {
  let best = { rtt: Infinity, offset: 0 };
  for (let i = 0; i < 5; i++) {
    const t0 = localNow();
    const res = await fetch(`${baseUrl}/api/time`);
    const { serverTime } = (await res.json()) as { serverTime: number };
    const t1 = localNow();
    if (t1 - t0 < best.rtt) best = { rtt: t1 - t0, offset: serverTime - (t0 + t1) / 2 };
  }
  return best.offset;
}

async function main() {
  const { x, y, baseUrl, shots, move, keep, rooms } = parseArgs();
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
      const clockOffsetMs = await syncClock(baseUrl, () => Date.now() + skewMs);
      const { deviceId } = await post<{ deviceId: string }>(baseUrl, "/api/checkin", { roomId: room.id, clockOffsetMs });
      await post(baseUrl, "/api/calibrate", { deviceId, peakDb: REFERENCE_DB + gainDb + jitter(0.5) });
      return { roomId: room.id, x: room.x, y: room.y, skewMs, gainDb, deviceId };
    }),
  );
  console.log(`Checked in ${phones.length} phones at ${baseUrl}\n`);

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
    let last: { incidentId: string; estimate: { x: number; y: number; roomId: string; deviceCount: number } } | null = null;
    for (const { trueTs: _, ...body } of reports) last = await post(baseUrl, "/api/detection", body);

    const e = last!.estimate;
    const err = Math.hypot(e.x - sx, e.y - sy);
    console.log(
      `Shot ${s + 1}: true (${sx.toFixed(1)}, ${sy.toFixed(1)})  estimate (${e.x.toFixed(1)}, ${e.y.toFixed(1)})` +
        `  room ${e.roomId}  error ${err.toFixed(2)} m  [${e.deviceCount} devices]`,
    );
    if (s === shots - 1) console.log(`\nIncident ${last!.incidentId}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
