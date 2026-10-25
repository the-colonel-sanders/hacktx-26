import { positionOf, type Room } from "@/lib/floorplan";
import { fail, failFrom, json } from "@/lib/http";
import { getActiveIncident } from "@/lib/incidents";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ACTIVE_DEVICE_MS = 15 * 60_000; // phones re-check-in every 3 min

export async function GET(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const incident = await getActiveIncident(space.id);
    if (!incident) return json(null);

    const since = new Date(Date.now() - ACTIVE_DEVICE_MS).toISOString();
    // Only phones on the incident's map (all of them while it has none yet).
    let devicesQuery = db()
      .from("devices")
      .select("id, frame, room_id, x, y, lat, lng, pos_accuracy_m, place_label")
      .eq("space_id", space.id)
      .gte("last_seen", since);
    if (incident.frame) devicesQuery = devicesQuery.eq("frame", incident.frame);
    const [
      { data: detections, error },
      { data: devices, error: devErr },
      { data: rooms, error: roomsErr },
      { data: statuses, error: stErr },
      { data: heatmapRow, error: hmErr },
    ] = await Promise.all([
      db().from("detections").select("*").eq("incident_id", incident.id).order("spike_ts_ms"),
      devicesQuery,
      db().from("rooms").select("id, name, x, y"),
      // Status reports sent during this incident (one row per phone, latest wins).
      db()
        .from("statuses")
        .select("device_id, status, updated_at, devices(frame, room_id, x, y, lat, lng, place_label)")
        .eq("space_id", space.id)
        .gte("updated_at", incident.started_at)
        .order("updated_at", { ascending: false }),
      db().from("incident_heatmaps").select("heatmap").eq("incident_id", incident.id).maybeSingle(),
    ]);
    if (error) throw error;
    if (devErr) throw devErr;
    if (roomsErr) throw roomsErr;
    if (stErr) throw stErr;
    if (hmErr) throw hmErr;

    // Resolve every floor-plan position (exact x/y, else room center) so clients don't have to. Map rows keep lat/lng.
    const roomById = new Map((rooms as Room[]).map((r) => [r.id, r]));
    const withPos = <T extends { x: number | null; y: number | null; room_id: string | null }>(row: T) => ({
      ...row,
      ...positionOf(row, roomById),
    });

    // Where each reporting phone is, in words responders can act on.
    type StatusDevice = {
      frame: string | null;
      room_id: string | null;
      x: number | null;
      y: number | null;
      lat: number | null;
      lng: number | null;
      place_label: string | null;
    };
    const roomName = (id: string | null) => roomById.get(id ?? "")?.name ?? id ?? "unknown room";
    const statusRows = statuses.map((st) => {
      const d = st.devices as unknown as StatusDevice | null;
      const place = !d
        ? "unknown location"
        : d.place_label
          ? d.place_label
          : d.frame === "geo" && d.lat != null && d.lng != null
            ? `${d.lat.toFixed(5)}, ${d.lng.toFixed(5)}`
            : d.x != null && d.y != null
              ? `(${d.x}, ${d.y}) m · near ${roomName(d.room_id)}`
              : roomName(d.room_id);
      return { device_id: st.device_id, status: st.status, updated_at: st.updated_at, place };
    });

    return json({
      ...incident,
      heatmap: heatmapRow?.heatmap ?? null,
      detections: detections.map(withPos),
      devices: devices.map(withPos),
      statuses: statusRows,
    });
  } catch (e) {
    return failFrom(e);
  }
}
