import { fail, failFrom, json } from "@/lib/http";
import { checkedInMode, resolveSettings } from "@/lib/phoneSettings";
import { getAllPhonesSettings } from "@/lib/phoneSettingsStore";
import { spaceFromRequest } from "@/lib/spaces";
import { db } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const ACTIVE_PHONE_MS = 15 * 60_000; // phones re-check in every minute while listening

// For the admin panel's Phones table: every recently active phone, where it's checked in, and its settings.
export async function GET(req: Request) {
  try {
    const space = await spaceFromRequest(req);
    const since = new Date(Date.now() - ACTIVE_PHONE_MS).toISOString();
    const [allPhones, { data: devices, error }] = await Promise.all([
      getAllPhonesSettings(space.id),
      db()
        .from("devices")
        .select(
          "id, frame, room_id, x, y, lat, lng, pos_accuracy_m, place_label, last_seen, settings, gain_offset_db, gain_calibrated_at, mic_cal_requested_at, time_calibrated_at",
        )
        .eq("space_id", space.id)
        .gte("last_seen", since)
        .order("last_seen", { ascending: false }),
    ]);
    if (error) throw error;

    return json({
      allPhones: resolveSettings(allPhones),
      phones: devices.map((d) => ({
        id: d.id,
        lastSeen: d.last_seen,
        checkedIn: {
          mode: checkedInMode(d),
          roomId: d.room_id,
          x: d.x,
          y: d.y,
          lat: d.lat,
          lng: d.lng,
          accuracyM: d.pos_accuracy_m,
          label: d.place_label,
        },
        settings: resolveSettings(allPhones, d.settings),
        ownSettings: Object.keys(d.settings ?? {}), // which settings differ from the all-phones row
        gainOffsetDb: d.gain_offset_db,
        gainCalibratedAt: d.gain_calibrated_at,
        micCalRequestedAt: d.mic_cal_requested_at,
        timeCalibrated: d.time_calibrated_at != null,
      })),
    });
  } catch (e) {
    return failFrom(e);
  }
}
