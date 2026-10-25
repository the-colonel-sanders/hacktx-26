import type { Metadata } from "next";
import Link from "next/link";
import SpaceBadge, { SpaceBanner } from "./components/SpaceBadge";
import "./globals.css";

export const metadata: Metadata = { title: "Gunshot Locator" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <nav className="nav">
          <Link href="/" className="brand">
            Gunshot Locator
          </Link>
          <SpaceBadge />
          <Link href="/">Docs</Link>
          <Link href="/incident">Incident dashboard</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/phone">Phone</Link>
          <Link href="/calibrate">Timing calibration</Link>
          <a href="/api/incidents/current" target="_blank" rel="noreferrer">
            Raw JSON
          </a>
        </nav>
        <SpaceBanner />
        {children}
      </body>
    </html>
  );
}
