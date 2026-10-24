import { describe, expect, it } from "vitest";
import { FLOOR_BOUNDS, ROOMS, nearestRoom } from "./floorplan";
import { cellCost, gridSearch, groupShot, type Observation } from "./localize";

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
});

describe("cellCost", () => {
  it("penalizes arrival-order violations", () => {
    // Device A heard it 50 ms first, equal loudness: cells nearer A should beat cells nearer B.
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0 },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 50 },
    ];
    expect(cellCost(4, 0, obs)).toBeLessThan(cellCost(6, 0, obs));
    // One order violation (10) on top of the worse time fit.
    expect(cellCost(6, 0, obs) - cellCost(4, 0, obs)).toBeGreaterThan(10);
  });

  it("doesn't count order for gaps under 15 ms", () => {
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0 },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 10 },
    ];
    // Only the (small, loose room-center) time term differs; no order violation.
    expect(cellCost(6, 0, obs) - cellCost(4, 0, obs)).toBeLessThan(2);
  });

  it("scores the time gap: 1.9 m farther ≈ 5.5 ms later", () => {
    // Source at x ≈ 4.05 between phones 10 m apart: d_B − d_A = 1.9 m. Loudness agrees (3.3 dB gap).
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0, exact: true },
      { x: 10, y: 0, normPeakDb: -23.3, spikeTsMs: 5.5, exact: true },
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
        exact: true,
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
