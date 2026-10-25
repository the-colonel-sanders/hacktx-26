"use client";

// Leaflet needs `window`, so pages load the components built on this with next/dynamic({ ssr: false }).
import "leaflet/dist/leaflet.css";
import type { LatLngExpression } from "leaflet";
import { MapContainer, TileLayer } from "react-leaflet";
import s from "./map.module.css";

const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** OpenStreetMap tiles. Zooms past the tiles' native 19 so a single room can fill the screen. */
export function BaseMap({
  center,
  zoom,
  className,
  children,
}: {
  center: LatLngExpression;
  zoom: number;
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <MapContainer center={center} zoom={zoom} maxZoom={21} className={`${s.map} ${className ?? ""}`}>
      <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution={OSM_ATTRIBUTION} maxNativeZoom={19} maxZoom={21} />
      {children}
    </MapContainer>
  );
}
