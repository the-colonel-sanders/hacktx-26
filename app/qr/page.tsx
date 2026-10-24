"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ROOMS } from "@/lib/floorplan";
import s from "./qr.module.css";

// One QR per room. Scanning opens /phone with the room preselected.
export default function QrPage() {
  const [origin, setOrigin] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});

  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    if (!origin) return;
    Promise.all(
      ROOMS.map(async (r) => [r.id, await QRCode.toDataURL(`${origin}/phone?room=${r.id}`, { margin: 1, width: 360 })]),
    ).then((pairs) => setCodes(Object.fromEntries(pairs)));
  }, [origin]);

  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <main className={s.page}>
      <h1 className={s.title}>Room check-in codes</h1>
      <p className={s.hint}>Print and post one in each room. Scanning opens the listener with that room selected.</p>
      {isLocal && (
        <p className={s.warn}>
          These codes point to <b>{origin}</b>, which phones can&apos;t reach. Open this page from your deployed or
          https tunnel URL before printing.
        </p>
      )}
      <div className={s.grid}>
        {ROOMS.map((r) => (
          <figure key={r.id} className={s.card}>
            {codes[r.id] ? <img src={codes[r.id]} alt={`QR code for ${r.name}`} className={s.qr} /> : <div className={s.qr} />}
            <figcaption>
              <b>{r.name}</b>
              <span className={s.url}>/phone?room={r.id}</span>
            </figcaption>
          </figure>
        ))}
      </div>
    </main>
  );
}
