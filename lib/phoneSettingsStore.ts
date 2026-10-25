import "server-only";
import type { PhoneSettings } from "./phoneSettings";
import { DEFAULT_SPACE_ID } from "./spaces";
import { db } from "./supabase";

// One all-phones layer per demo space. The shared space keeps the key from before spaces existed.
const allPhonesKey = (spaceId: string) => (spaceId === DEFAULT_SPACE_ID ? "phone_defaults" : `phone_defaults:${spaceId}`);

/** The all-phones layer (only the keys set from the admin panel's "All phones" row) for one space. */
export async function getAllPhonesSettings(spaceId: string): Promise<Partial<PhoneSettings>> {
  const { data, error } = await db().from("app_settings").select("value").eq("key", allPhonesKey(spaceId)).maybeSingle();
  if (error) throw error;
  return (data?.value ?? {}) as Partial<PhoneSettings>;
}

/** Change a setting for every phone in a space: it goes into the all-phones layer and replaces any phone's own value. */
export async function applyToAllPhones(spaceId: string, patch: Partial<PhoneSettings>): Promise<void> {
  const current = await getAllPhonesSettings(spaceId);
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: allPhonesKey(spaceId), value: { ...current, ...patch }, updated_at: new Date().toISOString() });
  if (error) throw error;

  const keys = Object.keys(patch);
  const { data: devices, error: devErr } = await db().from("devices").select("id, settings").eq("space_id", spaceId);
  if (devErr) throw devErr;
  for (const d of devices as { id: string; settings: Record<string, unknown> | null }[]) {
    if (!d.settings || !keys.some((k) => k in d.settings!)) continue;
    const settings = Object.fromEntries(Object.entries(d.settings).filter(([k]) => !keys.includes(k)));
    const { error: updErr } = await db().from("devices").update({ settings }).eq("id", d.id);
    if (updErr) throw updErr;
  }
}

/** Change a setting for one phone only. Returns false if there's no such phone. */
export async function applyToPhone(deviceId: string, patch: Partial<PhoneSettings>): Promise<boolean> {
  const { data, error } = await db().from("devices").select("settings").eq("id", deviceId).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  const { error: updErr } = await db()
    .from("devices")
    .update({ settings: { ...(data.settings ?? {}), ...patch } })
    .eq("id", deviceId);
  if (updErr) throw updErr;
  return true;
}
