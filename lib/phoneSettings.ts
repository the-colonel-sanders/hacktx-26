import { z } from "zod";

// Settings each phone follows, set from the admin panel (/admin). A phone uses these defaults,
// overridden by the all-phones settings, overridden by its own.
export const PhoneSettings = z.object({
  // How the phone says where it is. The phone still picks the room / spot / pin itself.
  locationMode: z.enum(["room", "spot", "map"]),
  lockdownScreen: z.boolean(), // take over the screen and vibrate when an alert is raised
  followLocation: z.boolean(), // real map only: re-check in when GPS shows the phone clearly moved
  timingMethod: z.enum(["output", "current"]), // see TimingMethod in app/phone/audio.ts
  showSimulate: z.boolean(), // show the "Simulate shot" testing button
  simulateDb: z.number().min(-80).max(0), // loudness a simulated shot reports
  simulateDelayMs: z.number().min(0).max(250), // how long after the shot this phone "hears" it
});
export type PhoneSettings = z.infer<typeof PhoneSettings>;
export type LocationMode = PhoneSettings["locationMode"];

export const DEFAULT_PHONE_SETTINGS: PhoneSettings = {
  locationMode: "room",
  lockdownScreen: false,
  followLocation: true,
  timingMethod: "output",
  showSimulate: true,
  simulateDb: -15,
  simulateDelayMs: 0,
};

export const LOCATION_MODE_NAMES: Record<LocationMode, string> = { room: "Room", spot: "Exact spot", map: "Real map" };
export const TIMING_METHOD_NAMES: Record<PhoneSettings["timingMethod"], string> = {
  output: "Output timestamp",
  current: "Current time",
};

/** Layer partial settings over the defaults, later layers winning. Unknown or invalid values are ignored. */
export function resolveSettings(...layers: unknown[]): PhoneSettings {
  const out: Record<string, unknown> = { ...DEFAULT_PHONE_SETTINGS };
  for (const layer of layers) {
    if (!layer || typeof layer !== "object") continue;
    for (const [key, value] of Object.entries(layer)) {
      const field = PhoneSettings.shape[key as keyof PhoneSettings];
      if (field?.safeParse(value).success) out[key] = value;
    }
  }
  return out as PhoneSettings;
}

/** The mode a phone is actually checked in with, from its devices row. */
export const checkedInMode = (d: { frame?: string | null; x?: number | null }): LocationMode =>
  d.frame === "geo" ? "map" : d.x != null ? "spot" : "room";
