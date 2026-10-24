import "server-only";
import { db } from "./supabase";

export type Incident = {
  id: string;
  status: "active" | "cleared";
  started_at: string;
  updated_at: string;
  best_x: number | null;
  best_y: number | null;
  best_room_id: string | null;
  heatmap: unknown;
  trail: TrailPoint[];
  detection_count: number;
  summary: string | null;
};

export type TrailPoint = { x: number; y: number; t: number };

export async function getActiveIncident(): Promise<Incident | null> {
  const { data, error } = await db().from("incidents").select("*").eq("status", "active").maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Returns the active incident, creating it (plus an `alert` row) if there is none.
 * A partial unique index allows only one active incident, so concurrent creators
 * lose the race with 23505 and just re-read the winner's row.
 */
export async function getOrCreateActiveIncident(): Promise<{ incident: Incident; created: boolean }> {
  const existing = await getActiveIncident();
  if (existing) return { incident: existing, created: false };

  const { data, error } = await db().from("incidents").insert({ status: "active" }).select("*").single();
  if (error) {
    if (error.code === "23505") {
      const winner = await getActiveIncident();
      if (winner) return { incident: winner, created: false };
    }
    throw error;
  }

  const { error: alertErr } = await db().from("alerts").insert({ incident_id: data.id, type: "alert" });
  if (alertErr) throw alertErr;
  return { incident: data, created: true };
}
