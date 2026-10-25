import { fail, failFrom, json } from "@/lib/http";
import { db } from "@/lib/supabase";
import { spaceFromRequest } from "@/lib/spaces";
import { getActiveTimingCal } from "@/lib/timingCal";

export const dynamic = "force-dynamic";

// The active timing calibration (with phones that have reported so far), plus the last finished one.
export async function GET(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const [active, { data: last, error }] = await Promise.all([
      getActiveTimingCal(space.id),
      db().from("timing_calibrations").select("*").eq("space_id", space.id).eq("status", "done").order("finished_at", { ascending: false }).limit(1),
    ]);
    if (error) throw error;

    let reports: unknown[] = [];
    if (active) {
      const { data, error: repErr } = await db()
        .from("timing_cal_reports")
        .select("device_id, x, y, lat, lng, peak_db, created_at")
        .eq("calibration_id", active.id)
        .order("created_at");
      if (repErr) throw repErr;
      reports = data;
    }
    return json({ active, reports, last: last[0] ?? null });
  } catch (e) {
    return failFrom(e);
  }
}
