import { z } from "zod";
import { fail, failFrom, json, parseBody } from "@/lib/http";
import { PhoneSettings, resolveSettings } from "@/lib/phoneSettings";
import { applyToAllPhones, applyToPhone, getAllPhonesSettings } from "@/lib/phoneSettingsStore";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// A phone reads what it should do. Before its first check-in (no deviceId yet) it gets the all-phones settings.
export async function GET(req: Request) {
  const deviceId = new URL(req.url).searchParams.get("deviceId");
  try {
    const device =
      deviceId && z.uuid().safeParse(deviceId).success
        ? await db().from("devices").select("settings, mic_cal_requested_at, space_id").eq("id", deviceId).maybeSingle()
        : { data: null, error: null };
    if (device.error) throw device.error;
    // A checked-in phone follows its own space's settings; before check-in, the space it's joining.
    const allPhones = await getAllPhonesSettings(device.data?.space_id ?? (await spaceFromRequest(req)).id);
    return json({
      settings: resolveSettings(allPhones, device.data?.settings),
      micCalRequestedAt: device.data?.mic_cal_requested_at ?? null,
    });
  } catch (e) {
    return failFrom(e);
  }
}

const Body = z.object({
  target: z.union([z.literal("all"), z.uuid()]),
  patch: PhoneSettings.partial().refine((p) => Object.keys(p).length > 0, { message: "Nothing to change" }),
});

// The admin panel changes settings for one phone, or for all of them.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  const { target, patch } = parsed.data;
  try {
    if (target === "all") await applyToAllPhones((await spaceFromRequest(req)).id, patch);
    else if (!(await applyToPhone(target, patch))) return fail("Unknown phone", 404);
    return json({ ok: true });
  } catch (e) {
    return failFrom(e);
  }
}
