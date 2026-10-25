"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SpaceBadge, { SpaceBanner } from "./SpaceBadge";
import Logo from "./Logo";

// The demo flow, in the order a visitor uses it, then the supporting tools.
const PRIMARY = [
  { href: "/phone", label: "Add phone" },
  { href: "/incident", label: "Dashboard" },
  { href: "/admin", label: "Admin" },
];
const SECONDARY = [
  { href: "/calibrate", label: "Calibration" },
  { href: "/docs", label: "Docs" },
];

/** The app's nav bar and demo-space banner. The landing page draws its own header, so they hide there. */
export default function AppNav() {
  const path = usePathname();
  if (path === "/") return null;
  const link = ({ href, label }: { href: string; label: string }) => (
    <Link key={href} href={href} aria-current={path.startsWith(href) ? "page" : undefined}>
      {label}
    </Link>
  );
  return (
    <>
      <nav className="nav" aria-label="App">
        <Link href="/" className="brand">
          <Logo size={20} />
          belugo
        </Link>
        <div className="navLinks">
          <div className="navGroup">{PRIMARY.map(link)}</div>
          <span className="navDivider" aria-hidden="true" />
          <div className="navGroup navGroupQuiet">
            {SECONDARY.map(link)}
            <a href="/api/incidents/current" target="_blank" rel="noreferrer" className="navJson">
              JSON ↗
            </a>
          </div>
        </div>
        <SpaceBadge />
      </nav>
      <SpaceBanner />
    </>
  );
}
