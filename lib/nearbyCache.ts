import type { NearbyResult } from "@/app/types/nearby";

const cache = new Map<string, { at: number; value: NearbyResult }>();
const TTL_MS = 10 * 60 * 1000;

export const cacheKey = (lat: number, lng: number) =>
  `${lat.toFixed(4)},${lng.toFixed(4)}`; // ~11 m grid

export function getCached(key: string) {
  const hit = cache.get(key);
  return hit && Date.now() - hit.at < TTL_MS ? hit.value : null;
}
export function setCached(key: string, value: NearbyResult) {
  cache.set(key, { at: Date.now(), value });
}