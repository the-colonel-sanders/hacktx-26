"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSpace } from "./useSpace";

/** Nav bar: "Try demo" until you're in a demo space, then that space's code. */
export default function SpaceBadge() {
  const space = useSpace();
  const inSpace = space && "code" in space && !space.shared;
  return (
    <Link
      href="/spaces"
      className={inSpace ? "spaceBadge" : "spaceBadge tryDemo"}
      title="Demo spaces: start, join or invite phones"
    >
      {space && "missing" in space ? "Space not found" : inSpace ? `Demo ${space.code}` : "Try demo"}
    </Link>
  );
}

/** Under the nav, on every page: the demo code and how phones join, so it's always there to share. */
export function SpaceBanner() {
  const space = useSpace();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);
  if (!space || !("code" in space) || space.shared) return null;
  return (
    <div className="spaceBanner">
      <span>
        Demo code <b className="spaceCode">{space.code}</b>
        {space.name && <span className="spaceName"> · {space.name}</span>}
      </span>
      <span className="spaceJoin">
        Phones join at <code>{origin.replace(/^https?:\/\//, "")}/join/{space.code}</code>
      </span>
      <Link href="/spaces">Invite phones →</Link>
    </div>
  );
}
