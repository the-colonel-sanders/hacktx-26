import "server-only";
import { FLOOR_BOUNDS, nearestRoom, positionOf, type Room } from "./floorplan";
import { boundsAround, posSigmaM, toLatLng, toLocal, type LatLng } from "./geo";
import type { Incident, TrailPoint } from "./incidents";
import { CLIP_DB, GRID_RESOLUTION_M, SHOT_WINDOW_MS, gridSearch, groupShot, timeSigmaMs, type Heatmap } from "./localize";
import { db } from "./supabase";

// When many phones hear one shot, their reports land within a few hundred ms of each other.
// Running the grid search once per report would repeat the same work for every phone (and the
// writes would race), so one request at a time holds a lease on the incident and processes every
// detection that arrived since the last run, looping until none are left.
const LEASE_MS = 15_000; // longer than any run; expires if a request dies mid-run
const MAX_ROUNDS = 10;
const FAR_FROM_LABEL_M = 15; // beyond this, say "N m from <label>" instead of just the label

type IncidentRow = Pick<Incident, "id" | "frame" | "origin_lat" | "origin_lng" | "trail"> & { loc_done_at: string | null };

async function claim(incidentId: string): Promise<boolean> {
  const now = new Date();
  const { data, error } = await db()
    .from("incidents")
    .update({ loc_lease_until: new Date(now.getTime() + LEASE_MS).toISOString() })
    .eq("id", incidentId)
    .or(`loc_lease_until.is.null,loc_lease_until.lt.${now.toISOString()}`)
    .select("id");
  if (error) throw error;
  return data.length > 0;
}

async function release(incidentId: string) {
  const { error } = await db().from("incidents").update({ loc_lease_until: null }).eq("id", incidentId);
  if (error) throw error;
}

async function freshDetections(incidentId: string, doneAt: string | null) {
  let q = db().from("detections").select("spike_ts_ms, created_at").eq("incident_id", incidentId);
  if (doneAt) q = q.gt("created_at", doneAt);
  const { data, error } = await q.order("created_at");
  if (error) throw error;
  return data as { spike_ts_ms: number; created_at: string }[];
}

/**
 * Localize every shot with detections newer than the last run. Returns false if another request
 * holds the lease (it will pick these detections up before it lets go).
 */
export async function localizePending(incidentId: string): Promise<boolean> {
  if (!(await claim(incidentId))) return false;
  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const { data: incident, error } = await db()
        .from("incidents")
        .select("id, frame, origin_lat, origin_lng, trail, loc_done_at")
        .eq("id", incidentId)
        .single();
      if (error) throw error;
      const fresh = await freshDetections(incidentId, incident.loc_done_at);
      if (!fresh.length) break;

      // Usually one shot; a burst of shots or a late report for an earlier one can make several.
      const anchors: number[] = [];
      for (const ts of fresh.map((d) => d.spike_ts_ms).sort((a, b) => a - b)) {
        if (!anchors.length || ts - anchors[anchors.length - 1] > SHOT_WINDOW_MS) anchors.push(ts);
      }
      await localizeShots(incident as IncidentRow, anchors);

      const { error: doneErr } = await db()
        .from("incidents")
        .update({ loc_done_at: fresh[fresh.length - 1].created_at })
        .eq("id", incidentId);
      if (doneErr) throw doneErr;
    }
  } finally {
    await release(incidentId);
  }
  // A report may have landed after our last check but before the release, when its own request
  // couldn't take the lease. Pick it up now.
  const { data: after, error } = await db().from("incidents").select("loc_done_at").eq("id", incidentId).single();
  if (error) throw error;
  if ((await freshDetections(incidentId, after.loc_done_at)).length) await localizePending(incidentId);
  return true;
}

async function localizeShots(incident: IncidentRow, anchors: number[]) {
  const origin: LatLng | null =
    incident.frame === "geo" ? { lat: incident.origin_lat!, lng: incident.origin_lng! } : null;

  const [{ data: rooms, error: roomsErr }, { count, error: countErr }] = await Promise.all([
    origin ? Promise.resolve({ data: [], error: null }) : db().from("rooms").select("id, name, x, y"),
    db().from("detections").select("id", { count: "exact", head: true }).eq("incident_id", incident.id),
  ]);
  if (roomsErr) throw roomsErr;
  if (countErr) throw countErr;
  const roomById = new Map((rooms as Room[]).map((r) => [r.id, r]));

  // Positions in meters: the floor plan's own, or east/north of the incident's origin.
  const locate = (row: { x: number | null; y: number | null; lat: number | null; lng: number | null; room_id: string | null }) =>
    origin
      ? row.lat != null && row.lng != null
        ? toLocal({ lat: row.lat, lng: row.lng }, origin)
        : null
      : positionOf(row, roomById);

  const trail: TrailPoint[] = [...(incident.trail ?? [])];
  let latest: { shotTs: number; x: number; y: number; roomId: string | null; label: string | null; heatmap: Heatmap | null } | null =
    null;

  for (const anchor of anchors) {
    const { data: nearby, error: nearErr } = await db()
      .from("detections")
      .select(
        "device_id, room_id, x, y, lat, lng, pos_sigma_m, spike_ts_ms, raw_peak_db, norm_peak_db, time_sigma_ms, devices(place_label)",
      )
      .eq("incident_id", incident.id)
      .gte("spike_ts_ms", anchor - SHOT_WINDOW_MS)
      .lte("spike_ts_ms", anchor + SHOT_WINDOW_MS);
    if (nearErr) throw nearErr;

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
      anchor,
    ).filter((d) => d.pos);
    if (!shot.length) continue;

    // Localize. On the real map, search around the phones that heard it. One phone: its own spot.
    let x: number;
    let y: number;
    let heatmap: Heatmap | null = null;
    if (shot.length >= 2) {
      const area = origin ? boundsAround(shot.map((d) => d.pos)) : { bounds: FLOOR_BOUNDS, resolution: GRID_RESOLUTION_M };
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
      ({ x, y, heatmap } = est);
    } else {
      ({ x, y } = shot[0].pos);
    }

    // What to call the spot: the nearest room, or on the real map the nearest phone that has a label.
    let roomId: string | null = null;
    let label: string | null = null;
    if (origin) {
      const labeled = shot
        .filter((d) => d.placeLabel)
        .map((d) => ({ label: d.placeLabel!, dist: Math.hypot(d.pos.x - x, d.pos.y - y) }))
        .sort((a, b) => a.dist - b.dist)[0];
      if (labeled) label = labeled.dist > FAR_FROM_LABEL_M ? `${Math.round(labeled.dist)} m from ${labeled.label}` : labeled.label;
    } else {
      const room = nearestRoom(x, y, rooms as Room[]);
      roomId = room?.id ?? null;
      label = room?.name ?? null;
    }

    // A trail point within the shot window is the same shot, so refine it in place.
    const shotTs = Math.min(...shot.map((d) => d.spikeTsMs));
    const existing = trail.findIndex((p) => Math.abs(p.t - shotTs) <= SHOT_WINDOW_MS);
    if (existing >= 0) trail[existing] = { x, y, t: trail[existing].t };
    else trail.push({ x, y, t: shotTs });
    trail.sort((a, b) => a.t - b.t);

    if (!latest || shotTs > latest.shotTs) latest = { shotTs, x, y, roomId, label, heatmap };
  }

  // The incident shows the newest shot; a late report for an older shot only refines its trail point.
  const newestTrailTs = trail.length ? trail[trail.length - 1].t : -Infinity;
  const showLatest = latest && latest.shotTs >= newestTrailTs - SHOT_WINDOW_MS;
  const best = showLatest && origin ? toLatLng({ x: latest!.x, y: latest!.y }, origin) : null;

  const { error: updErr } = await db()
    .from("incidents")
    .update({
      ...(showLatest
        ? {
            best_x: latest!.x,
            best_y: latest!.y,
            best_lat: best?.lat ?? null,
            best_lng: best?.lng ?? null,
            best_room_id: latest!.roomId,
            best_label: latest!.label,
          }
        : {}),
      heatmap: null, // stored in incident_heatmaps; keep this row small for Realtime
      trail,
      detection_count: count ?? 0,
      updated_at: new Date().toISOString(),
    })
    .eq("id", incident.id);
  if (updErr) throw updErr;

  if (showLatest) {
    const { error: hmErr } = latest!.heatmap
      ? await db()
          .from("incident_heatmaps")
          .upsert({ incident_id: incident.id, heatmap: latest!.heatmap, updated_at: new Date().toISOString() })
      : await db().from("incident_heatmaps").delete().eq("incident_id", incident.id);
    if (hmErr) throw hmErr;
  }
}
