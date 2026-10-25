import { z } from "zod";
import { FLOOR_BOUNDS, nearestRoom, positionOf, type Room } from "@/lib/floorplan";
import { boundsAround, posSigmaM, toLatLng, toLocal, type Frame, type LatLng } from "@/lib/geo";
import { fail, json, parseBody } from "@/lib/http";
import { getOrCreateActiveIncident, type FrameInit, type TrailPoint } from "@/lib/incidents";
import {
  CLIP_DB,
  GRID_RESOLUTION_M,
  SHOT_WINDOW_MS,
  gridSearch,
  groupShot,
  timeSigmaMs,
  type Heatmap,
} from "@/lib/localize";
import { db } from "@/lib/supabase";

const Body = z.object({
  deviceId: z.uuid(),
  localSpikeTsMs: z.number(),
  peakDb: z.number(),
  confidence: z.number().min(0).max(1),
  label: z.string().max(100),
});

const FAR_FROM_LABEL_M = 15; // beyond this, say "N m from <label>" instead of just the label
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
      getOrCreateActiveIncident(init),
      db().from("devices").update({ last_seen: new Date().toISOString() }).eq("id", deviceId),
    ]);
    if (incident.frame !== frame) {
      return fail(
        `The active incident is on ${frameName(incident.frame)}, but this phone is checked in on ${frameName(frame)}. ` +
          "Check in the same way as the other phones, or clear the incident.",
        409,
      );
    }
    const origin: LatLng | null = frame === "geo" ? { lat: incident.origin_lat!, lng: incident.origin_lng! } : null;

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

    // 4. Group nearby detections into one shot.
    const [{ data: nearby, error: nearErr }, { data: rooms, error: roomsErr }, { count, error: countErr }] =
      await Promise.all([
        db()
          .from("detections")
          .select(
            "device_id, room_id, x, y, lat, lng, pos_sigma_m, spike_ts_ms, raw_peak_db, norm_peak_db, time_sigma_ms, devices(place_label)",
          )
          .eq("incident_id", incident.id)
          .gte("spike_ts_ms", spikeTsMs - SHOT_WINDOW_MS)
          .lte("spike_ts_ms", spikeTsMs + SHOT_WINDOW_MS),
        frame === "grid" ? db().from("rooms").select("id, name, x, y") : Promise.resolve({ data: [], error: null }),
        db().from("detections").select("id", { count: "exact", head: true }).eq("incident_id", incident.id),
      ]);
    if (nearErr) throw nearErr;
    if (roomsErr) throw roomsErr;
    if (countErr) throw countErr;

    // Positions in meters: the floor plan's own, or east/north of the incident's origin.
    const roomById = new Map((rooms as Room[]).map((r) => [r.id, r]));
    const locate = (row: { x: number | null; y: number | null; lat: number | null; lng: number | null; room_id: string | null }) =>
      origin
        ? row.lat != null && row.lng != null
          ? toLocal({ lat: row.lat, lng: row.lng }, origin)
          : null
        : positionOf(row, roomById);

    const shot = groupShot(
      nearby.map((d) => {
        // Rows from before pos_sigma_m / time_sigma_ms existed are floor-plan rows; treat them as uncalibrated.
        const rowPosSigma = (d.pos_sigma_m as number | null) ?? posSigmaM({ x: d.x, y: d.y });
        return {
          deviceId: d.device_id as string,
          pos: locate(d)!,
          placeLabel: (d.devices as unknown as { place_label: string | null } | null)?.place_label ?? null,
          posSigmaM: rowPosSigma,
          timeSigmaMs:
            (d.time_sigma_ms as number | null) ?? timeSigmaMs({ posSigmaM: rowPosSigma, calibrated: false, syncRttMs: null }),
          clipped: (d.raw_peak_db as number) >= CLIP_DB,
          spikeTsMs: d.spike_ts_ms as number,
          normPeakDb: d.norm_peak_db as number,
        };
      }),
      spikeTsMs,
    ).filter((d) => d.pos);

    // 5. Localize. On the real map, search around the phones that heard it.
    let x: number;
    let y: number;
    let heatmap: Heatmap | null = null;
    if (shot.length >= 2) {
      const area = origin
        ? boundsAround(shot.map((d) => d.pos))
        : { bounds: FLOOR_BOUNDS, resolution: GRID_RESOLUTION_M };
      const est = gridSearch(
        shot.map((d) => ({
          ...d.pos,
          posSigmaM: d.posSigmaM,
          timeSigmaMs: d.timeSigmaMs,
          clipped: d.clipped,
          normPeakDb: d.normPeakDb,
          spikeTsMs: d.spikeTsMs,
        })),
        area.bounds,
        area.resolution,
      );
      x = est.x;
      y = est.y;
      heatmap = est.heatmap;
    } else {
      ({ x, y } = locate(device)!);
    }

    // What to call the spot: the nearest room, or on the real map the nearest phone that has a label.
    let roomId: string | null = null;
    let bestLabel: string | null = null;
    if (origin) {
      const labeled = shot
        .filter((d) => d.placeLabel)
        .map((d) => ({ label: d.placeLabel!, dist: Math.hypot(d.pos.x - x, d.pos.y - y) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (labeled) bestLabel = labeled.dist > FAR_FROM_LABEL_M ? `${Math.round(labeled.dist)} m from ${labeled.label}` : labeled.label;
    } else {
      const room = nearestRoom(x, y, rooms as Room[]);
      roomId = room?.id ?? null;
      bestLabel = room?.name ?? null;
    }
    const best: LatLng | null = origin ? toLatLng({ x, y }, origin) : null;

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
        best_lat: best?.lat ?? null,
        best_lng: best?.lng ?? null,
        best_room_id: roomId,
        best_label: bestLabel,
        heatmap,
        trail,
        detection_count: count ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", incident.id);
    if (updErr) throw updErr;

    // 7.
    return json({
      incidentId: incident.id,
      estimate: { x, y, lat: best?.lat ?? null, lng: best?.lng ?? null, roomId, label: bestLabel, deviceCount: shot.length },
    });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
