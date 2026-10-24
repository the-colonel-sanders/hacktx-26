"use client";

import { useMemo, useRef, useState } from "react";
import { FLOOR_BOUNDS, ROOMS } from "@/lib/floorplan";
import { SHOT_WINDOW_MS } from "@/lib/localize";
import type { IncidentView } from "./page";
import s from "./incident.module.css";

const PX = 20; // svg units per meter
const W = (FLOOR_BOUNDS.maxX - FLOOR_BOUNDS.minX) * PX;
const H = (FLOOR_BOUNDS.maxY - FLOOR_BOUNDS.minY) * PX;
const sx = (x: number) => (x - FLOOR_BOUNDS.minX) * PX;
const sy = (y: number) => (y - FLOOR_BOUNDS.minY) * PX;

type Hover = { left: number; top: number; lines: string[] };

export default function FloorMap({ incident }: { incident: IncidentView }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const { heatmap, trail, best_x, best_y } = incident;

  // Every known phone, with its loudest reading for the most recent shot (if it heard it).
  const phones = useMemo(() => {
    const last = trail[trail.length - 1];
    const byId = new Map<string, { x: number; y: number; db: number | null }>();
    for (const d of incident.devices ?? []) byId.set(d.id, { x: d.x, y: d.y, db: null });
    for (const d of incident.detections) {
      if (!last || Math.abs(d.spike_ts_ms - last.t) > SHOT_WINDOW_MS) continue;
      const prev = byId.get(d.device_id);
      // Position from the detection: where the phone was when it heard the shot.
      byId.set(d.device_id, { x: d.x, y: d.y, db: Math.max(prev?.db ?? -Infinity, d.norm_peak_db) });
    }
    // A silent phone at the same spot as one that heard it is a stale check-in; hide it.
    // Draw phones that heard it last so they're on top.
    const all = [...byId.values()];
    const heardAt = new Set(all.filter((p) => p.db != null).map((p) => `${p.x},${p.y}`));
    return all
      .filter((p) => p.db != null || !heardAt.has(`${p.x},${p.y}`))
      .sort((a, b) => Number(a.db != null) - Number(b.db != null));
  }, [incident.detections, incident.devices, trail]);

  const cells = useMemo(() => {
    if (!heatmap) return [];
    const out: { x: number; y: number; v: number }[] = [];
    heatmap.values.forEach((v, i) => {
      if (v < 0.03) return; // near-zero recedes into the surface
      out.push({
        x: heatmap.originX + (i % heatmap.width) * heatmap.resolution,
        y: heatmap.originY + Math.floor(i / heatmap.width) * heatmap.resolution,
        v,
      });
    });
    return out;
  }, [heatmap]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = svgRef.current!.getBoundingClientRect();
    const mx = FLOOR_BOUNDS.minX + ((e.clientX - box.left) / box.width) * (W / PX);
    const my = FLOOR_BOUNDS.minY + ((e.clientY - box.top) / box.height) * (H / PX);
    const lines = [`${mx.toFixed(1)}, ${my.toFixed(1)} m`];

    const phone = phones.find((p) => Math.hypot(p.x - mx, p.y - my) < 0.6);
    const room = ROOMS.find((r) => Math.hypot(r.x - mx, r.y - my) < 1);
    if (phone) {
      lines.unshift("Phone");
      lines.push(phone.db == null ? "Didn't hear latest shot" : `Heard latest shot at ${phone.db.toFixed(1)} dB`);
    } else if (room) {
      lines.unshift(room.name);
    } else if (heatmap) {
      const col = Math.round((mx - heatmap.originX) / heatmap.resolution);
      const row = Math.round((my - heatmap.originY) / heatmap.resolution);
      if (col >= 0 && col < heatmap.width && row >= 0 && row < heatmap.height) {
        lines.push(`Relative likelihood ${Math.round(heatmap.values[row * heatmap.width + col] * 100)}%`);
      }
    }
    setHover({ left: e.clientX - box.left, top: e.clientY - box.top, lines });
  };

  return (
    <div>
      <div className={s.mapWrap}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          className={s.map}
          role="img"
          aria-label="Floor plan with estimated gunshot location"
          onMouseMove={onMove}
          onMouseLeave={() => setHover(null)}
        >
          {/* 1 m grid, heavier every 5 m */}
          {Array.from({ length: W / PX + 1 }, (_, i) => (
            <line key={`gx${i}`} x1={i * PX} x2={i * PX} y1={0} y2={H} stroke="var(--grid)" strokeWidth={(i + FLOOR_BOUNDS.minX) % 5 === 0 ? 1 : 0.4} />
          ))}
          {Array.from({ length: H / PX + 1 }, (_, i) => (
            <line key={`gy${i}`} y1={i * PX} y2={i * PX} x1={0} x2={W} stroke="var(--grid)" strokeWidth={(i + FLOOR_BOUNDS.minY) % 5 === 0 ? 1 : 0.4} />
          ))}

          {/* Heatmap */}
          {heatmap &&
            cells.map((c) => (
              <rect
                key={`${c.x},${c.y}`}
                x={sx(c.x - heatmap.resolution / 2)}
                y={sy(c.y - heatmap.resolution / 2)}
                width={heatmap.resolution * PX}
                height={heatmap.resolution * PX}
                fill="var(--heat)"
                fillOpacity={c.v * 0.85}
              />
            ))}

          {/* Shot trail */}
          {trail.length > 1 && (
            <polyline
              points={trail.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ")}
              fill="none"
              stroke="var(--ink-2)"
              strokeWidth={2}
              strokeDasharray="5 4"
              strokeLinejoin="round"
            />
          )}
          {trail.slice(0, -1).map((p, i) => (
            <g key={p.t}>
              <circle cx={sx(p.x)} cy={sy(p.y)} r={7} fill="var(--surface)" stroke="var(--ink-2)" strokeWidth={2} />
              <text x={sx(p.x)} y={sy(p.y) + 3.5} className={s.trailNum}>
                {i + 1}
              </text>
            </g>
          ))}

          {/* Room centers (reference) */}
          {ROOMS.map((r) => (
            <g key={r.id}>
              <rect x={sx(r.x) - 4} y={sy(r.y) - 4} width={8} height={8} rx={1.5} fill="none" stroke="var(--axis)" strokeWidth={1.5} />
              <text x={sx(r.x)} y={sy(r.y) - 10} className={s.roomLabel}>
                {r.name.replace("Hallway ", "Hall ")}
              </text>
            </g>
          ))}

          {/* Phones at their actual positions */}
          {phones.map((p, i) => (
            <g key={i}>
              <circle
                cx={sx(p.x)}
                cy={sy(p.y)}
                r={6}
                fill={p.db != null ? "var(--ink)" : "var(--surface)"}
                stroke={p.db != null ? "var(--surface)" : "var(--muted)"}
                strokeWidth={2}
              />
              {p.db != null && (
                <text x={sx(p.x)} y={sy(p.y) + 19} className={s.dbLabel}>
                  {p.db.toFixed(0)} dB
                </text>
              )}
            </g>
          ))}

          {/* Best estimate */}
          {best_x != null && best_y != null && (
            <g>
              <circle cx={sx(best_x)} cy={sy(best_y)} r={14} fill="none" stroke="var(--critical)" strokeWidth={2} />
              <circle cx={sx(best_x)} cy={sy(best_y)} r={6} fill="var(--critical)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
        {hover && (
          <div className={s.tooltip} style={{ left: hover.left, top: hover.top }}>
            {hover.lines.map((l, i) => (
              <div key={i} className={i === 0 ? s.tooltipHead : undefined}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>

      <ul className={s.legend}>
        <li>
          <span className={s.gradient} aria-hidden /> Likelihood vs. best spot: low → high
        </li>
        <li>
          <svg width="12" height="12" aria-hidden>
            <rect x="2" y="2" width="8" height="8" rx="1.5" fill="none" stroke="var(--axis)" strokeWidth="1.5" />
          </svg>
          Room center
        </li>
        <li>
          <svg width="18" height="18" aria-hidden>
            <circle cx="9" cy="9" r="7" fill="none" stroke="var(--critical)" strokeWidth="2" />
            <circle cx="9" cy="9" r="3.5" fill="var(--critical)" />
          </svg>
          Estimated source
        </li>
        <li>
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="var(--ink)" />
          </svg>
          Phone heard latest shot
        </li>
        <li>
          <svg width="14" height="14" aria-hidden>
            <circle cx="7" cy="7" r="5" fill="var(--surface)" stroke="var(--muted)" strokeWidth="2" />
          </svg>
          Phone, didn&apos;t hear it
        </li>
        <li>
          <svg width="26" height="10" aria-hidden>
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          Shot trail (numbered in order)
        </li>
      </ul>
      {!heatmap && best_x != null && (
        <p className={s.muted}>Only one phone heard the latest shot, so the estimate is that phone&apos;s room.</p>
      )}
    </div>
  );
}
