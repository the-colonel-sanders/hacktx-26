import { z } from "zod";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";
import { getActiveTimingCal } from "@/lib/timingCal";

const Body = z.object({ deviceId: z.uuid(), localSpikeTsMs: z.number(), peakDb: z.number() });

// A phone heard the reference sound. If it reports more than once, keep the loudest spike.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, localSpikeTsMs, peakDb } = parsed.data;

  try {
    const cal = await getActiveTimingCal();
    if (!cal) return fail("No timing calibration is running", 409);

    const { data: device, error: devErr } = await db().from("devices").select("*").eq("id", deviceId).maybeSingle();
    if (devErr) throw devErr;
    if (!device) return fail("Unknown deviceId", 404);
    // A room-center position is meters off, which would be baked into the bias as fake delay.
    if (device.x == null || device.y == null) return fail("Timing calibration needs a phone checked in at an exact spot");

    const { data: prev, error: prevErr } = await db()
      .from("timing_cal_reports")
      .select("peak_db")
      .eq("calibration_id", cal.id)
      .eq("device_id", deviceId)
      .maybeSingle();
    if (prevErr) throw prevErr;
    if (prev && prev.peak_db >= peakDb) return json({ calibrationId: cal.id, kept: "earlier, louder report" });

    const { error } = await db().from("timing_cal_reports").upsert({
      calibration_id: cal.id,
      device_id: deviceId,
      x: device.x,
      y: device.y,
      spike_ts_ms: localSpikeTsMs + device.clock_offset_ms - device.time_offset_ms,
      peak_db: peakDb,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ calibrationId: cal.id, kept: "this report" });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
