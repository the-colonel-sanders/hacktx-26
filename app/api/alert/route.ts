import { DEFAULT_CENTER } from "@/lib/geo";
import { failFrom, json } from "@/lib/http";
import { getOrCreateActiveIncident, type FrameInit } from "@/lib/incidents";
import { resolveSettings } from "@/lib/phoneSettings";
import { getAllPhonesSettings } from "@/lib/phoneSettingsStore";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

// A manual alert comes before any detection, which is what normally picks the incident's map. Use the
// map the admin panel has the phones on, so the dashboard doesn't fall back to the floor plan. On the
// real map, center it on the most recently seen phone there.
async function alertFrame(spaceId: string): Promise<FrameInit> {
  const { locationMode } = resolveSettings(await getAllPhonesSettings(spaceId));
  if (locationMode !== "map") return { frame: "grid" };
  const { data, error } = await db()
    .from("devices")
    .select("lat, lng")
    .eq("space_id", spaceId)
    .eq("frame", "geo")
    .not("lat", "is", null)
    .not("lng", "is", null)
    .order("last_seen", { ascending: false })
    .limit(1);
  if (error) throw error;
  const phone = data[0] as { lat: number; lng: number } | undefined;
  return { frame: "geo", origin: phone ?? DEFAULT_CENTER };
}

export async function POST(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const { incident, created } = await getOrCreateActiveIncident(space.id, await alertFrame(space.id));
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
