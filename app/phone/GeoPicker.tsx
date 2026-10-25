"use client";

import L from "leaflet";
import { useEffect, useMemo } from "react";
import { Circle, Marker, useMap, useMapEvents } from "react-leaflet";
import { DEFAULT_CENTER, type LatLng } from "@/lib/geo";
import { BaseMap } from "../map/BaseMap";
import m from "../map/map.module.css";
import { useTokens } from "../map/useTokens";

export type GeoSpot = LatLng & { accuracyM: number };

/**
 * Tap the map or drag the pin to set a spot on the real map; the circle shows how accurate it is.
 * With `follow`, the map recenters when the spot moves (a better GPS fix arriving).
 * `center` is where to open when there's no spot yet (e.g. around the phones); it's read once, at mount.
 * Load with next/dynamic({ ssr: false }): Leaflet needs `window`.
 */
export default function GeoPicker({
  value,
  onChange,
  follow = false,
  center,
}: {
  value: GeoSpot | null;
  onChange: (p: LatLng) => void;
  follow?: boolean;
  center?: LatLng | null;
}) {
  return (
    <BaseMap center={value ?? center ?? DEFAULT_CENTER} zoom={value ? 19 : center ? 18 : 16}>
      <Pin value={value} onChange={onChange} follow={follow} />
    </BaseMap>
  );
}

function Pin({ value, onChange, follow }: { value: GeoSpot | null; onChange: (p: LatLng) => void; follow: boolean }) {
  const map = useMap();
  const t = useTokens();
  const icon = useMemo(() => L.divIcon({ className: m.pin, iconSize: [22, 22] }), []);
  useMapEvents({ click: (e) => onChange({ lat: e.latlng.lat, lng: e.latlng.lng }) });

  const lat = value?.lat;
  const lng = value?.lng;
  useEffect(() => {
    if (follow && lat != null && lng != null) map.setView([lat, lng], Math.max(map.getZoom(), 18));
  }, [follow, lat, lng, map]);

  if (!value) return null;
  return (
    <>
      <Circle
        center={value}
        radius={value.accuracyM}
        interactive={false}
        pathOptions={{ color: t.heat, weight: 1.5, fillColor: t.heat, fillOpacity: 0.12 }}
      />
      <Marker
        position={value}
        icon={icon}
        draggable
        keyboard={false}
        eventHandlers={{
          dragend: (e) => {
            const p = (e.target as L.Marker).getLatLng();
            onChange({ lat: p.lat, lng: p.lng });
          },
        }}
      />
    </>
  );
}
