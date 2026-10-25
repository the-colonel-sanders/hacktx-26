import { z } from "zod";
import { inBounds } from "@/lib/floorplan";
import { fail, json, parseBody } from "@/lib/http";
import { db } from "@/lib/supabase";

// The reference spot: x/y on the floor plan, or lat/lng on the real map.
const Body = z.union([
  z.object({ x: z.number(), y: z.number() }).refine((b) => inBounds(b.x, b.y), { message: "x/y is outside the floor plan" }),
  z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
]);

// Start listening for the reference sound at that spot. Replaces any calibration still listening.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const spot = parsed.data;

  try {
    const { error: cancelErr } = await db()
      .from("timing_calibrations")
      .update({ status: "cancelled", finished_at: new Date().toISOString() })
      .eq("status", "listening");
    if (cancelErr) throw cancelErr;

    const { data, error } = await db()
      .from("timing_calibrations")
      .insert("lat" in spot ? { frame: "geo", lat: spot.lat, lng: spot.lng } : { frame: "grid", x: spot.x, y: spot.y })
      .select("*")
      .single();
    if (error) throw error;
    return json(data);
  } catch (e) {
    return fail((e as Error).message, 500);
  }
}
