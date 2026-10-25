import { failFrom, json } from "@/lib/http";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export async function POST(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const { error } = await db()
      .from("timing_calibrations")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("space_id", space.id)
      .eq("status", "listening");
    if (error) throw error;
    return json({ ok: true });
  } catch (e) {
    return failFrom(e);
  }
}
