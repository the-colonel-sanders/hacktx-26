import { z } from "zod";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

const Body = z.object({ deviceId: z.uuid() });

// Ask a phone to calibrate its mic: it waits for the next clap (made about 1 m away) and reports it.
// One phone at a time: a single clap is a different distance from each phone.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  try {
    const { data, error } = await db()
      .from("devices")
      .update({ mic_cal_requested_at: new Date().toISOString() })
      .eq("id", parsed.data.deviceId)
      .select("id");
    if (error) throw error;
    if (!data.length) return fail("Unknown phone", 404);
    return json({ ok: true });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
