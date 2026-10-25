import { describe, expect, it } from "vitest";
import { DEFAULT_PHONE_SETTINGS, checkedInMode, resolveSettings } from "./phoneSettings";

describe("resolveSettings", () => {
  it("layers all-phones over the defaults and a phone's own over both", () => {
    const all = { lockdownScreen: true, simulateDb: -20 };
    const own = { simulateDb: -35, timingMethod: "current" };
    expect(resolveSettings(all, own)).toEqual({
      ...DEFAULT_PHONE_SETTINGS,
      lockdownScreen: true,
      simulateDb: -35,
      timingMethod: "current",
    });
  });

  it("ignores unknown keys, invalid values and missing layers", () => {
    expect(resolveSettings(null, { simulateDb: 12, locationMode: "attic", bogus: 1 }, undefined)).toEqual(
      DEFAULT_PHONE_SETTINGS,
    );
  });
});

describe("checkedInMode", () => {
  it("reads the mode from a devices row", () => {
    expect(checkedInMode({ frame: "geo", x: null })).toBe("map");
    expect(checkedInMode({ frame: "grid", x: 3 })).toBe("spot");
    expect(checkedInMode({ frame: "grid", x: null })).toBe("room");
  });
});
