import "server-only";
import type { Frame } from "./geo";
import { db } from "./supabase";

// The reference spot is x/y on the floor plan (frame "grid") or lat/lng on the real map (frame "geo").
export type TimingCalibration = {
  id: string;
  frame: Frame;
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  status: "listening" | "done" | "cancelled";
  started_at: string;
  finished_at: string | null;
  results: TimingResult[] | null;
};

export type TimingResult = {
  deviceId: string;
  x: number | null;
  y: number | null;
  lat?: number | null;
  lng?: number | null;
  distanceM: number;
  biasMs: number;
  offsetMs: number;
};

export async function getActiveTimingCal(): Promise<TimingCalibration | null> {
  const { data, error } = await db().from("timing_calibrations").select("*").eq("status", "listening").maybeSingle();
  if (error) throw error;
  return data;
}
