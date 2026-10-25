import "server-only";
import type { Frame, LatLng } from "./geo";
import { db } from "./supabase";

export type Incident = {
  id: string;
  status: "active" | "cleared";
  started_at: string;
  updated_at: string;
  frame: Frame | null; // null until the first detection (a manual alert has none)
  origin_lat: number | null;
  origin_lng: number | null;
  best_x: number | null;
  best_y: number | null;
  best_lat: number | null;
  best_lng: number | null;
  best_room_id: string | null;
  best_label: string | null;
  heatmap: unknown;
  trail: TrailPoint[];
  detection_count: number;
  summary: string | null;
};

export type TrailPoint = { x: number; y: number; t: number };

/** Which map an incident is on. In geo mode, x/y are meters east/north of `origin`. */
export type FrameInit = { frame: "grid" } | { frame: "geo"; origin: LatLng };

const frameRow = (init: FrameInit | undefined) =>
  !init
    ? {}
    : init.frame === "geo"
      ? { frame: "geo", origin_lat: init.origin.lat, origin_lng: init.origin.lng }
      : { frame: "grid" };

export async function getActiveIncident(): Promise<Incident | null> {
  const { data, error } = await db().from("incidents").select("*").eq("status", "active").maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Returns the active incident, creating it (plus an `alert` row) if there is none.
 * A partial unique index allows only one active incident, so concurrent creators
 * lose the race with 23505 and just re-read the winner's row.
 * With `init`, an incident that has no frame yet takes this one (first detection wins).
 */
export async function getOrCreateActiveIncident(init?: FrameInit): Promise<{ incident: Incident; created: boolean }> {
  const existing = await getActiveIncident();
  if (existing) return { incident: await claimFrame(existing, init), created: false };

  const { data, error } = await db()
    .from("incidents")
    .insert({ status: "active", ...frameRow(init) })
    .select("*")
    .single();
  if (error) {
    if (error.code === "23505") {
      const winner = await getActiveIncident();
      if (winner) return { incident: await claimFrame(winner, init), created: false };
    }
    throw error;
  }

  const { error: alertErr } = await db().from("alerts").insert({ incident_id: data.id, type: "alert" });
  if (alertErr) throw alertErr;
  return { incident: data, created: true };
}

async function claimFrame(incident: Incident, init: FrameInit | undefined): Promise<Incident> {
  if (incident.frame || !init) return incident;
  // Only if still unset, so two first detections can't both claim it.
  const { error } = await db().from("incidents").update(frameRow(init)).eq("id", incident.id).is("frame", null);
  if (error) throw error;
  return (await getActiveIncident()) ?? incident;
}
