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
    expect(cellCost(6, 0, obs) - cellCost(4, 0, obs)).toBeCloseTo(10, 0);
  });

  it("ignores pairs closer than 15 ms", () => {
    const obs: Observation[] = [
      { x: 0, y: 0, normPeakDb: -20, spikeTsMs: 0 },
      { x: 10, y: 0, normPeakDb: -20, spikeTsMs: 10 },
    ];
    expect(cellCost(6, 0, obs)).toBeCloseTo(cellCost(4, 0, obs), 6);
  });
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
