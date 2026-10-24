import { fail, json } from "@/lib/http";
import { getOrCreateActiveIncident } from "@/lib/incidents";
import { db } from "@/lib/supabase";

export async function POST() {
  try {
    const { incident, created } = await getOrCreateActiveIncident();
    // A brand-new incident already got its alert row.
    if (!created) {
      const { error } = await db().from("alerts").insert({ incident_id: incident.id, type: "alert" });
      if (error) throw error;
    }
    return json({ incidentId: incident.id });
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
