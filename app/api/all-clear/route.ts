import { fail, json } from "@/lib/http";
import { db } from "@/lib/supabase";

export async function POST() {
  try {
    const { data, error } = await db()
      .from("incidents")
      .update({ status: "cleared", updated_at: new Date().toISOString() })
      .eq("status", "active")
      .select("id");
    if (error) return fail(error.message, 500);

    const incidentId = data[0]?.id ?? null;
    const { error: alertErr } = await db().from("alerts").insert({ incident_id: incidentId, type: "all_clear" });
    if (alertErr) return fail(alertErr.message, 500);

    return json({ incidentId });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
