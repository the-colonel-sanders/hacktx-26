"use client";

import { useEffect, useState } from "react";
import type { GeoSpot } from "./GeoPicker";

const WATCH_MS = 30_000; // fixes usually tighten over the first several seconds, then stop improving

/**
 * While `active`, watches the phone's location and keeps the most accurate fix so far.
 * The browser asks for location permission the first time.
 */
export function useGpsFix(active: boolean): { fix: GeoSpot | null; error: string | null } {
  const [fix, setFix] = useState<GeoSpot | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!active) return;
    if (!("geolocation" in navigator)) {
      setError("This browser can't share its location. Tap the map to place this phone.");
      return;
    }
    setError(null);
    const id = navigator.geolocation.watchPosition(
      ({ coords }) =>
        setFix((prev) =>
          !prev || coords.accuracy <= prev.accuracyM
            ? { lat: coords.latitude, lng: coords.longitude, accuracyM: coords.accuracy }
            : prev,
        ),
      (e) =>
        setError(
          e.code === e.PERMISSION_DENIED
            ? "Location permission was denied. Tap the map to place this phone."
            : "Couldn't get a location fix. Tap the map to place this phone.",
        ),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );
    const stop = setTimeout(() => navigator.geolocation.clearWatch(id), WATCH_MS);
    return () => {
      clearTimeout(stop);
      navigator.geolocation.clearWatch(id);
    };
  }, [active]);

  return { fix, error };
}
