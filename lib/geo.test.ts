import { describe, expect, it } from "vitest";
import { GEO_MAX_CELLS, PIN_ACCURACY_M, boundsAround, posSigmaM, toLatLng, toLocal } from "./geo";
import { ROOM_POS_SIGMA_M, gridSearch, timeSigmaMs } from "./localize";

const UT = { lat: 30.2849, lng: -97.7341 };

// Great-circle distance on a sphere of the mean Earth radius.
function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
}

describe("toLocal / toLatLng", () => {
  it("round-trips", () => {
    for (const p of [{ x: 0, y: 0 }, { x: 123.4, y: -56.7 }, { x: -800, y: 650 }]) {
      const back = toLocal(toLatLng(p, UT), UT);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it("matches great-circle distance to 0.5% across a campus", () => {
    // Haversine uses a sphere, the projection the ellipsoid; they differ by up to ~0.3% depending on direction.
    for (const [x, y] of [[100, 0], [0, 100], [300, -400], [-700, 700]]) {
      const d = haversine(UT, toLatLng({ x, y }, UT));
      expect(Math.abs(d - Math.hypot(x, y)) / Math.hypot(x, y)).toBeLessThan(0.005);
    }
  });

  it("puts east at +x and north at +y", () => {
    const p = toLocal({ lat: UT.lat + 0.001, lng: UT.lng + 0.001 }, UT);
    expect(p.x).toBeGreaterThan(90); // ~96 m east at 30° N
    expect(p.y).toBeGreaterThan(105); // ~111 m north
  });
});

describe("boundsAround", () => {
  it("adds the margin and keeps the native resolution for a building", () => {
    const { bounds, resolution } = boundsAround([{ x: 0, y: 0 }, { x: 40, y: 20 }], 30);
    expect(resolution).toBe(0.5);
    expect(bounds).toEqual({ minX: -30, maxX: 70, minY: -30, maxY: 50 });
  });

  it("coarsens the grid over a large area to stay under the cell budget", () => {
    const { bounds, resolution } = boundsAround([{ x: 0, y: 0 }, { x: 900, y: 700 }], 30);
    expect(resolution).toBeGreaterThan(0.5);
    const cells = ((bounds.maxX - bounds.minX) / resolution + 1) * ((bounds.maxY - bounds.minY) / resolution + 1);
    expect(cells).toBeLessThan(GEO_MAX_CELLS * 1.1);
    // Snapped to its own resolution.
    expect(bounds.minX / resolution).toBe(Math.round(bounds.minX / resolution));
  });
});

describe("posSigmaM", () => {
  it("uses the reported accuracy on the map, and exact/room on the floor plan", () => {
    expect(posSigmaM({ frame: "geo", pos_accuracy_m: 15 })).toBeCloseTo(10, 6);
    expect(posSigmaM({ frame: "geo", pos_accuracy_m: PIN_ACCURACY_M })).toBeLessThan(3);
    expect(posSigmaM({ frame: "grid", x: 1, y: 2 })).toBe(0);
    expect(posSigmaM({ frame: "grid", x: null, y: null })).toBe(ROOM_POS_SIGMA_M);
  });
});

describe("localizing on the real map", () => {
  it("finds a shot from lat/lng phones, projected around an origin", () => {
    // Six hand-placed phones around a 60 × 40 m building; shot 22 m east, 14 m north of the first one.
    const offsets = [[0, 0], [30, -2], [58, 3], [4, 38], [31, 40], [57, 36]];
    const phones = offsets.map(([x, y]) => toLatLng({ x, y }, UT));
    const origin = phones[0];
    const shot = toLatLng({ x: 22, y: 14 }, UT);
    const posSigma = posSigmaM({ frame: "geo", pos_accuracy_m: PIN_ACCURACY_M });
    const obs = phones.map((p) => {
      const local = toLocal(p, origin);
      const d = haversine(p, shot);
      return {
        ...local,
        posSigmaM: posSigma,
        timeSigmaMs: timeSigmaMs({ posSigmaM: posSigma, calibrated: true, syncRttMs: 10 }),
        normPeakDb: -5 - 20 * Math.log10(d),
        spikeTsMs: (d / 343) * 1000,
      };
    });
    const { bounds, resolution } = boundsAround(obs);
    const est = gridSearch(obs, bounds, resolution);
    const found = toLatLng(est, origin);
    expect(haversine(found, shot)).toBeLessThan(1.5);
  });
});
