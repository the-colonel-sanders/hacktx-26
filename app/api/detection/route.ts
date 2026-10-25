import { z } from "zod";
import { posSigmaM, type Frame, type LatLng } from "@/lib/geo";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { getOrCreateActiveIncident, type FrameInit } from "@/lib/incidents";
import { SHOT_WINDOW_MS, timeSigmaMs } from "@/lib/localize";
import { localizePending } from "@/lib/localizeIncident";
import { touchSpace } from "@/lib/spaces";
import { db } from "@/lib/supabase";

const Body = z.object({
  deviceId: z.uuid(),
  localSpikeTsMs: z.number(),
  peakDb: z.number(),
  confidence: z.number().min(0).max(1),
  label: z.string().max(100),
});

const frameName = (f: Frame | null) => (f === "geo" ? "the real map" : "the demo floor plan");

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, localSpikeTsMs, peakDb, confidence, label } = parsed.data;

  try {
    // 1. Correct for this phone's clock and mic gain.
    const { data: device, error: devErr } = await db().from("devices").select("*").eq("id", deviceId).maybeSingle();
    if (devErr) throw devErr;
    if (!device) return fail("Unknown deviceId", 404);
    const frame: Frame = device.frame ?? "grid";
    const deviceLatLng: LatLng | null = device.lat != null && device.lng != null ? { lat: device.lat, lng: device.lng } : null;
    if (frame === "geo" && !deviceLatLng) return fail("This phone has no map position. Check in again.", 409);

    // Server clock, minus this phone's calibrated audio-pipeline delay.
    const spikeTsMs = localSpikeTsMs + device.clock_offset_ms - (device.time_offset_ms ?? 0);
    const normPeakDb = peakDb - device.gain_offset_db;
    const posSigma = posSigmaM(device);
    const timeSigma = timeSigmaMs({
      posSigmaM: posSigma,
      calibrated: device.time_calibrated_at != null,
      syncRttMs: device.clock_rtt_ms,
    });

    // 2. First confirmed detection raises the building-wide alert and fixes which map the incident is on.
    const init: FrameInit = frame === "geo" ? { frame: "geo", origin: deviceLatLng! } : { frame: "grid" };
    const [{ incident }] = await Promise.all([
      // The phone's own space: it reports into the space it checked in to.
      getOrCreateActiveIncident(device.space_id, init),
      db().from("devices").update({ last_seen: new Date().toISOString() }).eq("id", deviceId),
      touchSpace(device.space_id),
    ]);
    if (incident.frame !== frame) {
      return fail(
        `The active incident is on ${frameName(incident.frame)}, but this phone is checked in on ${frameName(frame)}. ` +
          "Check in the same way as the other phones, or clear the incident.",
        409,
      );
    }

    // 3. Store it.
    const { error: insErr } = await db().from("detections").insert({
      incident_id: incident.id,
      device_id: deviceId,
      room_id: device.room_id,
      x: device.x,
      y: device.y,
      lat: device.lat,
      lng: device.lng,
      pos_sigma_m: posSigma,
      spike_ts_ms: spikeTsMs,
      raw_peak_db: peakDb,
      norm_peak_db: normPeakDb,
      time_sigma_ms: timeSigma,
      confidence,
      label,
    });
    if (insErr) throw insErr;

    // 4. Localize: this request runs the search unless another one is already doing it (it will
    // include this detection before it finishes), so a shot heard by N phones costs ~1–3 searches.
    const ran = await localizePending(incident.id);

    // 5. Report the incident's current estimate and how many phones heard this shot so far.
    const [{ data: inc, error: incErr }, { data: shotRows, error: shotErr }] = await Promise.all([
      db()
        .from("incidents")
        .select("best_x, best_y, best_lat, best_lng, best_room_id, best_label")
        .eq("id", incident.id)
        .single(),
      db()
        .from("detections")
        .select("device_id")
        .eq("incident_id", incident.id)
        .gte("spike_ts_ms", spikeTsMs - SHOT_WINDOW_MS)
        .lte("spike_ts_ms", spikeTsMs + SHOT_WINDOW_MS),
    ]);
    if (incErr) throw incErr;
    if (shotErr) throw shotErr;

    return json({
      incidentId: incident.id,
      estimate: {
        x: inc.best_x,
        y: inc.best_y,
        lat: inc.best_lat,
        lng: inc.best_lng,
        roomId: inc.best_room_id,
        label: inc.best_label,
        deviceCount: new Set(shotRows.map((r) => r.device_id)).size,
      },
      // True when another request is still localizing; the estimate may not include this report yet.
      pending: !ran,
    });
  } catch (e) {
    return failFrom(e);
  }
}
