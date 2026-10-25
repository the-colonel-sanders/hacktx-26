"use client";

import { useEffect, useRef, useState } from "react";
import s from "./incident.module.css";

export type StatusView = {
  device_id: string;
  status: "safe" | "need_help" | "injured";
  updated_at: string;
  place: string;
};

const META = {
  injured: { label: "Injured", icon: "✚", rank: 0, cls: s.stInjured },
  need_help: { label: "Needs help", icon: "!", rank: 1, cls: s.stHelp },
  safe: { label: "Safe", icon: "✓", rank: 2, cls: s.stSafe },
} as const;

const SAFE_TOAST_MS = 6000; // "safe" is good news: show briefly. Help/injured stay until dismissed.

type Toast = StatusView & { key: string };

/** Pops up a card whenever a phone reports a new or changed status. */
export function StatusToasts({ statuses }: { statuses: StatusView[] }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seen = useRef<Map<string, string> | null>(null); // device → updated_at already shown

  useEffect(() => {
    const first = seen.current == null;
    seen.current ??= new Map();
    const fresh: Toast[] = [];
    for (const st of statuses) {
      if (seen.current.get(st.device_id) === st.updated_at) continue;
      seen.current.set(st.device_id, st.updated_at);
      // On page load, only surface people who still need attention.
      if (first && st.status === "safe") continue;
      fresh.push({ ...st, key: `${st.device_id}:${st.updated_at}` });
    }
    if (!fresh.length) return;
    setToasts((t) => [
      ...fresh.sort((a, b) => META[a.status].rank - META[b.status].rank),
      // A newer report from the same phone replaces its old card.
      ...t.filter((old) => !fresh.some((f) => f.device_id === old.device_id)),
    ]);
    for (const f of fresh) {
      if (f.status === "safe") setTimeout(() => setToasts((t) => t.filter((x) => x.key !== f.key)), SAFE_TOAST_MS);
    }
  }, [statuses]);

  if (!toasts.length) return null;
  return (
    <div className={s.toasts} role="status" aria-live="assertive">
      {toasts.map((t) => {
        const m = META[t.status];
        return (
          <div key={t.key} className={`${s.toast} ${m.cls}`}>
            <span className={s.toastIcon} aria-hidden>
              {m.icon}
            </span>
            <div className={s.toastBody}>
              <b>{m.label}</b>
              <span>{t.place}</span>
              <span className={s.toastTime}>
                {new Date(t.updated_at).toLocaleTimeString()} · phone {t.device_id.slice(0, 8)}
              </span>
            </div>
            <button
              className={s.toastClose}
              aria-label="Dismiss"
              onClick={() => setToasts((all) => all.filter((x) => x.key !== t.key))}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Everyone who has reported during this incident, most urgent first. */
export function StatusPanel({ statuses }: { statuses: StatusView[] }) {
  const sorted = [...statuses].sort(
    (a, b) => META[a.status].rank - META[b.status].rank || b.updated_at.localeCompare(a.updated_at),
  );
  const count = (k: StatusView["status"]) => statuses.filter((st) => st.status === k).length;

  return (
    <section className={s.card}>
      <h2 className={s.h2}>Status reports</h2>
      {statuses.length === 0 ? (
        <p className={s.muted}>No phone has reported a status yet.</p>
      ) : (
        <>
          <div className={s.stCounts}>
            {(["injured", "need_help", "safe"] as const).map((k) => (
              <span key={k} className={`${s.stChip} ${META[k].cls}`}>
                <span aria-hidden>{META[k].icon}</span> {count(k)} {META[k].label.toLowerCase()}
              </span>
            ))}
          </div>
          <ul className={s.stList}>
            {sorted.map((st) => (
              <li key={st.device_id}>
                <span className={`${s.stChip} ${META[st.status].cls}`}>
                  <span aria-hidden>{META[st.status].icon}</span> {META[st.status].label}
                </span>
                <span>{st.place}</span>
                <span className={s.toastTime}>{new Date(st.updated_at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
