import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  const q = sp.get("q") ?? "buildings";

  if (!Number.isFinite(lat) || !Number.isFinite(lng) ||
      Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return NextResponse.json({ error: "Invalid coordinates" }, { status: 400 });
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_maps");
  url.searchParams.set("type", "search");
  url.searchParams.set("q", q);
  url.searchParams.set("ll", `@${lat},${lng},17z`); // 17z ≈ block-level zoom
  url.searchParams.set("api_key", process.env.SERPAPI_KEY!);

  const res = await fetch(url, { next: { revalidate: 300 } }); // cache 5 min
  if (!res.ok) {
    return NextResponse.json({ error: "SerpAPI error" }, { status: 502 });
  }

  const data = await res.json();
  const places = (data.local_results ?? [])
    .filter((p: any) => p.gps_coordinates)
    .map((p: any) => ({
      id: p.place_id ?? p.data_id,
      name: p.title,
      type: p.type,
      address: p.address,
      lat: p.gps_coordinates.latitude,
      lng: p.gps_coordinates.longitude,
    }));

  return NextResponse.json({ places });
}