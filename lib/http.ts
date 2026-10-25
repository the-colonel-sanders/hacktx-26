import { NextResponse } from "next/server";
import type { z } from "zod";

export function json(data: unknown, status = 200) {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

export function fail(error: string, status = 400) {
  return json({ error }, status);
}

/** A caught error as a response: its own `status` if it has one (e.g. an unknown demo space), else 500. */
export function failFrom(e: unknown) {
  const err = e as Error & { status?: number };
  return fail(err.message, err.status ?? 500);
}

/** Parse + validate a JSON body. Returns the data, or a 400 response to return as-is. */
export async function parseBody<T extends z.ZodType>(
  req: Request,
  schema: T,
): Promise<{ data: z.infer<T> } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { response: fail("Body must be valid JSON") };
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    return { response: fail(msg) };
  }
  return { data: result.data };
}
