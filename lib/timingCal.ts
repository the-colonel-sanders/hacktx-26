import "server-only";
import { db } from "./supabase";

export type TimingCalibration = {
  id: string;
  x: number;
  y: number;
  status: "listening" | "done" | "cancelled";
  started_at: string;
  finished_at: string | null;
  results: TimingResult[] | null;
};

export type TimingResult = { deviceId: string; x: number; y: number; distanceM: number; biasMs: number; offsetMs: number };

export async function getActiveTimingCal(): Promise<TimingCalibration | null> {
  const { data, error } = await db().from("timing_calibrations").select("*").eq("status", "listening").maybeSingle();
  if (error) throw error;
  return data;
}
