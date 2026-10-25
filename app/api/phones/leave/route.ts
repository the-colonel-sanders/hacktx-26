import { z } from "zod";
import { failFrom, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

const Body = z.object({ deviceId: z.uuid() });

// A phone's tab is closing (sent with navigator.sendBeacon). Backdating last_seen drops it from the
// admin panel and the dashboard right away instead of after ACTIVE_PHONE_MS; checking in again brings it back.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  try {
    const { error } = await db()
      .from("devices")
      .update({ last_seen: new Date(0).toISOString() })
      .eq("id", parsed.data.deviceId);
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    return failFrom(e);
  }
}
