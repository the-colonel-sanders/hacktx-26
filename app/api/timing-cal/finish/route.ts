import { toLocal } from "@/lib/geo";
import { fail, json } from "@/lib/http";
import { timingBiases } from "@/lib/localize";
import { db } from "@/lib/supabase";
import { getActiveTimingCal, type TimingResult } from "@/lib/timingCal";

// Compute each phone's timing bias from the reports and fold it into devices.time_offset_ms.
export async function POST() {
  try {
    const cal = await getActiveTimingCal();
    if (!cal) return fail("No timing calibration is running", 409);

    const { data: reports, error } = await db()
      .from("timing_cal_reports")
      .select("device_id, x, y, lat, lng, spike_ts_ms, devices(time_offset_ms)")
      .eq("calibration_id", cal.id);
    if (error) throw error;
    if (reports.length < 2) return fail(`Need at least 2 phones to hear the reference sound (got ${reports.length})`);

    // On the real map, measure in meters east/north of the reference spot.
    const geo = cal.frame === "geo";
    const ref = { lat: cal.lat!, lng: cal.lng! };
    const biases = timingBiases(
      geo ? { x: 0, y: 0 } : { x: cal.x!, y: cal.y! },
      reports.map((r) => ({
        deviceId: r.device_id,
        ...(geo ? toLocal({ lat: r.lat, lng: r.lng }, ref) : { x: r.x, y: r.y }),
        spikeTsMs: r.spike_ts_ms,
      })),
    );
    const results: TimingResult[] = biases.map((b) => {
      const r = reports.find((rep) => rep.device_id === b.deviceId)!;
      const prevOffset = (r.devices as unknown as { time_offset_ms: number } | null)?.time_offset_ms ?? 0;
      return {
        deviceId: b.deviceId,
        x: r.x,
        y: r.y,
        lat: r.lat,
        lng: r.lng,
        distanceM: b.distanceM,
        biasMs: b.biasMs,
        offsetMs: prevOffset + b.biasMs,
      };
    });

    const calibratedAt = new Date().toISOString();
    for (const r of results) {
      const { error: updErr } = await db()
        .from("devices")
        .update({ time_offset_ms: r.offsetMs, time_calibrated_at: calibratedAt })
        .eq("id", r.deviceId);
      if (updErr) throw updErr;
    }
    const { data: done, error: doneErr } = await db()
      .from("timing_calibrations")
      .update({ status: "done", finished_at: new Date().toISOString(), results })
      .eq("id", cal.id)
      .select("*")
      .single();
    if (doneErr) throw doneErr;
    return json(done);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
