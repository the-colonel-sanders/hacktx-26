"use client";

import { useEffect, useState } from "react";

export type CurrentSpace = { id: string; code: string; name: string | null; shared: boolean } | { missing: true } | null;

/** The demo space this browser is in; re-reads when /spaces creates, joins or leaves one. */
export function useSpace(): CurrentSpace {
  const [space, setSpace] = useState<CurrentSpace>(null);
  useEffect(() => {
    const load = () =>
      fetch("/api/spaces/current", { cache: "no-store" })
        .then((r) => r.json().then((d) => setSpace(r.ok ? d : { missing: true })))
        .catch(() => {});
    load();
    window.addEventListener("space-changed", load);
    return () => window.removeEventListener("space-changed", load);
  }, []);
  return space;
}
