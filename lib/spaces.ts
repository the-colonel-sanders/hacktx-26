import "server-only";
import { db } from "./supabase";

// Demo spaces: separate sandboxes (one per judge or team), each with its own phones, incident,
// alerts, status reports, timing calibration and phone settings.
//
// A request's space comes from, in order: an `x-space` header (scripts), a `?space=` query
// parameter, or the `space` cookie set by /join/<code>. With none, it's the shared DEMO space,
// which also holds everything from before spaces existed. Routes that take a deviceId use that
// phone's space instead (`spaceOfDevice`), so a phone keeps reporting where it checked in.

export const DEFAULT_SPACE_ID = "00000000-0000-4000-8000-000000000000";
export const SPACE_COOKIE = "space";
export const SPACE_COOKIE_MAX_AGE_S = 7 * 24 * 3600;

export type Space = { id: string; code: string; name: string | null };

export class SpaceNotFound extends Error {
  status = 404;
  constructor(code: string) {
    super(`No demo space with code ${code}. Check the code, or start a new space.`);
  }
}

// No 0/O, 1/I/L: codes get read aloud and typed on phones.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 4;

export const normalizeCode = (code: string) => code.trim().toUpperCase();

function cookieValue(req: Request, name: string): string | null {
  const header = req.headers.get("cookie") ?? "";
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function requestedCode(req: Request): string | null {
  const raw = req.headers.get("x-space") ?? new URL(req.url).searchParams.get("space") ?? cookieValue(req, SPACE_COOKIE);
  return raw ? normalizeCode(raw) : null;
}

export async function spaceByCode(code: string): Promise<Space | null> {
  const { data, error } = await db().from("spaces").select("id, code, name").eq("code", normalizeCode(code)).maybeSingle();
  if (error) throw error;
  return data;
}

/** The space this request is for. Throws SpaceNotFound for a code that doesn't exist. */
export async function spaceFromRequest(req: Request): Promise<Space> {
  const code = requestedCode(req);
  if (!code) return { id: DEFAULT_SPACE_ID, code: "DEMO", name: "Shared demo" };
  const space = await spaceByCode(code);
  if (!space) throw new SpaceNotFound(code);
  return space;
}

export async function createSpace(name: string | null): Promise<Space> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
    const code = Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
    const { data, error } = await db().from("spaces").insert({ code, name }).select("id, code, name").single();
    if (!error) return data;
    if (error.code !== "23505") throw error; // anything but a code collision
  }
  throw new Error("Couldn't pick a free space code; try again");
}

/** Record activity, so idle spaces can be cleaned up later. Best effort. */
export async function touchSpace(spaceId: string) {
  await db().from("spaces").update({ last_active_at: new Date().toISOString() }).eq("id", spaceId);
}
