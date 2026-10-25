import { FLOOR_BOUNDS, type Bounds } from "./floorplan";

// Tunables. The cost is a χ² (each residual divided by its expected error), so the heatmap
// exp(−Δχ²/2) is the likelihood relative to the best cell.
export const SPEED_OF_SOUND_MPS = 343;
// Expected loudness error: phone mics, orientation and walls differ by several dB even after gain calibration.
export const LOUD_SIGMA_DB = 4;
// Expected arrival-time error from the audio pipeline, with and without timing calibration.
export const TIME_SIGMA_CALIBRATED_MS = 3;
export const TIME_SIGMA_UNCALIBRATED_MS = 20;
export const ROOM_POS_SIGMA_M = 3; // a phone placed by room center can be this far from its real spot
export const DEFAULT_SYNC_RTT_MS = 30; // assumed clock-sync round trip when the phone didn't report one
export const CLIP_DB = -1; // raw peaks at or above this (dBFS) are clipped: the sound was at least this loud
export const GRID_RESOLUTION_M = 0.5;
export const MIN_DIST_M = 0.5;
const DB_PER_LOG_DIST = 20 / Math.LN10; // d(20·log10 d)/d(ln d) ≈ 8.7 dB
export const SHOT_WINDOW_MS = 300; // detections within ±this belong to the same shot
export const REFERENCE_DB = -10; // expected peak of the reference calibration clap

export type Observation = {
  x: number;
  y: number;
  normPeakDb: number;
  spikeTsMs: number;
  timeSigmaMs?: number; // expected arrival-time error, see timeSigmaMs(); default TIME_SIGMA_CALIBRATED_MS
  posSigmaM?: number; // how far x/y may be from the phone's real spot (1σ); default 0
  clipped?: boolean; // the mic saturated, so normPeakDb is only a lower bound
};

/**
 * Expected arrival-time error for one phone's detection: audio pipeline + clock sync + position.
 * The sync error is uniform within ±rtt/2 (σ = rtt/√12). A calibrated phone's offset absorbed the
 * sync error at calibration time, but the clock has been re-synced since, so it carries the
 * difference of two syncs (twice the variance).
 */
export function timeSigmaMs(p: { posSigmaM: number; calibrated: boolean; syncRttMs: number | null }): number {
  const pipeline = p.calibrated ? TIME_SIGMA_CALIBRATED_MS : TIME_SIGMA_UNCALIBRATED_MS;
  const rtt = p.syncRttMs ?? DEFAULT_SYNC_RTT_MS;
  const syncVar = ((p.calibrated ? 2 : 1) * rtt * rtt) / 12;
  const posMs = (p.posSigmaM / SPEED_OF_SOUND_MPS) * 1000;
  return Math.sqrt(pipeline * pipeline + syncVar + posMs * posMs);
}

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

  // Loudness: L_i = L0 − 20·log10(d_i), with L0 fit as the weighted mean over unclipped phones.
  // A clipped phone only says the sound was at least that loud, so it counts only when the model predicts quieter.
  // Position error σ_p shifts 20·log10(d) by ≈ 8.7·σ_p/d dB, so a phone's loudness error grows close up
  // (capped at d = σ_p, where the linear estimate breaks down). Since that σ differs per cell, the cost
  // includes its ln σ² term (relative to LOUD_SIGMA_DB, so exact positions add nothing).
  const loudVar = new Array<number>(n);
  let l0 = 0;
  let l0w = 0;
  for (let i = 0; i < n; i++) {
    const p = obs[i].posSigmaM ?? 0;
    const posDb = p > 0 ? (DB_PER_LOG_DIST * p) / Math.max(dist[i], p) : 0;
    loudVar[i] = LOUD_SIGMA_DB * LOUD_SIGMA_DB + posDb * posDb;
    if (obs[i].clipped) continue;
    l0 += (obs[i].normPeakDb + logD[i]) / loudVar[i];
    l0w += 1 / loudVar[i];
  }
  let loudCost = 0;
  if (l0w > 0) {
    l0 /= l0w;
    for (let i = 0; i < n; i++) {
      const r = obs[i].normPeakDb - (l0 - logD[i]);
      if (!obs[i].clipped || r > 0) {
        loudCost += (r * r) / loudVar[i] + Math.log(loudVar[i] / (LOUD_SIGMA_DB * LOUD_SIGMA_DB));
      }
    }
  }

  // Arrival time: t_i = t0 + d_i / c, with the unknown fire time t0 fit as a weighted mean.
  // Equivalent to matching every pair's time gap to its distance gap (a hyperbola per pair),
  // which already covers arrival order.
  let wSum = 0;
  let t0 = 0;
  const w = new Array<number>(n);
  const travelMs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const sigma = obs[i].timeSigmaMs ?? TIME_SIGMA_CALIBRATED_MS;
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

  return loudCost + timeCost;
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

  // Likelihood relative to the best cell: exp(−Δχ²/2), already 1 at the minimum.
  const values = costs.map((c) => Math.round(Math.exp(-(c - minCost) / 2) * 100) / 100);

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
