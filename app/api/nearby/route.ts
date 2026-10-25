import { NextRequest, NextResponse } from "next/server";
import { fetchNearbyBuildings } from "@/lib/serpapi";
import { cacheKey, getCached, setCached } from "@/lib/nearbyCache";
// Gets positioning data
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  const eventId = sp.get("eventId") ?? "unknown";

  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const key = cacheKey(lat, lng);
  const cached = getCached(key);
  if (cached) return NextResponse.json({ ...cached, eventId });

  try {
    const buildings = await fetchNearbyBuildings(lat, lng);
    const result = { eventId, fetchedAt: new Date().toISOString(), buildings };
    setCached(key, result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: "Upstream lookup failed" }, { status: 502 });
  }
}