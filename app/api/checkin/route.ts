import { z } from "zod";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

const Body = z.object({
  deviceId: z.uuid().optional(),
  roomId: z.string().min(1),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  clockOffsetMs: z.number(),
});

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, roomId, lat, lng, clockOffsetMs } = parsed.data;

  try {
    const { data: room, error: roomErr } = await db().from("rooms").select("id").eq("id", roomId).maybeSingle();
    if (roomErr) return fail(roomErr.message, 500);
    if (!room) return fail(`Unknown roomId: ${roomId}`);

    const { data, error } = await db()
      .from("devices")
      .upsert({
        id: deviceId ?? crypto.randomUUID(),
        room_id: roomId,
        lat: lat ?? null,
        lng: lng ?? null,
        clock_offset_ms: clockOffsetMs,
        last_seen: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) return fail(error.message, 500);

    return json({ deviceId: data.id });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
