import type { Metadata } from "next";
import Link from "next/link";
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
          <Link href="/">Docs</Link>
          <Link href="/incident">Incident dashboard</Link>
          <Link href="/admin">Admin</Link>
          <Link href="/phone">Phone</Link>
          <Link href="/calibrate">Timing calibration</Link>
          <Link href="/qr">Room QR codes</Link>
          <a href="/api/incidents/current" target="_blank" rel="noreferrer">
            Raw JSON
          </a>
        </nav>
        {children}
      </body>
    </html>
  );
}
