import { useEffect, useState } from "react";
import {
  APIProvider, Map, AdvancedMarker, InfoWindow, Pin, useMap,
} from "@vis.gl/react-google-maps";

type Place = { id: string; name: string; type?: string; address?: string; lat: number; lng: number };
type Props = { lat: number; lng: number; radiusMeters?: number };

function UncertaintyCircle({ lat, lng, radius }: { lat: number; lng: number; radius: number }) {
  const map = useMap();
  useEffect(() => {
    if (!map) return;
    const circle = new google.maps.Circle({
      map, center: { lat, lng }, radius,
      strokeColor: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.15,
    });
    return () => circle.setMap(null);
  }, [map, lat, lng, radius]);
  return null;
}

export default function ShotMap({ lat, lng, radiusMeters = 100 }: Props) {
  const [places, setPlaces] = useState<Place[]>([]);
  const [selected, setSelected] = useState<Place | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch(`/api/nearby?lat=${lat}&lng=${lng}`, { signal: ctrl.signal })
      .then((r) => r.json())
      .then((d) => setPlaces(d.places ?? []))
      .catch(() => {});
    return () => ctrl.abort();
  }, [lat, lng]);

  return (
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!}>
      <Map
        style={{ width: "100%", height: "100vh" }}
        defaultCenter={{ lat, lng }}
        defaultZoom={17}
        mapId="DEMO_MAP_ID" // required for AdvancedMarker; use your own Map ID in production
      >
        <AdvancedMarker position={{ lat, lng }}>
          <Pin background="#dc2626" glyphColor="#fff" />
        </AdvancedMarker>
        <UncertaintyCircle lat={lat} lng={lng} radius={radiusMeters} />

        {places.map((p) => (
          <AdvancedMarker key={p.id} position={p} onClick={() => setSelected(p)} />
        ))}

        {selected && (
          <InfoWindow position={selected} onCloseClick={() => setSelected(null)}>
            <strong>{selected.name}</strong>
            <div>{selected.type}</div>
            <div>{selected.address}</div>
          </InfoWindow>
        )}
      </Map>
    </APIProvider>
  );
}