import { NextResponse } from "next/server";
import { setSpaceCookie } from "@/lib/spaceCookie";
import { spaceByCode } from "@/lib/spaces";

const PAGES = new Set(["phone", "incident", "calibrate", "admin", "spaces"]);

// /join/K7Q2?to=phone — what the space's QR codes and links point at. Remembers the space in this
// browser, then opens the page. Room codes can ride along: /join/K7Q2?to=phone&room=203.
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const url = new URL(req.url);
  const to = url.searchParams.get("to") ?? "phone";
  const space = await spaceByCode(code);
  if (!space) return NextResponse.redirect(new URL(`/spaces?missing=${encodeURIComponent(code)}`, url));

  const dest = new URL(`/${PAGES.has(to) ? to : "phone"}`, url);
  for (const [k, v] of url.searchParams) if (k !== "to") dest.searchParams.set(k, v);
  return setSpaceCookie(NextResponse.redirect(dest), space.code);
}
