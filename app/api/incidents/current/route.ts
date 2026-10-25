import { positionOf, type Room } from "@/lib/floorplan";
import { fail, json } from "@/lib/http";
import { getActiveIncident } from "@/lib/incidents";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ACTIVE_DEVICE_MS = 15 * 60_000; // phones re-check-in every 3 min

export async function GET() {
  try {
    const incident = await getActiveIncident();
    if (!incident) return json(null);

    const since = new Date(Date.now() - ACTIVE_DEVICE_MS).toISOString();
    // Only phones on the incident's map (all of them while it has none yet).
    let devicesQuery = db()
      .from("devices")
      .select("id, frame, room_id, x, y, lat, lng, pos_accuracy_m, place_label")
      .gte("last_seen", since);
    if (incident.frame) devicesQuery = devicesQuery.eq("frame", incident.frame);
    const [{ data: detections, error }, { data: devices, error: devErr }, { data: rooms, error: roomsErr }] =
      await Promise.all([
        db().from("detections").select("*").eq("incident_id", incident.id).order("spike_ts_ms"),
        devicesQuery,
        db().from("rooms").select("id, name, x, y"),
      ]);
    if (error) throw error;
    if (devErr) throw devErr;
    if (roomsErr) throw roomsErr;

    // Resolve every floor-plan position (exact x/y, else room center) so clients don't have to. Map rows keep lat/lng.
    const roomById = new Map((rooms as Room[]).map((r) => [r.id, r]));
    const withPos = <T extends { x: number | null; y: number | null; room_id: string | null }>(row: T) => ({
      ...row,
      ...positionOf(row, roomById),
    });

    return json({ ...incident, detections: detections.map(withPos), devices: devices.map(withPos) });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
