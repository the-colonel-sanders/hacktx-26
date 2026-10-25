"use client";

import L from "leaflet";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Circle, CircleMarker, ImageOverlay, Marker, Polyline, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { ACCURACY_PER_SIGMA, toLatLng, toLocal, type LatLng } from "@/lib/geo";
import { SHOT_WINDOW_MS, type Heatmap } from "@/lib/localize";
import { BaseMap } from "../map/BaseMap";
import m from "../map/map.module.css";
import { useTokens } from "../map/useTokens";
import type { IncidentView } from "./page";
import s from "./incident.module.css";

type Phone = LatLng & { accuracyM: number | null; label: string | null; db: number | null };
type Place = { id: string; name: string; type?: string; lat: number; lng: number };

/** The incident on OpenStreetMap. Load with next/dynamic({ ssr: false }): Leaflet needs `window`. */
export default function GeoMap({ incident }: { incident: IncidentView }) {
  const t = useTokens();
  const [hover, setHover] = useState<string | null>(null);
  const { heatmap, trail } = incident;
  const origin = useMemo(
    () => ({ lat: incident.origin_lat!, lng: incident.origin_lng! }),
    [incident.origin_lat, incident.origin_lng],
  );
  const best = incident.best_lat != null && incident.best_lng != null ? { lat: incident.best_lat, lng: incident.best_lng } : null;

  // Every known phone, with its loudest reading for the most recent shot (if it heard it).
  const phones = useMemo(() => {
    const last = trail[trail.length - 1];
    const byId = new Map<string, Phone>();
    for (const d of incident.devices ?? []) {
      if (d.lat == null || d.lng == null) continue;
      byId.set(d.id, { lat: d.lat, lng: d.lng, accuracyM: d.pos_accuracy_m, label: d.place_label, db: null });
    }
    for (const d of incident.detections) {
      if (!last || d.lat == null || d.lng == null || Math.abs(d.spike_ts_ms - last.t) > SHOT_WINDOW_MS) continue;
      const prev = byId.get(d.device_id);
      // Position from the detection: where the phone was when it heard the shot.
      byId.set(d.device_id, {
        lat: d.lat,
        lng: d.lng,
        accuracyM: d.pos_sigma_m != null ? d.pos_sigma_m * ACCURACY_PER_SIGMA : (prev?.accuracyM ?? null),
        label: prev?.label ?? null,
        db: Math.max(prev?.db ?? -Infinity, d.norm_peak_db),
      });
    }
    // A silent phone at the same spot as one that heard it is a stale check-in; hide it.
    // Draw phones that heard it last so they're on top.
    const all = [...byId.values()];
    const heardAt = new Set(all.filter((p) => p.db != null).map((p) => `${p.lat},${p.lng}`));
    return all
      .filter((p) => p.db != null || !heardAt.has(`${p.lat},${p.lng}`))
      .sort((a, b) => Number(a.db != null) - Number(b.db != null));
  }, [incident.detections, incident.devices, trail]);

  const trailLatLng = useMemo(() => trail.map((p) => toLatLng(p, origin)), [trail, origin]);
  // Only the count changes the icons; rebuilding them every poll would redraw the markers.
  const trailCount = trail.length;
  const trailIcons = useMemo(
    () => Array.from({ length: trailCount }, (_, i) => L.divIcon({ className: m.trailNum, html: String(i + 1), iconSize: [18, 18] })),
    [trailCount],
  );
  const places = useNearbyPlaces(best);

  return (
    <div>
      <div className={m.wrap}>
        <BaseMap center={best ?? origin} zoom={19}>
          <FitOnce points={best ? [...phones, best] : phones} />
          {heatmap && <HeatOverlay heatmap={heatmap} origin={origin} color={t.heat} />}
          <HoverLikelihood heatmap={heatmap} origin={origin} onHover={setHover} />

          {places.map((p) => (
            <CircleMarker key={p.id} center={p} radius={4} pathOptions={{ color: t["ink-2"], weight: 1, fillOpacity: 0.5 }}>
              <Tooltip>
                {p.name}
                {p.type && ` · ${p.type}`}
              </Tooltip>
            </CircleMarker>
          ))}

          {/* Shot trail */}
          {trailLatLng.length > 1 && (
            <Polyline
              positions={trailLatLng}
              interactive={false}
              pathOptions={{ color: t["ink-2"], weight: 2, dashArray: "5 4", lineJoin: "round" }}
            />
          )}
          {trailLatLng.slice(0, -1).map((p, i) => (
            <Marker key={trail[i].t} position={p} icon={trailIcons[i]} keyboard={false} interactive={false} />
          ))}

          {/* Phones at their reported positions, with how accurate that position is */}
          {phones.map((p, i) => (
            <Fragment key={i}>
              {p.accuracyM != null && (
                <Circle
                  center={p}
                  radius={p.accuracyM}
                  interactive={false}
                  pathOptions={{ color: t.muted, weight: 1, fillColor: t.muted, fillOpacity: 0.08 }}
                />
              )}
              <CircleMarker
                center={p}
                radius={6}
                pathOptions={{
                  color: p.db != null ? t.surface : t.muted,
                  weight: 2,
                  fillColor: p.db != null ? t.ink : t.surface,
                  fillOpacity: 1,
                }}
              >
                <Tooltip>
                  <b>{p.label ?? "Phone"}</b>
                  <br />
                  {p.db == null ? "Didn't hear latest shot" : `Heard latest shot at ${p.db.toFixed(1)} dB`}
                  {p.accuracyM != null && (
                    <>
                      <br />
                      Position ±{Math.round(p.accuracyM)} m
                    </>
                  )}
                </Tooltip>
              </CircleMarker>
            </Fragment>
          ))}

          {/* Best estimate */}
          {best && (
            <>
              <CircleMarker center={best} radius={14} interactive={false} pathOptions={{ color: t.critical, weight: 2, fill: false }} />
              <CircleMarker
                center={best}
                radius={6}
                pathOptions={{ color: t.surface, weight: 2, fillColor: t.critical, fillOpacity: 1 }}
              >
                <Tooltip>
                  Estimated source
                  <br />
                  {best.lat.toFixed(6)}, {best.lng.toFixed(6)}
                </Tooltip>
              </CircleMarker>
            </>
          )}
        </BaseMap>
        {hover && <div className={m.hoverBox}>{hover}</div>}
      </div>

      <ul className={s.legend}>
        <li>
          <span className={s.gradient} aria-hidden /> Likelihood vs. best spot: low → high
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
          <svg width="18" height="18" aria-hidden>
            <circle cx="9" cy="9" r="8" fill="var(--muted)" fillOpacity="0.15" stroke="var(--muted)" strokeWidth="1" />
          </svg>
          Phone position accuracy
        </li>
        <li>
          <svg width="26" height="10" aria-hidden>
            <line x1="1" y1="5" x2="25" y2="5" stroke="var(--ink-2)" strokeWidth="2" strokeDasharray="5 4" />
          </svg>
          Shot trail (numbered in order)
        </li>
      </ul>
      {!heatmap && best && (
        <p className={s.muted}>Only one phone heard the latest shot, so the estimate is that phone&apos;s position.</p>
      )}
    </div>
  );
}

/** Frame the phones and the estimate once; after that the map stays where the viewer pans it. */
function FitOnce({ points }: { points: LatLng[] }) {
  const map = useMap();
  const done = useRef(false);
  useEffect(() => {
    if (done.current || points.length === 0) return;
    done.current = true;
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.3), { maxZoom: 19 });
  }, [map, points]);
  return null;
}

/** The heatmap as one image: a pixel per grid cell, stretched over the cells' real-world extent. */
function HeatOverlay({ heatmap: h, origin, color }: { heatmap: Heatmap; origin: LatLng; color: string }) {
  const url = useMemo(() => heatImage(h, color), [h, color]);
  const bounds = useMemo(() => {
    const sw = toLatLng({ x: h.originX - h.resolution / 2, y: h.originY - h.resolution / 2 }, origin);
    const ne = toLatLng({ x: h.originX + (h.width - 0.5) * h.resolution, y: h.originY + (h.height - 0.5) * h.resolution }, origin);
    return L.latLngBounds([sw.lat, sw.lng], [ne.lat, ne.lng]);
  }, [h, origin]);
  return <ImageOverlay url={url} bounds={bounds} interactive={false} />;
}

function heatImage(h: Heatmap, color: string): string {
  const canvas = document.createElement("canvas");
  canvas.width = h.width;
  canvas.height = h.height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = color; // normalizes the token to #rrggbb
  const hex = ctx.fillStyle as string;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const img = ctx.createImageData(h.width, h.height);
  for (let row = 0; row < h.height; row++) {
    for (let col = 0; col < h.width; col++) {
      const v = h.values[row * h.width + col];
      if (v < 0.03) continue; // near-zero recedes into the map
      // Grid rows run south → north; image rows run top (north) → bottom.
      const i = ((h.height - 1 - row) * h.width + col) * 4;
      img.data[i] = r;
      img.data[i + 1] = g;
      img.data[i + 2] = b;
      img.data[i + 3] = Math.round(v * 0.85 * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL();
}

function HoverLikelihood({
  heatmap: h,
  origin,
  onHover,
}: {
  heatmap: Heatmap | null;
  origin: LatLng;
  onHover: (text: string | null) => void;
}) {
  useMapEvents({
    mousemove(e) {
      if (!h) return onHover(null);
      const p = toLocal(e.latlng, origin);
      const col = Math.round((p.x - h.originX) / h.resolution);
      const row = Math.round((p.y - h.originY) / h.resolution);
      const inside = col >= 0 && col < h.width && row >= 0 && row < h.height;
      onHover(inside ? `Relative likelihood ${Math.round(h.values[row * h.width + col] * 100)}%` : null);
    },
    mouseout: () => onHover(null),
  });
  return null;
}

/** Buildings near the estimate (SerpAPI via /api/nearby). Quietly empty when it isn't configured. */
function useNearbyPlaces(best: LatLng | null): Place[] {
  const [places, setPlaces] = useState<Place[]>([]);
  // ~10 m steps, so small refinements of the estimate don't re-query.
  const key = best ? `${best.lat.toFixed(4)},${best.lng.toFixed(4)}` : null;
  useEffect(() => {
    if (!key) return;
    const [lat, lng] = key.split(",");
    const ctrl = new AbortController();
    fetch(`/api/nearby?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { places: [] }))
      .then((d) => setPlaces(d.places ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [key]);
  return places;
}
