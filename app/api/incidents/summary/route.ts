import { fail, json } from "@/lib/http";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// What a phone needs to know: is there an alert, and roughly where. A few hundred bytes,
// versus the dashboard's /api/incidents/current with the heatmap and every detection.
export async function GET() {
  try {
    const { data, error } = await db()
      .from("incidents")
      .select("id, status, started_at, updated_at, frame, best_room_id, best_label, best_lat, best_lng, detection_count")
      .eq("status", "active")
      .maybeSingle();
    if (error) throw error;
    return json(data);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
