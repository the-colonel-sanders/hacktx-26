"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { CAL_MAX_ACCURACY_M, type LatLng } from "@/lib/geo";
import PositionPicker from "../phone/PositionPicker";
import s from "./calibrate.module.css";

// A spot is x/y on the floor plan or lat/lng on the real map.
type Where = { x: number | null; y: number | null; lat?: number | null; lng?: number | null };
type Result = Where & { deviceId: string; distanceM: number; biasMs: number; offsetMs: number };
type Cal = Where & {
  id: string;
  frame?: "grid" | "geo";
  started_at: string;
  finished_at: string | null;
  results: Result[] | null;
};
type Report = Where & { device_id: string; peak_db: number };
type State = { active: Cal | null; reports: Report[]; last: Cal | null };

const POLL_MS = 1000;
const where = (w: Where) =>
  w.lat != null && w.lng != null ? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}` : `(${w.x}, ${w.y}) m`;

// Leaflet needs `window`.
const GeoPicker = dynamic(() => import("../phone/GeoPicker"), { ssr: false, loading: () => <p className={s.hint}>Loading map…</p> });

export default function CalibratePage() {
  const [state, setState] = useState<State | null>(null);
  const [onMap, setOnMap] = useState(false);
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [geoSpot, setGeoSpot] = useState<LatLng | null>(null);
  const reference = onMap ? geoSpot : spot;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/timing-cal", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setState(data);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const act = async (path: string, body?: unknown) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const active = state?.active;

  return (
    <main className={s.page}>
      <h1 className={s.title}>Timing calibration</h1>
      <p className={s.lead}>
        Every phone delays sound a little differently before it can timestamp it (Android phones can differ by 100 ms).
        Make one sharp sound at a known spot that all phones hear, and each phone&apos;s delay is measured and
        subtracted from its future detections. Phones must be listening and checked in at an exact spot (on the real
        map: a pin placed by hand, within ±{CAL_MAX_ACCURACY_M} m).
      </p>

      {!active ? (
        <section className={s.card}>
          <h2 className={s.h2}>1. Where will you make the sound?</h2>
          <label className={s.hint}>
            <input type="checkbox" checked={onMap} onChange={(e) => setOnMap(e.target.checked)} /> Phones are on the real
            map (not the demo floor plan)
          </label>
          {onMap ? (
            <GeoPicker value={geoSpot && { ...geoSpot, accuracyM: 1 }} onChange={setGeoSpot} />
          ) : (
            <PositionPicker value={spot} onChange={setSpot} />
          )}
          <p className={s.hint}>
            {reference ? `Reference spot: ${where({ x: null, y: null, ...reference })}.` : "Tap the map."} Somewhere all
            phones can hear clearly works best, e.g. the middle of the hallway.
          </p>
          <button className={s.primary} disabled={!reference || busy} onClick={() => act("/api/timing-cal/start", reference)}>
            Start listening
          </button>
        </section>
      ) : (
        <section className={s.card}>
          <h2 className={s.h2}>
            2. Make one sharp sound at {where(active)}
          </h2>
          <p className={s.hint}>
            A loud clap or a dropped book, once. While this runs, phones send what they hear here instead of reporting
            gunshots.
          </p>
          <p className={s.count}>
            {state.reports.length} phone{state.reports.length === 1 ? "" : "s"} heard it
          </p>
          {state.reports.length > 0 && (
            <ul className={s.list}>
              {state.reports.map((r) => (
                <li key={r.device_id}>
                  <span className={s.mono}>{r.device_id.slice(0, 8)}</span> at {where(r)} · {r.peak_db.toFixed(0)} dB
                </li>
              ))}
            </ul>
          )}
          <div className={s.row}>
            <button className={s.primary} disabled={busy || state.reports.length < 2} onClick={() => act("/api/timing-cal/finish")}>
              Finish &amp; apply
            </button>
            <button className={s.secondary} disabled={busy} onClick={() => act("/api/timing-cal/cancel")}>
              Cancel
            </button>
          </div>
          {state.reports.length < 2 && <p className={s.hint}>Needs at least 2 phones.</p>}
        </section>
      )}

      {error && <p className={s.error}>{error}</p>}

      {state?.last?.results && (
        <section className={s.card}>
          <h2 className={s.h2}>Last calibration</h2>
          <p className={s.hint}>
            Reference at {where(state.last)}, {new Date(state.last.finished_at!).toLocaleTimeString()}.
            Delay is relative to the average phone; positive means this phone timestamps sounds late.
          </p>
          <div className={s.tableWrap}>
            <table className={s.table}>
              <thead>
                <tr>
                  <th>Device</th>
                  <th className={s.num}>Phone at</th>
                  <th className={s.num}>Distance (m)</th>
                  <th className={s.num}>Measured delay (ms)</th>
                  <th className={s.num}>Total correction (ms)</th>
                </tr>
              </thead>
              <tbody>
                {state.last.results.map((r) => (
                  <tr key={r.deviceId}>
                    <td className={s.mono}>{r.deviceId.slice(0, 8)}</td>
                    <td className={s.num}>{where(r)}</td>
                    <td className={s.num}>{r.distanceM.toFixed(1)}</td>
                    <td className={s.num}>{r.biasMs >= 0 ? "+" : "−"}{Math.abs(r.biasMs).toFixed(1)}</td>
                    <td className={s.num}>{r.offsetMs.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
