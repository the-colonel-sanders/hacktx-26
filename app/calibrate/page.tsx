"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { CAL_MAX_ACCURACY_M, type LatLng } from "@/lib/geo";
import { LOCATION_MODE_NAMES, type LocationMode } from "@/lib/phoneSettings";
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
const SETTINGS_POLL_MS = 5000; // follow Location mode changes made in /admin
const where = (w: Where) =>
  w.lat != null && w.lng != null ? `${w.lat.toFixed(5)}, ${w.lng.toFixed(5)}` : `(${w.x}, ${w.y}) m`;

// Leaflet needs `window`.
const GeoPicker = dynamic(() => import("../phone/GeoPicker"), { ssr: false, loading: () => <p className={s.hint}>Loading map…</p> });

export default function CalibratePage() {
  const [state, setState] = useState<State | null>(null);
  // Which map to show follows the space's Location mode setting (Admin → All phones).
  const [mode, setMode] = useState<LocationMode | null>(null);
  const [phonesCenter, setPhonesCenter] = useState<LatLng | null>(null);
  const onMap = mode === "map";
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

  useEffect(() => {
    const loadMode = async () => {
      try {
        const [settings, phones] = await Promise.all([
          fetch("/api/phones/settings", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/phones", { cache: "no-store" }).then((r) => r.json()),
        ]);
        if (settings?.settings?.locationMode) setMode(settings.settings.locationMode);
        // Open the real map over the phones that are on it: the middle of their pins.
        const pins = ((phones?.phones ?? []) as { checkedIn: { lat: number | null; lng: number | null } }[])
          .map((p) => p.checkedIn)
          .filter((c): c is LatLng => c.lat != null && c.lng != null);
        if (pins.length) {
          setPhonesCenter({
            lat: pins.reduce((a, p) => a + p.lat, 0) / pins.length,
            lng: pins.reduce((a, p) => a + p.lng, 0) / pins.length,
          });
        }
      } catch {}
    };
    loadMode();
    const t = setInterval(loadMode, SETTINGS_POLL_MS);
    return () => clearInterval(t);
  }, []);

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
          {mode && (
            <p className={s.hint}>
              Showing the {onMap ? "real map" : "demo floor plan"}: phones in this space use{" "}
              <b>{LOCATION_MODE_NAMES[mode]}</b> (change it in <a href="/admin">Admin</a>).
            </p>
          )}
          {mode === "room" && (
            <p className={s.error}>
              Phones checked in by room can&apos;t take part: a room center can be meters from the phone, which would be
              measured as fake delay. Set Location mode to Exact spot or Real map in Admin first.
            </p>
          )}
          {mode == null ? (
            <p className={s.hint}>Loading…</p>
          ) : onMap ? (
            // Keyed so it reopens over the phones once their positions arrive (the map reads its center once).
            <GeoPicker
              key={phonesCenter ? "phones" : "default"}
              value={geoSpot && { ...geoSpot, accuracyM: 1 }}
              onChange={setGeoSpot}
              center={phonesCenter}
            />
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
