"use client";

import { useCallback, useEffect, useState } from "react";
import { ROOMS } from "@/lib/floorplan";
import {
  LOCATION_MODE_NAMES,
  TIMING_METHOD_NAMES,
  type LocationMode,
  type PhoneSettings,
} from "@/lib/phoneSettings";
import s from "./admin.module.css";

type PhoneRow = {
  id: string;
  lastSeen: string;
  checkedIn: {
    mode: LocationMode;
    roomId: string | null;
    x: number | null;
    y: number | null;
    lat: number | null;
    lng: number | null;
    accuracyM: number | null;
    label: string | null;
  };
  settings: PhoneSettings;
  ownSettings: string[]; // settings this phone has of its own instead of the all-phones value
  gainOffsetDb: number;
  gainCalibratedAt: string | null;
  micCalRequestedAt: string | null;
  timeCalibrated: boolean;
};
type PhonesView = { allPhones: PhoneSettings; phones: PhoneRow[] };

const POLL_MS = 2000;
const MIC_CAL_WAIT_MS = 2 * 60_000; // show "waiting for clap" this long after asking

const roomName = (id: string | null) => ROOMS.find((r) => r.id === id)?.name ?? id ?? "—";

function whereText(c: PhoneRow["checkedIn"]): string {
  if (c.mode === "map" && c.lat != null && c.lng != null) {
    return `${c.label ? `${c.label} · ` : ""}${c.lat.toFixed(5)}, ${c.lng.toFixed(5)} ±${Math.round(c.accuracyM ?? 0)} m`;
  }
  return c.mode === "spot" ? `(${c.x}, ${c.y}) m` : roomName(c.roomId);
}

function ago(iso: string): string {
  const sec = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000));
  return sec < 60 ? `${sec} s ago` : `${Math.round(sec / 60)} min ago`;
}

/** Every recently active phone and the settings it follows. Phones pick changes up within a few seconds. */
export default function Phones() {
  const [view, setView] = useState<PhonesView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/phones", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      setView(data);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const post = async (path: string, body: unknown) => {
    try {
      const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error((await res.json()).error ?? `HTTP ${res.status}`);
    } catch (e) {
      setError((e as Error).message);
    }
    refresh();
  };

  // Show the change right away; the next poll confirms it.
  const change = (target: string, patch: Partial<PhoneSettings>) => {
    setView((v) => {
      if (!v) return v;
      if (target === "all") {
        return {
          allPhones: { ...v.allPhones, ...patch },
          phones: v.phones.map((p) => ({
            ...p,
            settings: { ...p.settings, ...patch },
            ownSettings: p.ownSettings.filter((k) => !(k in patch)),
          })),
        };
      }
      return {
        ...v,
        phones: v.phones.map((p) =>
          p.id === target
            ? { ...p, settings: { ...p.settings, ...patch }, ownSettings: [...new Set([...p.ownSettings, ...Object.keys(patch)])] }
            : p,
        ),
      };
    });
    post("/api/phones/settings", { target, patch });
  };

  return (
    <section className={s.card}>
      <h2 className={s.h2}>Phones</h2>
      <p className={s.muted}>
        What each phone does; changes reach it within a few seconds. <b>All phones</b> sets every phone at once and
        replaces their own values. A blue edge marks a setting a phone has of its own.
      </p>
      {error && <p className={s.error}>{error}</p>}
      {!view ? (
        <p className={s.muted}>Loading…</p>
      ) : (
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.phoneTable}`}>
            <thead>
              <tr>
                <th>Phone</th>
                <th>Location</th>
                <th>Lockdown screen</th>
                <th>Follow location</th>
                <th>Timing</th>
                <th>Simulate button</th>
                <th className={s.num}>Sim. loudness (dB)</th>
                <th className={s.num}>Sim. delay (ms)</th>
                <th>Mic</th>
              </tr>
            </thead>
            <tbody>
              <SettingsRow
                className={s.allRow}
                name={<b>All phones</b>}
                settings={view.allPhones}
                onChange={(patch) => change("all", patch)}
              />
              {view.phones.map((p) => {
                const waitingForClap =
                  p.micCalRequestedAt != null &&
                  Date.now() - Date.parse(p.micCalRequestedAt) < MIC_CAL_WAIT_MS &&
                  (p.gainCalibratedAt == null || Date.parse(p.gainCalibratedAt) < Date.parse(p.micCalRequestedAt));
                return (
                  <SettingsRow
                    key={p.id}
                    name={
                      <>
                        <span className={s.mono}>{p.id.slice(0, 8)}</span>
                        <div className={s.sub}>seen {ago(p.lastSeen)}</div>
                      </>
                    }
                    where={
                      <>
                        <div className={s.sub}>{whereText(p.checkedIn)}</div>
                        {p.checkedIn.mode !== p.settings.locationMode && (
                          <div className={s.subNote}>Waiting for the phone to pick its {LOCATION_MODE_NAMES[p.settings.locationMode].toLowerCase()}</div>
                        )}
                      </>
                    }
                    timingNote={p.timeCalibrated ? "Timing calibrated" : "Timing not calibrated"}
                    settings={p.settings}
                    own={p.ownSettings}
                    onChange={(patch) => change(p.id, patch)}
                    mic={
                      <>
                        <button
                          className={s.smallBtn}
                          disabled={waitingForClap}
                          onClick={() => post("/api/phones/calibrate-mic", { deviceId: p.id })}
                        >
                          {waitingForClap ? "Waiting for clap…" : "Calibrate"}
                        </button>
                        <div className={s.sub}>
                          {p.gainCalibratedAt ? `Offset ${p.gainOffsetDb.toFixed(1)} dB` : "Not calibrated"}
                        </div>
                      </>
                    }
                  />
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {view && view.phones.length === 0 && <p className={s.muted}>No phones have checked in in the last 15 minutes.</p>}
      {view && view.phones.length > 0 && (
        <p className={s.muted}>
          Mic calibration: the phone waits for one sharp clap about 1 m away. One phone at a time, since a clap is a
          different distance from each phone.
        </p>
      )}
    </section>
  );
}

function SettingsRow({
  name,
  where,
  timingNote,
  mic,
  settings,
  own = [],
  onChange,
  className,
}: {
  name: React.ReactNode;
  where?: React.ReactNode;
  timingNote?: string;
  mic?: React.ReactNode;
  settings: PhoneSettings;
  own?: string[];
  onChange: (patch: Partial<PhoneSettings>) => void;
  className?: string;
}) {
  const mark = (key: keyof PhoneSettings) => (own.includes(key) ? s.own : undefined);
  return (
    <tr className={className}>
      <td>{name}</td>
      <td className={mark("locationMode")}>
        <select
          className={s.ctl}
          aria-label="Location"
          value={settings.locationMode}
          onChange={(e) => onChange({ locationMode: e.target.value as LocationMode })}
        >
          {(Object.keys(LOCATION_MODE_NAMES) as LocationMode[]).map((m) => (
            <option key={m} value={m}>
              {LOCATION_MODE_NAMES[m]}
            </option>
          ))}
        </select>
        {where}
      </td>
      <td className={mark("lockdownScreen")}>
        <input
          type="checkbox"
          className={s.check}
          aria-label="Lockdown screen"
          checked={settings.lockdownScreen}
          onChange={(e) => onChange({ lockdownScreen: e.target.checked })}
        />
      </td>
      <td className={mark("followLocation")}>
        <input
          type="checkbox"
          className={s.check}
          aria-label="Follow location"
          title="Real map only: re-check in when GPS shows the phone clearly moved"
          checked={settings.followLocation}
          onChange={(e) => onChange({ followLocation: e.target.checked })}
        />
      </td>
      <td className={mark("timingMethod")}>
        <select
          className={s.ctl}
          aria-label="Timing method"
          value={settings.timingMethod}
          onChange={(e) => onChange({ timingMethod: e.target.value as PhoneSettings["timingMethod"] })}
        >
          {(Object.keys(TIMING_METHOD_NAMES) as PhoneSettings["timingMethod"][]).map((m) => (
            <option key={m} value={m}>
              {TIMING_METHOD_NAMES[m]}
            </option>
          ))}
        </select>
        {timingNote && <div className={s.sub}>{timingNote}</div>}
      </td>
      <td className={mark("showSimulate")}>
        <label className={s.checkLabel}>
          <input
            type="checkbox"
            className={s.check}
            checked={settings.showSimulate}
            onChange={(e) => onChange({ showSimulate: e.target.checked })}
          />
          Show
        </label>
      </td>
      <td className={`${s.num} ${mark("simulateDb") ?? ""}`}>
        <NumberInput label="Simulated loudness (dB)" value={settings.simulateDb} min={-80} max={0} step={0.5} onCommit={(v) => onChange({ simulateDb: v })} />
      </td>
      <td className={`${s.num} ${mark("simulateDelayMs") ?? ""}`}>
        <NumberInput label="Simulated delay (ms)" value={settings.simulateDelayMs} min={0} max={250} step={1} onCommit={(v) => onChange({ simulateDelayMs: v })} />
      </td>
      <td>{mic ?? <span className={s.muted}>—</span>}</td>
    </tr>
  );
}

/** Edits locally and sends on blur or Enter, so typing "-25" doesn't send "-", "-2", "-25". */
function NumberInput({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(value));
  }, [value, editing]);

  const commit = () => {
    setEditing(false);
    const n = Number(text);
    if (text.trim() === "" || !Number.isFinite(n)) return setText(String(value));
    const clamped = Math.min(max, Math.max(min, n));
    setText(String(clamped));
    if (clamped !== value) onCommit(clamped);
  };

  return (
    <input
      type="number"
      inputMode="decimal"
      aria-label={label}
      className={`${s.ctl} ${s.ctlNum}`}
      value={text}
      min={min}
      max={max}
      step={step}
      onFocus={() => setEditing(true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
    />
  );
}
