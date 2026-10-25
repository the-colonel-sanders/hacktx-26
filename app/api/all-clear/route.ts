import { fail, failFrom, json } from "@/lib/http";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const { data, error } = await db()
      .from("incidents")
      .update({ status: "cleared", updated_at: new Date().toISOString() })
      .eq("space_id", space.id)
      .eq("status", "active")
      .select("id");
    if (error) return fail(error.message, 500);

    const incidentId = data[0]?.id ?? null;
    const { error: alertErr } = await db().from("alerts").insert({ incident_id: incidentId, space_id: space.id, type: "all_clear" });
    if (alertErr) return fail(alertErr.message, 500);

    return json({ incidentId });
  } catch (e) {
    return failFrom(e);
  }
}
