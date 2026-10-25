import { NextRequest, NextResponse } from "next/server";
import { fetchNearbyBuildings } from "@/lib/serpapi";
import { cacheKey, getCached, setCached } from "@/lib/nearbyCache";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) {
    return NextResponse.json({ error: "Missing query" }, { status: 400 });
  }
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  alert(lat + ", " + lng);
  const eventId = sp.get("eventId") ?? "unknown";

  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const key = cacheKey(lat, lng);
  const cached = getCached(key);
  if (cached) return NextResponse.json({ ...cached, eventId });
  const params = new URLSearchParams({
      engine: "google_maps",
      type: "search",
      q,
      api_key: process.env.SERPAPI_KEY!,
  });

  // Optional: bias results to a location, format "@lat,lng,zoom"
  // params.set("ll", "@30.2672,-97.7431,14z");
  try {
    const buildings = await fetchNearbyBuildings(lat, lng);
    const result = { eventId, fetchedAt: new Date().toISOString(), buildings };
    setCached(key, result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Upstream lookup failed" }, { status: 502 });
  }
}