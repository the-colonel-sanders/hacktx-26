import { z } from "zod";
import { inBounds, nearestRoom, type Room } from "@/lib/floorplan";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

// Check in by room (position = room center) or by exact x/y in meters (room = nearest one).
const Body = z
  .object({
    deviceId: z.uuid().optional(),
    roomId: z.string().min(1).optional(),
    x: z.number().optional(),
    y: z.number().optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    clockOffsetMs: z.number(),
    clockRttMs: z.number().nonnegative().optional(),
  })
  .refine((b) => (b.x == null) === (b.y == null), { message: "Send both x and y, or neither" })
  .refine((b) => b.roomId != null || b.x != null, { message: "Send roomId or x/y" })
  .refine((b) => b.x == null || inBounds(b.x, b.y!), { message: "x/y is outside the floor plan" });

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, x, y, lat, lng, clockOffsetMs, clockRttMs } = parsed.data;

  try {
    const { data: rooms, error: roomErr } = await db().from("rooms").select("id, name, x, y");
    if (roomErr) return fail(roomErr.message, 500);

    let roomId = parsed.data.roomId;
    if (roomId && !rooms.some((r) => r.id === roomId)) return fail(`Unknown roomId: ${roomId}`);
    roomId ??= nearestRoom(x!, y!, rooms as Room[])?.id;
    if (!roomId) return fail("No rooms are set up", 500);

    const { data, error } = await db()
      .from("devices")
      .upsert({
        id: deviceId ?? crypto.randomUUID(),
        room_id: roomId,
        x: x ?? null,
        y: y ?? null,
        lat: lat ?? null,
        lng: lng ?? null,
        clock_offset_ms: clockOffsetMs,
        clock_rtt_ms: clockRttMs ?? null,
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return fail(error.message, 500);

    return json({ deviceId: data.id, roomId, x: x ?? null, y: y ?? null });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
