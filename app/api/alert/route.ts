import { fail, failFrom, json } from "@/lib/http";
import { getOrCreateActiveIncident } from "@/lib/incidents";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const { incident, created } = await getOrCreateActiveIncident(space.id);
    // A brand-new incident already got its alert row.
    if (!created) {
      const { error } = await db().from("alerts").insert({ incident_id: incident.id, space_id: space.id, type: "alert" });
      if (error) throw error;
    }
    return json({ incidentId: incident.id });
  } catch (e) {
    return failFrom(e);
  }
}
