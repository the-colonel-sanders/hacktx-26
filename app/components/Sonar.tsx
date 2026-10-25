"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FLOOR_BOUNDS, ROOMS, nearestRoom } from "@/lib/floorplan";
import s from "../landing.module.css";

// A self-contained version of the real pipeline for the landing page: a sound at a point, phones
// at the demo floor plan's rooms hearing it after distance / 343 m/s (plus a little clock jitter),
// then a grid search for the spot that best explains their arrival times and loudness. It mirrors
// lib/localize.ts in spirit (fit the unknown firing time and loudness per cell) but runs in the browser.

const C = 343; // m/s
const SLOW = 26; // animation ms per millisecond of sound
const PX = 30; // svg units per meter
const STEP = 0.5; // grid cell, meters
const JITTER_MS = 0.25;
const JITTER_DB = 1;

const PHONE_IDS = ["201", "203", "205", "hall-w", "hall-e"];
const PHONES = ROOMS.filter((r) => PHONE_IDS.includes(r.id));
const { minX, maxX, minY, maxY } = FLOOR_BOUNDS;
const W = (maxX - minX) * PX;
const H = (maxY - minY) * PX;
const px = (x: number) => (x - minX) * PX;
const py = (y: number) => (y - minY) * PX;

type Shot = { x: number; y: number; arrivals: { id: string; name: string; d: number; t: number; db: number }[] };

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function fire(x: number, y: number): Shot {
  const arrivals = PHONES.map((p) => {
    const d = Math.hypot(p.x - x, p.y - y);
    return {
      id: p.id,
      name: p.name,
      d,
      t: (d / C) * 1000 + gauss() * JITTER_MS,
      db: -20 * Math.log10(Math.max(d, 0.5)) + gauss() * JITTER_DB,
    };
  });
  return { x, y, arrivals };
}

function solve(shot: Shot) {
  const cells: { x: number; y: number; cost: number }[] = [];
  let best = { x: 0, y: 0, cost: Infinity };
  for (let x = minX + STEP / 2; x < maxX; x += STEP) {
    for (let y = minY + STEP / 2; y < maxY; y += STEP) {
      const ds = PHONES.map((p) => Math.max(Math.hypot(p.x - x, p.y - y), 0.5));
      // Firing time and source loudness are unknown: fit them, so only differences between phones count.
      const rt = shot.arrivals.map((a, i) => a.t - (ds[i] / C) * 1000);
      const rl = shot.arrivals.map((a, i) => a.db + 20 * Math.log10(ds[i]));
      const mt = rt.reduce((a, b) => a + b) / rt.length;
      const ml = rl.reduce((a, b) => a + b) / rl.length;
      const cost =
        rt.reduce((a, r) => a + ((r - mt) / 0.5) ** 2, 0) + rl.reduce((a, r) => a + ((r - ml) / 3) ** 2, 0);
      cells.push({ x, y, cost });
      if (cost < best.cost) best = { x, y, cost };
    }
  }
  const heat = cells
    .map((c) => ({ ...c, w: Math.exp(-(c.cost - best.cost) / 2) }))
    .filter((c) => c.w > 0.03);
  return { best, heat, room: nearestRoom(best.x, best.y, ROOMS), error: Math.hypot(best.x - shot.x, best.y - shot.y) };
}

export default function Sonar() {
  const [shot, setShot] = useState<Shot | null>(null);
  const [t, setT] = useState(0); // ms of sound since the shot
  const raf = useRef(0);
  const svg = useRef<SVGSVGElement>(null);

  const last = shot ? Math.max(...shot.arrivals.map((a) => a.t)) : 0;
  const done = !!shot && t >= last;
  const result = useMemo(() => (shot ? solve(shot) : null), [shot]);

  const start = useCallback((x: number, y: number) => {
    cancelAnimationFrame(raf.current);
    const next = fire(x, y);
    const end = Math.max(...next.arrivals.map((a) => a.t)) + 4;
    setShot(next);
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setT(end);
      return;
    }
    setT(0);
    const t0 = performance.now();
    const tick = (now: number) => {
      const ms = (now - t0) / SLOW;
      setT(Math.min(ms, end));
      if (ms < end) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    const id = setTimeout(() => start(9.5, 0.8), 600);
    return () => {
      clearTimeout(id);
      cancelAnimationFrame(raf.current);
    };
  }, [start]);

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const el = svg.current;
    const m = el?.getScreenCTM();
    if (!el || !m) return;
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    const x = p.x / PX + minX;
    const y = p.y / PX + minY;
    if (x < minX || x > maxX || y < minY || y > maxY) return;
    start(x, y);
  };

  const random = () => start(minX + 1 + Math.random() * 28, minY + 1 + Math.random() * 9);

  const heard = shot ? shot.arrivals.filter((a) => a.t <= t).sort((a, b) => a.t - b.t) : [];
  const first = heard[0]?.t ?? 0;
  const loudest = shot ? Math.max(...shot.arrivals.map((a) => a.db)) : 0;
  const radius = (ms: number) => Math.max(0, (ms / 1000) * C * PX);

  return (
    <div className={s.sonar}>
      <div className={s.figure}>
        <div className={s.figHead}>
          <span>Fig. 1: Live solver, demo floor plan (33 × 12 m)</span>
          <span className={s.clock} aria-hidden="true">
            t = {t.toFixed(1).padStart(5, " ")} ms
          </span>
        </div>
        <svg
          ref={svg}
          viewBox={`-34 -10 ${W + 44} ${H + 40}`}
          className={s.plan}
          onClick={onClick}
          role="img"
          aria-label="Floor plan of five classrooms and a hallway with five listening phones. Click to fire a test sound; the table beside it lists what each phone heard."
        >
          <defs>
            <pattern id="minor" width={PX} height={PX} patternUnits="userSpaceOnUse">
              <path d={`M ${PX} 0 L 0 0 0 ${PX}`} className={s.gridMinor} />
            </pattern>
            <clipPath id="floor">
              <rect x={0} y={0} width={W} height={H} />
            </clipPath>
          </defs>

          <rect x={0} y={0} width={W} height={H} fill="url(#minor)" />

          {/* meter ticks */}
          {Array.from({ length: Math.floor((maxX - minX) / 3) + 1 }, (_, i) => minX + i * 3).map((x) => (
            <text key={x} x={px(x)} y={H + 22} className={s.tick} textAnchor="middle">
              {x}
            </text>
          ))}
          {Array.from({ length: Math.floor((maxY - minY) / 4) + 1 }, (_, i) => minY + i * 4).map((y) => (
            <text key={y} x={-10} y={py(y) + 4} className={s.tick} textAnchor="end">
              {y}
            </text>
          ))}

          {/* building: five classrooms along a corridor */}
          <g className={s.walls}>
            <rect x={px(-3)} y={py(-4)} width={30 * PX} height={10 * PX} />
            {[3, 9, 15, 21].map((x) => (
              <line key={x} x1={px(x)} y1={py(-4)} x2={px(x)} y2={py(2)} />
            ))}
            {[0, 6, 12, 18, 24].map((c, i) => (
              <g key={c}>
                <line x1={px(c - 3)} y1={py(2)} x2={px(c + 1)} y2={py(2)} />
                <line x1={px(c + 2.2)} y1={py(2)} x2={px(c + 3)} y2={py(2)} />
                <text x={px(c - 2.6)} y={py(-3.2)} className={s.roomLabel}>
                  {201 + i}
                </text>
              </g>
            ))}
          </g>
          <text x={px(27) - 8} y={py(5.1)} className={s.roomLabel} textAnchor="end">
            corridor
          </text>

          <g clipPath="url(#floor)">
            {done && result && (
              <g className={s.heat}>
                {result.heat.map((c) => (
                  <rect
                    key={`${c.x},${c.y}`}
                    x={px(c.x - STEP / 2)}
                    y={py(c.y - STEP / 2)}
                    width={STEP * PX + 0.5}
                    height={STEP * PX + 0.5}
                    opacity={c.w * 0.75}
                  />
                ))}
              </g>
            )}
            {shot && !done && (
              <g className={s.wave}>
                {[0, 7, 14].map((lag, i) => (
                  <circle key={lag} cx={px(shot.x)} cy={py(shot.y)} r={radius(t - lag)} opacity={1 - i * 0.35} />
                ))}
              </g>
            )}
          </g>

          {shot && (
            <g className={s.source}>
              <line x1={px(shot.x) - 6} y1={py(shot.y) - 6} x2={px(shot.x) + 6} y2={py(shot.y) + 6} />
              <line x1={px(shot.x) - 6} y1={py(shot.y) + 6} x2={px(shot.x) + 6} y2={py(shot.y) - 6} />
            </g>
          )}

          {PHONES.map((p) => {
            const a = shot?.arrivals.find((x) => x.id === p.id);
            const on = !!a && a.t <= t;
            return (
              <g key={p.id} className={on ? `${s.phone} ${s.phoneOn}` : s.phone}>
                {on && <circle cx={px(p.x)} cy={py(p.y)} r={14} className={s.ping} />}
                <rect x={px(p.x) - 5} y={py(p.y) - 8} width={10} height={16} rx={2} />
                {on && a && (
                  <text x={px(p.x) + 10} y={py(p.y) - 9} className={s.phoneLabel}>
                    +{(a.t - first).toFixed(1)}
                  </text>
                )}
              </g>
            );
          })}

          {done && result && (
            <g className={s.estimate}>
              <circle cx={px(result.best.x)} cy={py(result.best.y)} r={11} />
              <line x1={px(result.best.x) - 18} y1={py(result.best.y)} x2={px(result.best.x) + 18} y2={py(result.best.y)} />
              <line x1={px(result.best.x)} y1={py(result.best.y) - 18} x2={px(result.best.x)} y2={py(result.best.y) + 18} />
            </g>
          )}
        </svg>
        <div className={s.legend}>
          <span>
            <i className={s.keySource} /> true source
          </span>
          <span>
            <i className={s.keyPhone} /> listening phone
          </span>
          <span>
            <i className={s.keyHeat} /> where it could be
          </span>
          <span>
            <i className={s.keyEst} /> estimate
          </span>
        </div>
      </div>

      <aside className={s.readout} aria-live="polite">
        <p className={s.readoutHint}>
          <b>Click anywhere on the plan</b> to make a sound there. Each phone hears it a few milliseconds apart.
        </p>
        <table className={s.arrivals}>
          <thead>
            <tr>
              <th>#</th>
              <th>Phone</th>
              <th>Heard</th>
              <th>Level</th>
            </tr>
          </thead>
          <tbody>
            {PHONES.map((_, i) => {
              const a = heard[i];
              return (
                <tr key={i} className={a ? undefined : s.pending}>
                  <td>{i + 1}</td>
                  <td>{a ? a.name : "·"}</td>
                  <td>{a ? `+${(a.t - first).toFixed(1)} ms` : ""}</td>
                  <td>{a ? `${(a.db - loudest).toFixed(1)} dB` : ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className={done ? `${s.verdict} ${s.verdictOn}` : s.verdict}>
          <span className={s.verdictLabel}>Estimate</span>
          <span className={s.verdictPlace}>{done && result?.room ? `Near ${result.room.name}` : "listening…"}</span>
          <span className={s.verdictMeta}>
            {done && result
              ? `${result.error.toFixed(1)} m from the true source · ${PHONES.length} phones`
              : " "}
          </span>
        </div>
        <button type="button" className={s.ghostBtn} onClick={random}>
          Fire at a random spot
        </button>
      </aside>
    </div>
  );
}
