"use client";

import { MAX_GPS_ACCURACY_M, toLocal } from "@/lib/geo";

// Follow the phone on the real map while it listens: if the person carrying it walks away, re-check
// in at the new spot so later detections (each stores where its phone was) use the right position.
//
// Indoor GPS wanders 10–30 m even when the phone is still, so a move only counts when it is bigger
// than both positions' uncertainty. A hand-placed pin (±4 m) is therefore only replaced by a GPS
// fix after a clear move, and small wobbles never touch it.

export type MapLocation = { lat: number; lng: number; accuracyM: number; label?: string };

export type FollowInfo = { lastFixAccuracyM: number; lastFixAt: number; movedM: number } | null;

const MIN_MOVE_M = 8; // never treat less than this as a move
const MIN_UPDATE_GAP_MS = 10_000; // at most one re-check-in per 10 s
const REFINE_RATIO = 0.6; // a GPS spot is refined in place by a fix this much more accurate

export function startFollowing(opts: {
  current: () => MapLocation;
  onFix: (info: FollowInfo) => void;
  onMove: (to: MapLocation, movedM: number, refine: boolean) => Promise<void>;
}): () => void {
  if (!("geolocation" in navigator)) return () => {};
  let busy = false;
  let lastUpdate = 0;

  const id = navigator.geolocation.watchPosition(
    async ({ coords }) => {
      const here = opts.current();
      const fix = { lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy };
      const d = toLocal(fix, here);
      const movedM = Math.hypot(d.x, d.y);
      opts.onFix({ lastFixAccuracyM: fix.accuracyM, lastFixAt: Date.now(), movedM });

      if (busy || fix.accuracyM > MAX_GPS_ACCURACY_M || Date.now() - lastUpdate < MIN_UPDATE_GAP_MS) return;
      const moved = movedM > Math.max(MIN_MOVE_M, fix.accuracyM + here.accuracyM);
      // Not moved, but a much better fix for a GPS-placed spot (pins are already better than GPS).
      const refine = !moved && fix.accuracyM < here.accuracyM * REFINE_RATIO && movedM <= here.accuracyM;
      if (!moved && !refine) return;

      busy = true;
      lastUpdate = Date.now();
      try {
        // A label like "Room 214" names the old spot; drop it after a real move.
        await opts.onMove(moved ? fix : { ...fix, ...(here.label ? { label: here.label } : {}) }, movedM, refine);
      } catch {
        // Network hiccup: the next fix tries again.
      } finally {
        busy = false;
      }
    },
    () => opts.onFix(null),
    { enableHighAccuracy: true, maximumAge: 5_000, timeout: 30_000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}
