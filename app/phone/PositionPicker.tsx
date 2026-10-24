"use client";

import { useRef } from "react";
import { FLOOR_BOUNDS, ROOMS } from "@/lib/floorplan";
import s from "./phone.module.css";

const PX = 20; // svg units per meter
const W = (FLOOR_BOUNDS.maxX - FLOOR_BOUNDS.minX) * PX;
const H = (FLOOR_BOUNDS.maxY - FLOOR_BOUNDS.minY) * PX;
const sx = (x: number) => (x - FLOOR_BOUNDS.minX) * PX;
const sy = (y: number) => (y - FLOOR_BOUNDS.minY) * PX;
const snap = (v: number) => Math.round(v * 2) / 2; // 0.5 m, same as the localization grid

type Point = { x: number; y: number };

/** Tap the floor plan to set where this phone is. */
export default function PositionPicker({ value, onChange }: { value: Point | null; onChange: (p: Point) => void }) {
  const ref = useRef<SVGSVGElement>(null);

  const onClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const box = ref.current!.getBoundingClientRect();
    onChange({
      x: snap(FLOOR_BOUNDS.minX + ((e.clientX - box.left) / box.width) * (W / PX)),
      y: snap(FLOOR_BOUNDS.minY + ((e.clientY - box.top) / box.height) * (H / PX)),
    });
  };

  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={s.picker} onClick={onClick} role="img" aria-label="Floor plan: tap to place this phone">
      {Array.from({ length: W / PX + 1 }, (_, i) => (
        <line key={`gx${i}`} x1={i * PX} x2={i * PX} y1={0} y2={H} stroke="var(--grid)" strokeWidth={(i + FLOOR_BOUNDS.minX) % 5 === 0 ? 1 : 0.4} />
      ))}
      {Array.from({ length: H / PX + 1 }, (_, i) => (
        <line key={`gy${i}`} y1={i * PX} y2={i * PX} x1={0} x2={W} stroke="var(--grid)" strokeWidth={(i + FLOOR_BOUNDS.minY) % 5 === 0 ? 1 : 0.4} />
      ))}
      {ROOMS.map((r) => (
        <g key={r.id}>
          <rect x={sx(r.x) - 4} y={sy(r.y) - 4} width={8} height={8} rx={1.5} fill="none" stroke="var(--axis)" strokeWidth={1.5} />
          <text x={sx(r.x)} y={sy(r.y) - 9} className={s.pickerLabel}>
            {r.name.replace("Hallway ", "Hall ").replace("Room ", "")}
          </text>
        </g>
      ))}
      {value && (
        <g>
          <circle cx={sx(value.x)} cy={sy(value.y)} r={14} fill="none" stroke="var(--heat)" strokeWidth={2} />
          <circle cx={sx(value.x)} cy={sy(value.y)} r={6} fill="var(--heat)" stroke="var(--surface)" strokeWidth={2} />
        </g>
      )}
    </svg>
  );
}
