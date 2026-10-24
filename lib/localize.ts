import { FLOOR_BOUNDS, type Bounds } from "./floorplan";

// Tunables
export const W_LOUD = 1;
export const W_ORDER = 10;
export const HEATMAP_T = 5;
export const GRID_RESOLUTION_M = 0.5;
export const MIN_DIST_M = 0.5;
export const ORDER_MIN_GAP_MS = 15; // ignore arrival-order pairs closer than this
export const SHOT_WINDOW_MS = 300; // detections within ±this belong to the same shot
export const REFERENCE_DB = -10; // expected peak of the reference calibration clap

export type Observation = { x: number; y: number; normPeakDb: number; spikeTsMs: number };

export type Heatmap = {
  width: number;
  height: number;
  resolution: number;
  originX: number;
  originY: number;
  values: number[]; // row-major: values[row * width + col], cell = (originX + col*res, originY + row*res)
};

export type Estimate = { x: number; y: number; cost: number; heatmap: Heatmap };

export function cellCost(cx: number, cy: number, obs: Observation[]): number {
  const n = obs.length;
  const logD = new Array<number>(n);
  const dist = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    dist[i] = Math.max(MIN_DIST_M, Math.hypot(cx - obs[i].x, cy - obs[i].y));
    logD[i] = 20 * Math.log10(dist[i]);
  }

  // Loudness: L_i = L0 − 20·log10(d_i), with L0 fit as the mean.
  let l0 = 0;
  for (let i = 0; i < n; i++) l0 += obs[i].normPeakDb + logD[i];
  l0 /= n;
  let loudCost = 0;
  for (let i = 0; i < n; i++) {
    const r = obs[i].normPeakDb - (l0 - logD[i]);
    loudCost += r * r;
  }

  // Arrival order: whoever clearly heard it first should be closer.
  let orderViolations = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (obs[i].spikeTsMs < obs[j].spikeTsMs - ORDER_MIN_GAP_MS && dist[i] > dist[j]) orderViolations++;
    }
  }

  return W_LOUD * loudCost + W_ORDER * orderViolations;
}

export function gridSearch(
  obs: Observation[],
  bounds: Bounds = FLOOR_BOUNDS,
  resolution = GRID_RESOLUTION_M,
): Estimate {
  const width = Math.floor((bounds.maxX - bounds.minX) / resolution) + 1;
  const height = Math.floor((bounds.maxY - bounds.minY) / resolution) + 1;
  const costs = new Array<number>(width * height);

  let minCost = Infinity;
  let bestIdx = 0;
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const idx = row * width + col;
      const c = cellCost(bounds.minX + col * resolution, bounds.minY + row * resolution, obs);
      costs[idx] = c;
      if (c < minCost) {
        minCost = c;
        bestIdx = idx;
      }
    }
  }

  // exp(−Δcost/T) is already 1 at the minimum, so it's normalized to 0..1.
  const values = costs.map((c) => Math.round(Math.exp(-(c - minCost) / HEATMAP_T) * 100) / 100);

  return {
    x: bounds.minX + (bestIdx % width) * resolution,
    y: bounds.minY + Math.floor(bestIdx / width) * resolution,
    cost: minCost,
    heatmap: { width, height, resolution, originX: bounds.minX, originY: bounds.minY, values },
  };
}

/** Detections within ±windowMs of tsMs, keeping only the loudest per device. */
export function groupShot<D extends { deviceId: string; spikeTsMs: number; normPeakDb: number }>(
  detections: D[],
  tsMs: number,
  windowMs = SHOT_WINDOW_MS,
): D[] {
  const byDevice = new Map<string, D>();
  for (const d of detections) {
    if (Math.abs(d.spikeTsMs - tsMs) > windowMs) continue;
    const prev = byDevice.get(d.deviceId);
    if (!prev || d.normPeakDb > prev.normPeakDb) byDevice.set(d.deviceId, d);
  }
  return [...byDevice.values()];
}
