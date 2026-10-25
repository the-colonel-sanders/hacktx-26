import { failFrom, json } from "@/lib/http";
import { DEFAULT_SPACE_ID, spaceFromRequest } from "@/lib/spaces";

export const dynamic = "force-dynamic";

// Which demo space this browser is in. Phones use the id to filter Realtime updates.
export async function GET(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    return json({ ...space, shared: space.id === DEFAULT_SPACE_ID });
  } catch (e) {
    return failFrom(e);
  }
}
