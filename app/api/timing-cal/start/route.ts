import { z } from "zod";
import { inBounds } from "@/lib/floorplan";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

const Body = z
  .object({ x: z.number(), y: z.number() })
  .refine((b) => inBounds(b.x, b.y), { message: "x/y is outside the floor plan" });

// Start listening for the reference sound at (x, y). Replaces any calibration still listening.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;

  try {
    const { error: cancelErr } = await db()
      .from("timing_calibrations")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("status", "listening");
    if (cancelErr) throw cancelErr;

    const { data, error } = await db().from("timing_calibrations").insert(parsed.data).select("*").single();
    if (error) throw error;
    return json(data);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
