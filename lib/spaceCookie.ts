import "server-only";
import type { NextResponse } from "next/server";
import { SPACE_COOKIE, SPACE_COOKIE_MAX_AGE_S } from "./spaces";

/** Remember the demo space in this browser; every page and API call then uses it. */
export function setSpaceCookie(res: NextResponse, code: string) {
  res.cookies.set(SPACE_COOKIE, code, {
    path: "/",
    maxAge: SPACE_COOKIE_MAX_AGE_S,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return res;
}

export function clearSpaceCookie(res: NextResponse) {
  res.cookies.set(SPACE_COOKIE, "", { path: "/", maxAge: 0 });
  return res;
}
