import { fail, json } from "@/lib/http";
import { db } from "@/lib/supabase";
import { getActiveTimingCal } from "@/lib/timingCal";

export const dynamic = "force-dynamic";

// The active timing calibration (with phones that have reported so far), plus the last finished one.
export async function GET() {
  try {
    const [active, { data: last, error }] = await Promise.all([
      getActiveTimingCal(),
      db().from("timing_calibrations").select("*").eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    ]);
    if (error) throw error;

    let reports: unknown[] = [];
    if (active) {
      const { data, error: repErr } = await db()
        .from("timing_cal_reports")
        .select("device_id, x, y, peak_db, created_at")
        .eq("calibration_id", active.id)
        .order("created_at");
      if (repErr) throw repErr;
      reports = data;
    }
    return json({ active, reports, last: last[0] ?? null });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
