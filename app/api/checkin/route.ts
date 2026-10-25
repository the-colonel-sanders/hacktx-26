import { z } from "zod";
import { inBounds, nearestRoom, type Room } from "@/lib/floorplan";
import { MAX_GPS_ACCURACY_M } from "@/lib/geo";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { spaceFromRequest, touchSpace } from "@/lib/spaces";
import { db } from "@/lib/supabase";

// Check in on the demo floor plan — by room (position = room center) or exact x/y in meters (room = nearest one) —
// or on the real map by lat/lng, with the accuracy radius the browser reported (or a hand-placed pin's).
const Body = z
  .object({
    deviceId: z.uuid().optional(),
    roomId: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    accuracyM: z.number().positive().optional(),
    label: z.string().trim().max(60).optional(),
    clockOffsetMs: z.number(),
    clockRttMs: z.number().nonnegative().optional(),
  })
  .refine((b) => (b.x == null) === (b.y == null), { message: "Send both x and y, or neither" })
  .refine((b) => (b.lat == null) === (b.lng == null), { message: "Send both lat and lng, or neither" })
  .refine((b) => [b.roomId != null, b.x != null, b.lat != null].filter(Boolean).length === 1, {
    message: "Send exactly one of roomId, x/y or lat/lng",
  })
  .refine((b) => b.x == null || inBounds(b.x, b.y!), { message: "x/y is outside the floor plan" })
  .refine((b) => b.lat == null || b.accuracyM != null, { message: "Send accuracyM with lat/lng" })
  .refine((b) => b.accuracyM == null || b.accuracyM <= MAX_GPS_ACCURACY_M, {
    message: `Location is too rough (over ±${MAX_GPS_ACCURACY_M} m). Place the pin on the map by hand.`,
  });

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, x, y, lat, lng, accuracyM, label, clockOffsetMs, clockRttMs } = parsed.data;

  try {
    // A phone belongs to the space it last checked in to.
    const space = await spaceFromRequest(req);
    let roomId: string | null = null;
    if (lat == null) {
      const { data: rooms, error: roomErr } = await db().from("rooms").select("id, name, x, y");
      if (roomErr) return fail(roomErr.message, 500);
      roomId = parsed.data.roomId ?? null;
      if (roomId && !rooms.some((r) => r.id === roomId)) return fail(`Unknown roomId: ${roomId}`);
      roomId ??= nearestRoom(x!, y!, rooms as Room[])?.id ?? null;
      if (!roomId) return fail("No rooms are set up", 500);
    }

    const frame = lat == null ? "grid" : "geo";
    const { data, error } = await db()
      .from("devices")
      .upsert({
        id: deviceId ?? crypto.randomUUID(),
        space_id: space.id,
        frame,
        room_id: roomId,
        x: x ?? null,
        y: y ?? null,
        lat: lat ?? null,
        lng: lng ?? null,
        pos_accuracy_m: accuracyM ?? null,
        place_label: label || null,
        clock_offset_ms: clockOffsetMs,
        clock_rtt_ms: clockRttMs ?? null,
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return fail(error.message, 500);
    await touchSpace(space.id);

    return json({ deviceId: data.id, space: space.code, frame, roomId, x: x ?? null, y: y ?? null, lat: lat ?? null, lng: lng ?? null });
  } catch (e) {
    return failFrom(e);
  }
}
