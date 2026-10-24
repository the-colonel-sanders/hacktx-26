"use client";

import { useCallback, useEffect, useState } from "react";
import { ROOMS } from "@/lib/floorplan";
import type { TrailPoint } from "@/lib/incidents";
import type { Heatmap } from "@/lib/localize";
import FloorMap from "./FloorMap";
import s from "./incident.module.css";

export type Detection = {
  id: string;
  device_id: string;
  room_id: string;
  spike_ts_ms: number;
  raw_peak_db: number;
  norm_peak_db: number;
  confidence: number | null;
  label: string | null;
};

export type IncidentView = {
  id: string;
  started_at: string;
  updated_at: string;
  best_x: number | null;
  best_y: number | null;
  best_room_id: string | null;
  heatmap: Heatmap | null;
  trail: TrailPoint[];
  detection_count: number;
  detections: Detection[];
};

const POLL_MS = 1000;
const roomName = (id: string | null) => ROOMS.find((r) => r.id === id)?.name ?? id ?? "—";

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

  const firstTs = incident?.detections.length ? Math.min(...incident.detections.map((d) => d.spike_ts_ms)) : 0;

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
            <Stat label="Estimated location" value={roomName(incident.best_room_id)} />
            <Stat
              label="Coordinates"
              value={incident.best_x == null ? "—" : `${incident.best_x.toFixed(1)}, ${incident.best_y!.toFixed(1)} m`}
            />
            <Stat label="Shots" value={String(incident.trail.length)} />
            <Stat label="Detections" value={String(incident.detection_count)} />
          </section>

          <section className={s.card}>
            <FloorMap incident={incident} />
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
                      <th>Room</th>
                      <th className={s.num}>Arrival (ms after first)</th>
                      <th className={s.num}>Loudness (dB, normalized)</th>
                      <th className={s.num}>Confidence</th>
                      <th>Device</th>
                    </tr>
                  </thead>
                  <tbody>
                    {incident.detections.map((d) => (
                      <tr key={d.id}>
                        <td>{roomName(d.room_id)}</td>
                        <td className={s.num}>{(d.spike_ts_ms - firstTs).toFixed(0)}</td>
                        <td className={s.num}>{d.norm_peak_db.toFixed(1)}</td>
                        <td className={s.num}>{d.confidence == null ? "—" : `${Math.round(d.confidence * 100)}%`}</td>
                        <td className={s.mono}>{d.device_id.slice(0, 8)}</td>
                      </tr>
                    ))}
                  </tbody>
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
