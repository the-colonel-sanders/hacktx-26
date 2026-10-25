import { json } from "@/lib/http";
import { clearSpaceCookie } from "@/lib/spaceCookie";

// Go back to the shared demo space.
export async function POST() {
  return clearSpaceCookie(json({ ok: true }));
}
