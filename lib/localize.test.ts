import { describe, expect, it } from "vitest";
import { FLOOR_BOUNDS, ROOMS, nearestRoom } from "./floorplan";
import {
  LOUD_SIGMA_DB,
  cellCost,
  gridSearch,
  groupShot,
  timeSigmaMs,
  timingBiases,
  type Observation,
} from "./localize";

const SPEED_OF_SOUND = 343; // m/s

// Deterministic PRNG so the tests don't flake.
function mulberry32(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function synth(sx: number, sy: number, rand: () => number, dbNoise = 1, msNoise = 2): Observation[] {
  const L0 = -5;
  return ROOMS.map((r) => {
    const d = Math.max(0.5, Math.hypot(sx - r.x, sy - r.y));
    return {
      x: r.x,
      y: r.y,
      normPeakDb: L0 - 20 * Math.log10(d) + (rand() * 2 - 1) * dbNoise,
      spikeTsMs: 1_000_000 + (d / SPEED_OF_SOUND) * 1000 + (rand() * 2 - 1) * msNoise,
    };
  });
}

describe("gridSearch", () => {
  const sources: [number, number][] = [
    [9, 2],
    [3, -2],
    [20, 5],
    [12, 0],
    [25, 3],
  ];

  for (const [sx, sy] of sources) {
    it(`locates a source at (${sx}, ${sy}) within 2 m`, () => {
      const est = gridSearch(synth(sx, sy, mulberry32(sx * 100 + sy)));
      expect(Math.hypot(est.x - sx, est.y - sy)).toBeLessThan(2);
    });
  }

  it("returns a normalized, compact heatmap", () => {
    const { heatmap } = gridSearch(synth(9, 2, mulberry32(1)));
    expect(heatmap.width).toBe((FLOOR_BOUNDS.maxX - FLOOR_BOUNDS.minX) / 0.5 + 1);
    expect(heatmap.height).toBe((FLOOR_BOUNDS.maxY - FLOOR_BOUNDS.minY) / 0.5 + 1);
    expect(heatmap.values).toHaveLength(heatmap.width * heatmap.height);
    expect(Math.max(...heatmap.values)).toBe(1);
    expect(Math.min(...heatmap.values)).toBeGreaterThanOrEqual(0);
    for (const v of heatmap.values) expect(Math.round(v * 100) / 100).toBe(v);
  });

  it("is calibrated: the ≥ 0.1 region holds the true source about 90% of the time", () => {
    // Noise drawn at exactly the σ the model assumes, so exp(−Δχ²/2) ≥ 0.1 should cover ~90%.
    const rand = mulberry32(42);
    const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
    const phones = [
      { x: 5, y: 2 },
      { x: 20, y: -1 },
      { x: 12, y: 6 },
      { x: 0, y: -3 },
      { x: 26, y: 5 },
    ];
    const timeSigma = timeSigmaMs({ posSigmaM: 0, calibrated: true, syncRttMs: 10 });
    let covered = 0;
    const N = 100;
    for (let k = 0; k < N; k++) {
      const sx = -2 + rand() * 31;
      const sy = -3 + rand() * 10;
      const { heatmap: h } = gridSearch(
        phones.map((p) => {
          const d = Math.max(0.5, Math.hypot(sx - p.x, sy - p.y));
          return {
            ...p,
            timeSigmaMs: timeSigma,
            normPeakDb: -5 - 20 * Math.log10(d) + gauss() * LOUD_SIGMA_DB,
            spikeTsMs: (d / SPEED_OF_SOUND) * 1000 + gauss() * timeSigma,
          };
        }),
      );
      const v = h.values[Math.round((sy - h.originY) / h.resolution) * h.width + Math.round((sx - h.originX) / h.resolution)];
      if (v >= 0.1) covered++;
    }
    expect(covered / N).toBeGreaterThan(0.8);
    expect(covered / N).toBeLessThan(0.98); // not so wide that it says nothing
  });
});

describe("timeSigmaMs", () => {
  it("grows without timing calibration, with a slow clock sync, and for room-center phones", () => {
    const base = timeSigmaMs({ posSigmaM: 0, calibrated: true, syncRttMs: 10 });
    expect(base).toBeCloseTo(Math.sqrt(9 + 200 / 12), 6);
    expect(timeSigmaMs({ posSigmaM: 0, calibrated: false, syncRttMs: 10 })).toBeGreaterThan(base);
    expect(timeSigmaMs({ posSigmaM: 0, calibrated: true, syncRttMs: 60 })).toBeGreaterThan(base);
    expect(timeSigmaMs({ posSigmaM: 3, calibrated: true, syncRttMs: 10 })).toBeGreaterThan(base);
  });
});

describe("cellCost", () => {
  it("prefers cells nearer the phone that heard it first", () => {
    // Device A heard it 15 ms first, equal loudness: cells nearer A should beat cells nearer B.
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0 },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 15 },
    ];
    expect(cellCost(3, 0, obs)).toBeLessThan(cellCost(5, 0, obs));
    expect(cellCost(5, 0, obs)).toBeLessThan(cellCost(7, 0, obs));
  });

  it("weighs the time gap by each phone's timing error", () => {
    const obs = (timeSigmaMs: number): Observation[] => [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0, timeSigmaMs },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 15, timeSigmaMs },
    ];
    // Same 1 m cells apart; a 20 ms σ makes the time term (σ/3)² = 44× weaker than a 3 ms σ.
    const gap = (o: Observation[]) => cellCost(7, 0, o) - cellCost(3, 0, o);
    expect(gap(obs(3)) / gap(obs(20))).toBeCloseTo((20 / 3) ** 2, 6);
  });

  it("treats a clipped peak as a lower bound", () => {
    // B clipped at −20 dB. Cells where B should be louder than that fit fine; quieter ones don't.
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -30, spikeTsMs: 0, timeSigmaMs: 1e6 },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 0, timeSigmaMs: 1e6, clipped: true },
    ];
    expect(cellCost(9, 0, obs)).toBeCloseTo(0, 6); // model says B hears −10.9 dB ≥ −20
    expect(cellCost(5, 0, obs)).toBeGreaterThan(0); // model says B hears −30 dB < −20
    // Unclipped, the closer cell would be penalized for B being too quiet.
    expect(cellCost(9, 0, obs.map((o) => ({ ...o, clipped: false })))).toBeGreaterThan(0);
  });

  it("scores the time gap: 1.9 m farther ≈ 5.5 ms later", () => {
    // Source at x ≈ 4.05 between phones 10 m apart: d_B − d_A = 1.9 m. Loudness agrees (3.3 dB gap).
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0 },
      { x: 10, y: 0, normPeakDb: -23.3, spikeTsMs: 5.5 },
    ];
    expect(cellCost(4, 0, obs)).toBeLessThan(cellCost(5, 0, obs));
    expect(cellCost(4, 0, obs)).toBeLessThan(cellCost(3, 0, obs));
    // Same loudness, but the gap says B heard it first: that cell should now fit far worse.
    const flipped = obs.map((o, i) => ({ ...o, spikeTsMs: i === 0 ? 5.5 : 0 }));
    expect(cellCost(4, 0, flipped) - cellCost(4, 0, obs)).toBeGreaterThan(5);
  });
});

describe("exact phone positions", () => {
  const PHONES = [
    { x: 5, y: 2 },
    { x: 20, y: -1 },
    { x: 12, y: 6 },
    { x: 0, y: -3 },
  ];
  const shot = (phones: typeof PHONES, sx: number, sy: number, rand: () => number, dbNoise = 0, msNoise = 0) =>
    phones.map((p) => {
      const d = Math.max(0.5, Math.hypot(sx - p.x, sy - p.y));
      return {
        ...p,
        normPeakDb: -5 - 20 * Math.log10(d) + (rand() * 2 - 1) * dbNoise,
        spikeTsMs: (d / SPEED_OF_SOUND) * 1000 + (rand() * 2 - 1) * msNoise,
      };
    });

  it("two phones: the time gap cuts the loudness circle down to the source or its mirror", () => {
    // Mirror of (12, 3) across the line through the two phones.
    const est = gridSearch(shot(PHONES.slice(0, 2), 12, 3, mulberry32(7)));
    const err = Math.min(Math.hypot(est.x - 12, est.y - 3), Math.hypot(est.x - 11.07, est.y + 1.61));
    expect(err).toBeLessThan(1);
  });

  for (const [sx, sy] of [
    [12, 3],
    [2, 5],
    [25, -2],
    [16, 1],
  ] as const) {
    it(`four phones with noise locate (${sx}, ${sy}) within 1.5 m`, () => {
      const est = gridSearch(shot(PHONES, sx, sy, mulberry32(sx * 31 + sy), 2, 3));
      expect(Math.hypot(est.x - sx, est.y - sy)).toBeLessThan(1.5);
    });
  }
});

describe("groupShot", () => {
  it("keeps detections within ±300 ms and the loudest per device", () => {
    const dets = [
      { deviceId: "a", spikeTsMs: 1000, normPeakDb: -30 },
      { deviceId: "a", spikeTsMs: 1050, normPeakDb: -20 },
      { deviceId: "b", spikeTsMs: 1290, normPeakDb: -25 },
      { deviceId: "c", spikeTsMs: 1400, normPeakDb: -10 },
    ];
    const shot = groupShot(dets, 1000);
    expect(shot.map((d) => d.deviceId).sort()).toEqual(["a", "b"]);
    expect(shot.find((d) => d.deviceId === "a")!.normPeakDb).toBe(-20);
  });
});

describe("nearestRoom", () => {
  it("picks the closest room center", () => {
    expect(nearestRoom(13, 3.5, ROOMS)!.id).toBe("hall-c");
    expect(nearestRoom(17, -1, ROOMS)!.id).toBe("204");
  });
});

describe("timingBiases", () => {
  it("recovers each phone's constant delay (relative to the average)", () => {
    const src = { x: 10, y: 2 };
    const phones = [
      { deviceId: "a", x: 5, y: 2, delay: 0 },
      { deviceId: "b", x: 20, y: -1, delay: 40 }, // slow Android
      { deviceId: "c", x: 12, y: 6, delay: 5 },
    ];
    const fire = 1_000_000;
    const biases = timingBiases(
      src,
      phones.map((p) => ({
        ...p,
        spikeTsMs: fire + (Math.hypot(p.x - src.x, p.y - src.y) / SPEED_OF_SOUND) * 1000 + p.delay,
      })),
    );
    const meanDelay = 15;
    for (const p of phones) {
      expect(biases.find((b) => b.deviceId === p.deviceId)!.biasMs).toBeCloseTo(p.delay - meanDelay, 6);
    }
    expect(biases.reduce((s, b) => s + b.biasMs, 0)).toBeCloseTo(0, 6);
  });

  it("correcting by the biases makes a later shot locate correctly", () => {
    const delays = [0, 40, 5, 25];
    const PHONES = [
      { x: 5, y: 2 },
      { x: 20, y: -1 },
      { x: 12, y: 6 },
      { x: 0, y: -3 },
    ];
    const hear = (sx: number, sy: number) =>
      PHONES.map((p, i) => {
        const d = Math.max(0.5, Math.hypot(sx - p.x, sy - p.y));
        return { ...p, d, t: (d / SPEED_OF_SOUND) * 1000 + delays[i] };
      });
    // Calibrate with a reference sound at (10, 2).
    const biases = timingBiases(
      { x: 10, y: 2 },
      hear(10, 2).map((h, i) => ({ deviceId: String(i), x: h.x, y: h.y, spikeTsMs: h.t })),
    );
    // A shot at (22, 4), corrected.
    const obs: Observation[] = hear(22, 4).map((h, i) => ({
      x: h.x,
      y: h.y,
      normPeakDb: -5 - 20 * Math.log10(h.d),
      spikeTsMs: h.t - biases[i].biasMs,
    }));
    const est = gridSearch(obs);
    expect(Math.hypot(est.x - 22, est.y - 4)).toBeLessThan(0.75);
  });
});
