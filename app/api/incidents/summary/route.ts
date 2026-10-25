import { fail, failFrom, json } from "@/lib/http";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// What a phone needs to know: is there an alert, and roughly where. A few hundred bytes,
// versus the dashboard's /api/incidents/current with the heatmap and every detection.
export async function GET(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const { data, error } = await db()
      .from("incidents")
      .select("id, status, started_at, updated_at, frame, best_room_id, best_label, best_lat, best_lng, detection_count")
      .eq("space_id", space.id)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return json(data);
  } catch (e) {
    return failFrom(e);
  }
}
