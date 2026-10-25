"use client";
import type { NearbyResult } from "@/app/types/nearby";

interface Props {
  data: NearbyResult | null;
  loading: boolean;
  error: string | null;
}

export default function NearbyBuildingsPanel({ data, loading, error }: Props) {
  if (loading) return <aside className="p-4">Looking up nearby buildings…</aside>;
  if (error) return <aside className="p-4 text-red-600">Lookup failed: {error}</aside>;
  if (!data) return <aside className="p-4 text-gray-500">No active incident.</aside>;

  return (
    <aside className="p-4 overflow-y-auto">
      <h2 className="font-semibold mb-2">
        Nearby buildings ({data.buildings.length})
      </h2>
      <ul className="space-y-3">
        {data.buildings.map(b => (
          <li key={b.placeId} className="border rounded p-3">
            <div className="flex justify-between">
              <span className="font-medium">{b.name}</span>
              <span className="text-sm text-gray-500">{b.distanceM} m</span>
            </div>
            <div className="text-sm">{b.type}</div>
            <div className="text-sm text-gray-600">{b.address}</div>
            {b.phone && <div className="text-sm">{b.phone}</div>}
            {b.website && (
              <a className="text-sm underline" href={b.website}
                 target="_blank" rel="noreferrer">Website</a>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}