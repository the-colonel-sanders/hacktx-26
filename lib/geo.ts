// Geo mode: phones placed on the real map (lat/lng) instead of the demo floor plan.
// Localization still runs in meters: positions are projected to a local east/north plane
// around an origin (the incident's first phone), which is accurate to centimeters over a campus.

import type { Bounds } from "./floorplan";
import { GRID_RESOLUTION_M, ROOM_POS_SIGMA_M } from "./localize";

export type LatLng = { lat: number; lng: number };
export type Frame = "grid" | "geo";

export const GEO_MARGIN_M = 30; // search this far beyond the outermost phones
export const GEO_MAX_CELLS = 40_000; // coarser grid over large areas to keep a request fast
export const MAX_GPS_ACCURACY_M = 100; // rougher fixes (e.g. "approximate location") must be pinned by hand
export const PIN_ACCURACY_M = 4; // a pin dropped by hand on the map
export const CAL_MAX_ACCURACY_M = 5; // timing calibration bakes position error in as fake delay
// Browsers report accuracy as a radius: the spec says 95% confidence, Android reports 68%.
// Dividing by 1.5 treats it as the 68% case, the conservative choice.
export const ACCURACY_PER_SIGMA = 1.5;
// Where maps open before there's a GPS fix: UT Austin. Override with NEXT_PUBLIC_MAP_CENTER="lat,lng".
export const DEFAULT_CENTER: LatLng = parseCenter(process.env.NEXT_PUBLIC_MAP_CENTER) ?? { lat: 30.2849, lng: -97.7341 };

function parseCenter(s: string | undefined): LatLng | null {
  const [lat, lng] = (s ?? "").split(",").map(Number);
  return Number.isFinite(lat) && Number.isFinite(lng) && s ? { lat, lng } : null;
}

// Meters per degree on the WGS84 ellipsoid at latitude φ.
const mPerDegLat = (phi: number) => 111132.92 - 559.82 * Math.cos(2 * phi) + 1.175 * Math.cos(4 * phi);
const mPerDegLng = (phi: number) => 111412.84 * Math.cos(phi) - 93.5 * Math.cos(3 * phi);
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Meters east (x) and north (y) of `origin`. */
export function toLocal(p: LatLng, origin: LatLng): { x: number; y: number } {
  const phi = rad(origin.lat);
  return { x: (p.lng - origin.lng) * mPerDegLng(phi), y: (p.lat - origin.lat) * mPerDegLat(phi) };
}

export function toLatLng(p: { x: number; y: number }, origin: LatLng): LatLng {
  const phi = rad(origin.lat);
  return { lat: origin.lat + p.y / mPerDegLat(phi), lng: origin.lng + p.x / mPerDegLng(phi) };
}

/** Search area around the phones, snapped to its own resolution so consecutive shots share cells. */
export function boundsAround(
  points: { x: number; y: number }[],
  margin = GEO_MARGIN_M,
  maxCells = GEO_MAX_CELLS,
): { bounds: Bounds; resolution: number } {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs) - margin;
  const maxX = Math.max(...xs) + margin;
  const minY = Math.min(...ys) - margin;
  const maxY = Math.max(...ys) + margin;
  const area = (maxX - minX) * (maxY - minY);
  const resolution = Math.max(GRID_RESOLUTION_M, Math.ceil(Math.sqrt(area / maxCells) * 2) / 2);
  return {
    bounds: {
      minX: Math.floor(minX / resolution) * resolution,
      maxX: Math.ceil(maxX / resolution) * resolution,
      minY: Math.floor(minY / resolution) * resolution,
      maxY: Math.ceil(maxY / resolution) * resolution,
    },
    resolution,
  };
}

/** How far a phone's recorded position may be from where it really is (1σ, meters). */
export function posSigmaM(d: {
  frame?: Frame | null;
  x?: number | null;
  y?: number | null;
  pos_accuracy_m?: number | null;
}): number {
  if (d.frame === "geo") return (d.pos_accuracy_m ?? MAX_GPS_ACCURACY_M) / ACCURACY_PER_SIGMA;
  return d.x != null && d.y != null ? 0 : ROOM_POS_SIGMA_M;
}
