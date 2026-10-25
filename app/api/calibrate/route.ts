import { z } from "zod";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { REFERENCE_DB } from "@/lib/localize";
import { db } from "@/lib/supabase";

const Body = z.object({ deviceId: z.uuid(), peakDb: z.number() });

export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, peakDb } = parsed.data;

  try {
    const gainOffsetDb = peakDb - REFERENCE_DB;
    const { data, error } = await db()
      .from("devices")
      .update({ gain_offset_db: gainOffsetDb, gain_calibrated_at: new Date().toISOString(), last_seen: new Date().toISOString() })
      .eq("id", deviceId)
      .select("id");
    if (error) return fail(error.message, 500);
    if (!data.length) return fail("Unknown deviceId", 404);

    return json({ deviceId, gainOffsetDb });
  } catch (e) {
    return failFrom(e);
  }
}
