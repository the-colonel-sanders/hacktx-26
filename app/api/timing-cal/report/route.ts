import { z } from "zod";
import { CAL_MAX_ACCURACY_M } from "@/lib/geo";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";
import { getActiveTimingCal } from "@/lib/timingCal";

const Body = z.object({ deviceId: z.uuid(), localSpikeTsMs: z.number(), peakDb: z.number() });

// A phone heard the reference sound. If it reports more than once, keep the loudest spike.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { deviceId, localSpikeTsMs, peakDb } = parsed.data;

  try {
    const { data: device, error: devErr } = await db().from("devices").select("*").eq("id", deviceId).maybeSingle();
    if (devErr) throw devErr;
    if (!device) return fail("Unknown deviceId", 404);

    // The calibration running in this phone's space.
    const cal = await getActiveTimingCal(device.space_id);
    if (!cal) return fail("No timing calibration is running", 409);
    if ((device.frame ?? "grid") !== cal.frame) {
      return fail(`This calibration is on the ${cal.frame === "geo" ? "real map" : "demo floor plan"}; check in the same way`);
    }
    // A rough position is meters off, which would be baked into the bias as fake delay.
    const rough =
      cal.frame === "grid"
        ? device.x == null || device.y == null
        : device.pos_accuracy_m == null || device.pos_accuracy_m > CAL_MAX_ACCURACY_M;
    if (rough) {
      return fail(
        cal.frame === "grid"
          ? "Timing calibration needs a phone checked in at an exact spot"
          : `Timing calibration needs a map position within ±${CAL_MAX_ACCURACY_M} m: place the pin by hand`,
      );
    }

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
      lat: device.lat,
      lng: device.lng,
      spike_ts_ms: localSpikeTsMs + device.clock_offset_ms - device.time_offset_ms,
      peak_db: peakDb,
      created_at: new Date().toISOString(),
    });
    if (error) throw error;
    return json({ calibrationId: cal.id, kept: "this report" });
  } catch (e) {
    return failFrom(e);
  }
}
