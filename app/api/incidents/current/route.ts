import { fail, json } from "@/lib/http";
import { getActiveIncident } from "@/lib/incidents";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const incident = await getActiveIncident();
    if (!incident) return json(null);

    const { data: detections, error } = await db()
      .from("detections")
      .select("*")
      .eq("incident_id", incident.id)
      .order("spike_ts_ms");
    if (error) throw error;

    return json({ ...incident, detections });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
