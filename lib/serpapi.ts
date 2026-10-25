import type { NearbyBuilding } from "@/app/types/nearby";

const haversine = (a: [number, number], b: [number, number]) => {
  const R = 6371000, rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

export async function fetchNearbyBuildings(
  lat: number,
  lng: number,
  query = "buildings",
  zoom = 18
): Promise<NearbyBuilding[]> {
  const params = new URLSearchParams({
    engine: "google_maps",
    type: "search",
    q: query,
    ll: `@${lat},${lng},${zoom}z`,
    api_key: process.env.SERPAPI_KEY!,
  });

  const res = await fetch(`https://serpapi.com/search.json?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`SerpAPI ${res.status}`);
  const data = await res.json();

  return (data.local_results ?? []).map((r: any): NearbyBuilding => ({
    placeId: r.place_id,
    name: r.title,
    type: r.type,
    address: r.address,
    lat: r.gps_coordinates?.latitude,
    lng: r.gps_coordinates?.longitude,
    rating: r.rating,
    phone: r.phone,
    website: r.website,
    thumbnail: r.thumbnail,
    distanceM: r.gps_coordinates
      ? Math.round(haversine([lat, lng], [r.gps_coordinates.latitude, r.gps_coordinates.longitude]))
      : undefined,
  }))
  .filter((b: NearbyBuilding) => b.placeId && b.lat != null)
  .sort((a: NearbyBuilding, b: NearbyBuilding) => (a.distanceM ?? 1e9) - (b.distanceM ?? 1e9));
}