"use client";

import { useEffect, useState } from "react";

// Leaflet draws with SVG attributes, which can't resolve var(--token), so read the theme colors directly.
const NAMES = ["heat", "critical", "ink", "ink-2", "surface", "muted"] as const;
export type Tokens = Record<(typeof NAMES)[number], string>;

function read(): Tokens {
  const css = getComputedStyle(document.documentElement);
  return Object.fromEntries(NAMES.map((n) => [n, css.getPropertyValue(`--${n}`).trim()])) as Tokens;
}

export function useTokens(): Tokens {
  const [tokens, setTokens] = useState<Tokens>(read);
  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const update = () => setTokens(read());
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return tokens;
}
