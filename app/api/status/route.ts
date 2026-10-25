import { z } from "zod";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

const Body = z.object({ deviceId: z.uuid(), status: z.enum(["safe", "need_help", "injured"]) });

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, status } = parsed.data;

  try {
    const { data: device, error: devErr } = await db().from("devices").select("room_id, space_id").eq("id", deviceId).maybeSingle();
    if (devErr) return fail(devErr.message, 500);
    if (!device) return fail("Unknown deviceId", 404);

    const { error } = await db()
      .from("statuses")
      .upsert({
        device_id: deviceId,
        space_id: device.space_id,
        room_id: device.room_id,
        status,
        updated_at: new Date().toISOString(),
      });
    if (error) return fail(error.message, 500);

    return json({ deviceId, roomId: device.room_id, status });
  } catch (e) {
    return failFrom(e);
  }
}
