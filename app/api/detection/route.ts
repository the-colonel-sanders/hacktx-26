import { z } from "zod";
import { nearestRoom, positionOf, type Room } from "@/lib/floorplan";
import { fail, json, parseBody } from "@/lib/http";
import { getOrCreateActiveIncident, type TrailPoint } from "@/lib/incidents";
import { CLIP_DB, SHOT_WINDOW_MS, gridSearch, groupShot, timeSigmaMs, type Heatmap } from "@/lib/localize";
import { db } from "@/lib/supabase";

const Body = z.object({
  deviceId: z.uuid(),
  localSpikeTsMs: z.number(),
  peakDb: z.number(),
  confidence: z.number().min(0).max(1),
  label: z.string().max(100),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, localSpikeTsMs, peakDb, confidence, label } = parsed.data;

  try {
    // 1. Correct for this phone's clock and mic gain.
    const { data: device, error: devErr } = await db().from("devices").select("*").eq("id", deviceId).maybeSingle();
    if (devErr) throw devErr;
    if (!device) return fail("Unknown deviceId", 404);

    // Server clock, minus this phone's calibrated audio-pipeline delay.
    const spikeTsMs = localSpikeTsMs + device.clock_offset_ms - (device.time_offset_ms ?? 0);
    const normPeakDb = peakDb - device.gain_offset_db;
    const timeSigma = timeSigmaMs({
      exact: device.x != null && device.y != null,
      calibrated: device.time_calibrated_at != null,
      syncRttMs: device.clock_rtt_ms,
    });
    // 2. First confirmed detection raises the building-wide alert.
    const [{ incident }] = await Promise.all([
      getOrCreateActiveIncident(),
      db().from("devices").update({ last_seen: new Date().toISOString() }).eq("id", deviceId),
    ]);

    // 3. Store it.
    const { error: insErr } = await db().from("detections").insert({
      incident_id: incident.id,
      device_id: deviceId,
      room_id: device.room_id,
      x: device.x,
      y: device.y,
      spike_ts_ms: spikeTsMs,
      raw_peak_db: peakDb,
      norm_peak_db: normPeakDb,
      time_sigma_ms: timeSigma,
      confidence,
      label,
    });
    if (insErr) throw insErr;

    // 4. Group nearby detections into one shot.
    const [{ data: nearby, error: nearErr }, { data: rooms, error: roomsErr }, { count, error: countErr }] =
      await Promise.all([
        db()
          .from("detections")
          .select("device_id, room_id, x, y, spike_ts_ms, raw_peak_db, norm_peak_db, time_sigma_ms")
          .eq("incident_id", incident.id)
          .gte("spike_ts_ms", spikeTsMs - SHOT_WINDOW_MS)
          .lte("spike_ts_ms", spikeTsMs + SHOT_WINDOW_MS),
        db().from("rooms").select("id, name, x, y"),
        db().from("detections").select("id", { count: "exact", head: true }).eq("incident_id", incident.id),
      ]);
    if (nearErr) throw nearErr;
    if (roomsErr) throw roomsErr;
    if (countErr) throw countErr;

    const roomById = new Map((rooms as Room[]).map((r) => [r.id, r]));
    const shot = groupShot(
      nearby.map((d) => ({
        deviceId: d.device_id as string,
        pos: positionOf(d, roomById)!,
        // Rows from before time_sigma_ms existed: treat as uncalibrated.
        timeSigmaMs:
          (d.time_sigma_ms as number | null) ??
          timeSigmaMs({ exact: d.x != null && d.y != null, calibrated: false, syncRttMs: null }),
        clipped: (d.raw_peak_db as number) >= CLIP_DB,
        spikeTsMs: d.spike_ts_ms as number,
        normPeakDb: d.norm_peak_db as number,
      })),
      spikeTsMs,
    ).filter((d) => d.pos);

    // 5. Localize.
    let x: number;
    let y: number;
    let heatmap: Heatmap | null = null;
    if (shot.length >= 2) {
      const est = gridSearch(
        shot.map((d) => ({
          ...d.pos,
          timeSigmaMs: d.timeSigmaMs,
          clipped: d.clipped,
          normPeakDb: d.normPeakDb,
          spikeTsMs: d.spikeTsMs,
        })),
      );
      x = est.x;
      y = est.y;
      heatmap = est.heatmap;
    } else {
      ({ x, y } = positionOf(device, roomById)!);
    }
    const roomId = nearestRoom(x, y, rooms as Room[])?.id ?? null;

    // 6. Update the incident. A trail point within the shot window is the same shot, so refine it in place.
    const shotTs = Math.min(...shot.map((d) => d.spikeTsMs));
    const trail: TrailPoint[] = [...(incident.trail ?? [])];
    const existing = trail.findIndex((p) => Math.abs(p.t - shotTs) <= SHOT_WINDOW_MS);
    if (existing >= 0) trail[existing] = { x, y, t: trail[existing].t };
    else trail.push({ x, y, t: shotTs });

    const { error: updErr } = await db()
      .from("incidents")
      .update({
        best_x: x,
        best_y: y,
        best_room_id: roomId,
        heatmap,
        trail,
        detection_count: count ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", incident.id);
    if (updErr) throw updErr;

    // 7.
    return json({ incidentId: incident.id, estimate: { x, y, roomId, deviceCount: shot.length } });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
