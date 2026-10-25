import { z } from "zod";
import { failFrom, json, parseBody } from "@/lib/http";
import { setSpaceCookie } from "@/lib/spaceCookie";
import { createSpace } from "@/lib/spaces";

const Body = z.object({ name: z.string().trim().max(60).optional() });

// Start a new demo space and switch this browser into it.
export async function POST(req: Request) {
  const parsed = await parseBody(req, Body);
  if ("response" in parsed) return parsed.response;
  try {
    const space = await createSpace(parsed.data.name || null);
    return setSpaceCookie(json(space), space.code);
  } catch (e) {
    return failFrom(e);
  }
}
