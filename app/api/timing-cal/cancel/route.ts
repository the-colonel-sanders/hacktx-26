import { fail, json } from "@/lib/http";
import { db } from "@/lib/supabase";

export async function POST() {
  const { error } = await db()
    .from("timing_calibrations")
    .update({ status: "cancelled", finished_at: new Date().toISOString() })
    .eq("status", "listening");
  if (error) return fail(error.message, 500);
  return json({ ok: true });
}
