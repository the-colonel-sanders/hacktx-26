import { FLOOR_BOUNDS, type Bounds } from "./floorplan";

// Tunables
export const W_LOUD = 1;
export const W_ORDER = 10;
export const W_TIME = 1;
export const HEATMAP_T = 5;
export const SPEED_OF_SOUND_MPS = 343;
// Expected arrival-time error. Phones placed by room center can be several meters (≈10 ms) off.
export const TIME_SIGMA_EXACT_MS = 3;
export const TIME_SIGMA_ROOM_MS = 10;
export const GRID_RESOLUTION_M = 0.5;
export const MIN_DIST_M = 0.5;
export const ORDER_MIN_GAP_MS = 15; // ignore arrival-order pairs closer than this
export const SHOT_WINDOW_MS = 300; // detections within ±this belong to the same shot
export const REFERENCE_DB = -10; // expected peak of the reference calibration clap

export type Observation = {
  x: number;
  y: number;
  normPeakDb: number;
  spikeTsMs: number;
  exact?: boolean; // true if x/y is the phone's real spot, not its room center
};

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

  // Arrival time: t_i = t0 + d_i / c, with the unknown fire time t0 fit as a weighted mean.
  // Equivalent to matching every pair's time gap to its distance gap (a hyperbola per pair).
  let wSum = 0;
  let t0 = 0;
  const w = new Array<number>(n);
  const travelMs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const sigma = obs[i].exact ? TIME_SIGMA_EXACT_MS : TIME_SIGMA_ROOM_MS;
    w[i] = 1 / (sigma * sigma);
    travelMs[i] = (dist[i] / SPEED_OF_SOUND_MPS) * 1000;
    t0 += w[i] * (obs[i].spikeTsMs - travelMs[i]);
    wSum += w[i];
  }
  t0 /= wSum;
  let timeCost = 0;
  for (let i = 0; i < n; i++) {
    const r = obs[i].spikeTsMs - (t0 + travelMs[i]);
    timeCost += w[i] * r * r;
  }

  // Arrival order: whoever clearly heard it first should be closer.
  let orderViolations = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (obs[i].spikeTsMs < obs[j].spikeTsMs - ORDER_MIN_GAP_MS && dist[i] > dist[j]) orderViolations++;
    }
  }

  return W_LOUD * loudCost + W_TIME * timeCost + W_ORDER * orderViolations;
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

export type TimingReport = { deviceId: string; x: number; y: number; spikeTsMs: number };
export type TimingBias = { deviceId: string; distanceM: number; biasMs: number };

/**
 * Timing calibration from one reference sound made at a known spot.
 * Each phone should hear it at t0 + d_i / c. The fire time t0 is unknown, so only differences
 * between phones are measurable: bias_i = (t_i − d_i/c) − mean over phones. Biases sum to zero,
 * which is all localization needs (it only compares arrival times).
 */
export function timingBiases(src: { x: number; y: number }, reports: TimingReport[]): TimingBias[] {
  const withDist = reports.map((r) => {
    const distanceM = Math.hypot(r.x - src.x, r.y - src.y);
    return { ...r, distanceM, emitted: r.spikeTsMs - (distanceM / SPEED_OF_SOUND_MPS) * 1000 };
  });
  const t0 = withDist.reduce((sum, r) => sum + r.emitted, 0) / withDist.length;
  return withDist.map((r) => ({ deviceId: r.deviceId, distanceM: r.distanceM, biasMs: r.emitted - t0 }));
}
