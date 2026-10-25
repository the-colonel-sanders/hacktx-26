"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ROOMS } from "@/lib/floorplan";
import { ACCURACY_PER_SIGMA, type Frame } from "@/lib/geo";
import type { TrailPoint } from "@/lib/incidents";
import { SHOT_WINDOW_MS, type Heatmap } from "@/lib/localize";
import FloorMap from "./FloorMap";
import s from "./incident.module.css";

export type Detection = {
  id: string;
  device_id: string;
  room_id: string | null;
  // Phone position when it heard the shot: floor-plan meters (resolved server-side) or map lat/lng.
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
  pos_sigma_m: number | null;
  spike_ts_ms: number;
  raw_peak_db: number;
  norm_peak_db: number;
  confidence: number | null;
  label: string | null;
};

export type DeviceView = {
  id: string;
  frame: Frame;
  room_id: string | null;
  x?: number | null; // floor plan (resolved server-side)
  y?: number | null;
  lat: number | null; // real map
  lng: number | null;
  pos_accuracy_m: number | null;
  place_label: string | null;
};

export type IncidentView = {
  id: string;
  started_at: string;
  updated_at: string;
  frame: Frame | null; // which map; null until the first detection
  origin_lat: number | null; // geo: best_x/best_y, trail and heatmap are meters east/north of this
  origin_lng: number | null;
  best_x: number | null;
  best_y: number | null;
  best_lat: number | null;
  best_lng: number | null;
  best_room_id: string | null;
  best_label: string | null;
  heatmap: Heatmap | null;
  trail: TrailPoint[];
  detection_count: number;
  detections: Detection[];
  devices: DeviceView[]; // recently active phones on the incident's map
};

const POLL_MS = 1000;
const roomName = (id: string | null) => ROOMS.find((r) => r.id === id)?.name ?? id ?? "—";
const latLng = (lat: number, lng: number, digits = 6) => `${lat.toFixed(digits)}, ${lng.toFixed(digits)}`;

// Leaflet needs `window`.
const GeoMap = dynamic(() => import("./GeoMap"), { ssr: false, loading: () => <p className={s.muted}>Loading map…</p> });

export default function IncidentPage() {
  const [incident, setIncident] = useState<IncidentView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents/current", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setIncident(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (path: string) => {
    await fetch(path, { method: "POST" });
    refresh();
  };

  // Group detections into shots (same rule as the server: within the shot window), newest shot first.
  const shots: Detection[][] = [];
  for (const d of [...(incident?.detections ?? [])].sort((a, b) => a.spike_ts_ms - b.spike_ts_ms)) {
    const current = shots[shots.length - 1];
    if (current && d.spike_ts_ms - current[0].spike_ts_ms <= SHOT_WINDOW_MS) current.push(d);
    else shots.push([d]);
  }

  return (
    <main className={s.page}>
      <header className={s.header}>
        <div>
          <h1 className={s.title}>Current incident</h1>
          {incident ? (
            <span className={`${s.badge} ${s.active}`}>
              <span aria-hidden>●</span> Active · started {new Date(incident.started_at).toLocaleTimeString()}
            </span>
          ) : (
            <span className={`${s.badge} ${s.clear}`}>
              <span aria-hidden>✓</span> {loaded ? "No active incident" : "Loading…"}
            </span>
          )}
        </div>
        <div className={s.actions}>
          <button onClick={() => act("/api/alert")}>Manual alert</button>
          <button onClick={() => act("/api/all-clear")} disabled={!incident}>
            All clear
          </button>
        </div>
      </header>

      {error && <p className={s.error}>Can&apos;t reach the server: {error}</p>}

      {incident && (
        <>
          <section className={s.stats}>
            <Stat label="Estimated location" value={incident.best_label ?? roomName(incident.best_room_id)} />
            <Stat
              label="Coordinates"
              value={
                incident.best_lat != null
                  ? latLng(incident.best_lat, incident.best_lng!)
                  : incident.best_x == null
                    ? "—"
                    : `${incident.best_x.toFixed(1)}, ${incident.best_y!.toFixed(1)} m`
              }
            />
            <Stat label="Shots" value={String(incident.trail.length)} />
            <Stat label="Detections" value={String(incident.detection_count)} />
          </section>

          <section className={s.card}>
            {incident.frame === "geo" ? <GeoMap incident={incident} /> : <FloorMap incident={incident} />}
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Detections</h2>
            {incident.detections.length === 0 ? (
              <p className={s.muted}>None yet — this incident was raised manually.</p>
            ) : (
              <div className={s.tableWrap}>
                <table className={s.table}>
                  <thead>
                    <tr>
                      <th className={s.num}>{incident.frame === "geo" ? "Phone at (lat, lng)" : "Phone at (x, y m)"}</th>
                      <th className={s.num}>Heard after first phone (ms)</th>
                      <th className={s.num}>Loudness (dB, normalized)</th>
                      <th className={s.num}>Confidence</th>
                      <th>Device</th>
                    </tr>
                  </thead>
                  {shots
                    .map((shot, i) => ({ shot, n: i + 1 }))
                    .reverse()
                    .map(({ shot, n }) => (
                      <tbody key={shot[0].id}>
                        <tr className={s.shotRow}>
                          <th colSpan={5}>
                            Shot {n} · {shot.length} phone{shot.length === 1 ? "" : "s"} ·{" "}
                            {new Date(shot[0].spike_ts_ms).toLocaleTimeString()}
                            {n === shots.length && " · latest"}
                          </th>
                        </tr>
                        {shot.map((d) => (
                          <tr key={d.id}>
                            {d.lat != null && d.lng != null ? (
                              <td className={s.num} title={d.pos_sigma_m == null ? undefined : `Position ±${Math.round(d.pos_sigma_m * ACCURACY_PER_SIGMA)} m`}>
                                {latLng(d.lat, d.lng, 5)}
                              </td>
                            ) : (
                              <td className={s.num} title={`Nearest room: ${roomName(d.room_id)}`}>
                                ({d.x}, {d.y})
                              </td>
                            )}
                            <td className={s.num}>+{(d.spike_ts_ms - shot[0].spike_ts_ms).toFixed(1)}</td>
                            <td className={s.num}>{d.norm_peak_db.toFixed(1)}</td>
                            <td className={s.num}>{d.confidence == null ? "—" : `${Math.round(d.confidence * 100)}%`}</td>
                            <td className={s.mono}>{d.device_id.slice(0, 8)}</td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className={s.stat}>
      <div className={s.statLabel}>{label}</div>
      <div className={s.statValue}>{value}</div>
    </div>
  );
}
