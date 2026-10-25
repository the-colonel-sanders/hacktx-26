"use client";
import { useEffect, useState } from "react";
import type { GunshotEvent, NearbyResult } from "@/app/types/nearby";

export function useNearbyBuildings(event: GunshotEvent | null) {
  const [data, setData] = useState<NearbyResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!event) return;
    const ctrl = new AbortController();
    setLoading(true); setError(null);

    fetch(`/api/nearby?lat=${event.lat}&lng=${event.lng}&eventId=${event.id}`,
          { signal: ctrl.signal })
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData)
      .catch(e => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [event?.id, event?.lat, event?.lng]);

  return { data, loading, error };
}