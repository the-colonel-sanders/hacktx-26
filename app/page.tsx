"use client";
import Link from "next/link";
import { ROOMS } from "@/lib/floorplan";
import s from "./home.module.css";
import { useState, useEffect } from "react";
import NearbyBuildingsPanel from "@/app/components/NearbyBuildingsPanel";
import { useNearbyBuildings } from "@/app/hooks/useNearbyBuildings";
import type { GunshotEvent } from "@/app/types/nearby";

const PAGES: { href: string; title: string; desc: string; external?: boolean }[] = [
  { href: "/incident", title: "Incident dashboard", desc: "Live map, heatmap, shot trail and detections for the active incident." },
  { href: "/admin", title: "Admin", desc: "Manage the phones: location mode, lockdown screen, timing, simulated shots and mic calibration." },
  { href: "/phone", title: "Phone listener", desc: "Open on each phone: check in and listen. Its settings come from the admin panel." },
  { href: "/calibrate", title: "Timing calibration", desc: "Measure each phone's audio delay with one reference sound at a known spot." },
  { href: "/qr", title: "Room QR codes", desc: "Printable codes that open the listener with a room preselected." },
  { href: "/api/incidents/current", title: "Raw incident JSON", desc: "What the dashboard reads, for debugging.", external: true },
];

const ROUTES: [string, string, string][] = [
  ["GET", "/api/time", "Server clock. Phones sample it 12× (after a warm-up request) and keep the fastest round trip to compute their clock offset."],
  ["POST", "/api/checkin", "{ deviceId?, roomId OR x/y in meters OR lat/lng + accuracyM (+ label), clockOffsetMs, clockRttMs? } → { deviceId, frame, roomId }. With x/y, the room is the nearest one."],
  ["POST", "/api/calibrate", "{ deviceId, peakDb } from a reference clap → stores the mic gain offset"],
  ["POST", "/api/detection", "{ deviceId, localSpikeTsMs, peakDb, confidence, label } → { incidentId, estimate: { x, y, lat, lng, roomId, label, deviceCount } }"],
  ["POST", "/api/status", "{ deviceId, status: safe | need_help | injured }"],
  ["POST", "/api/alert", "Raise a manual alert (creates an incident if none is active)"],
  ["POST", "/api/all-clear", "Clear the active incident"],
  ["GET", "/api/incidents/current", "Active incident with heatmap, trail, detections, status reports and recently active phones, or null (dashboard)"],
  ["GET", "/api/incidents/summary", "Just the active incident's id, status and estimated place, or null (what phones poll)"],
  ["GET", "/api/phones", "Recently active phones with where each is checked in and its settings (admin panel)"],
  ["GET", "/api/phones/settings", "?deviceId= → the settings a phone should follow (phones poll this)"],
  ["POST", "/api/phones/settings", "{ target: deviceId | \"all\", patch }: change phone settings from the admin panel"],
  ["POST", "/api/phones/calibrate-mic", "{ deviceId }: ask a phone to calibrate its mic on the next clap"],
  ["GET", "/api/timing-cal", "Running timing calibration (with phones that have reported) and the last finished one"],
  ["POST", "/api/timing-cal/start", "{ x, y } or { lat, lng }: where the reference sound will be made"],
  ["POST", "/api/timing-cal/report", "{ deviceId, localSpikeTsMs, peakDb }: a phone heard the reference (loudest kept)"],
  ["POST", "/api/timing-cal/finish", "Compute each phone's delay and apply it to future detections"],
  ["POST", "/api/timing-cal/cancel", "Stop a running calibration"],
  ["GET", "/api/nearby", "?lat&lng&q: nearby buildings for the real-map view (needs SERPAPI_KEY)"],
];

export default function Home() {

  const [latestGunshot, setLatestGunshot] = useState<GunshotEvent | null>(null)
  
  useEffect(() => {
    const tick = async () => {
      try {
        const r = await fetch("/api/incidents/current");
        if (!r.ok) return;
        const inc = await r.json();
        const est = inc?.estimate; // verify this path, see below
        if (!est || typeof est.lat !== "number" || typeof est.lng !== "number") {
          setLatestGunshot(null);
          return;
        }
        const id = String(inc.id ?? inc.incidentId ?? `${est.lat},${est.lng}`);
        setLatestGunshot(prev =>
          prev?.id === id && prev.lat === est.lat && prev.lng === est.lng
            ? prev
            : { id, lat: est.lat, lng: est.lng, timestamp: new Date().toISOString() }
        );
      } catch {}
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);
  const { data, loading, error } = useNearbyBuildings(latestGunshot);
  console.log(latestGunshot, data, loading, error);

  return (
    <main className={s.page}>
      <section>
        <h1 className={s.title}>Gunshot Locator</h1>
        <p className={s.lead}>
          Phones listen for gunshots on-device and report only event metadata (time, loudness, confidence), never
          audio. The server groups reports into shots, estimates where the sound came from, and raises a
          building-wide alert.
        </p>
      </section>

      <nav className={s.links} aria-label="Pages">
        {PAGES.map((p) =>
          p.external ? (
            <a key={p.href} href={p.href} target="_blank" rel="noreferrer" className={s.linkCard}>
              <span className={s.linkTitle}>{p.title} ↗</span>
              <span className={s.linkDesc}>{p.desc}</span>
            </a>
          ) : (
            <Link key={p.href} href={p.href} className={s.linkCard}>
              <span className={s.linkTitle}>{p.title} →</span>
              <span className={s.linkDesc}>{p.desc}</span>
            </Link>
          ),
        )}
      </nav>

      <section className={s.card}>
        <h2>Try it on one laptop</h2>
        <ol className={s.steps}>
          <li>
            Open the <Link href="/incident">incident dashboard</Link>.
          </li>
          <li>
            Simulate one phone per room hearing a shot from (9, 2) m:
            <pre>npx tsx scripts/simulate.ts 9 2</pre>
          </li>
          <li>
            A shooter moving 6 m between 3 shots, or phones on the real map:
            <pre>
              npx tsx scripts/simulate.ts 2 -2 --shots 3 --move 6{"\n"}npx tsx scripts/simulate.ts 9 2 --geo
              30.2849,-97.7341
            </pre>
          </li>
          <li>
            Watch the estimate and trail update, then press <b>All clear</b>. The simulator clears the previous
            incident first; add <code>--keep</code> to append, <code>--rooms 202,204</code> to use fewer phones, or{" "}
            <code>--parallel</code> to have every phone report at the same instant, like real phones.
          </li>
        </ol>
        <p className={s.muted}>
          Several browser tabs also work as separate phones (each tab gets its own device ID), but they share one mic:
          real claps reach them at the same time and loudness, so use <b>Simulate shot</b> to make them disagree.
        </p>
      </section>

      <section className={s.card}>
        <h2>Test with real phones</h2>
        <ol className={s.steps}>
          <li>
            Phones need HTTPS for the mic. Run the app and tunnel it:
            <pre>npm run dev{"\n"}ngrok http 3000</pre>
            Open the <code>https://…ngrok-free.app</code> address on each phone (tap <b>Visit Site</b> on ngrok&apos;s
            warning page once).
          </li>
          <li>
            On <Link href="/phone">/phone</Link>, choose where the phone is, then tap <b>Start listening</b>:
            <ul>
              <li>
                <b>Room</b>: the room center (rough, ±a few meters)
              </li>
              <li>
                <b>Exact spot</b>: tap the floor plan or type x/y in meters (best for the demo floor)
              </li>
              <li>
                <b>Real map</b>: GPS on OpenStreetMap; drag the pin to the phone&apos;s real spot (±4 m)
              </li>
            </ul>
          </li>
          <li>
            Tap <b>Calibrate</b> and clap once about 1 m away, so loudness is comparable across phones.
          </li>
          <li>
            Run a <Link href="/calibrate">timing calibration</Link> once all phones are listening: one sharp sound at a
            known spot measures each phone&apos;s audio delay (needs exact-spot or pinned phones).
          </li>
          <li>
            Clap, or use <b>Simulate shot</b>: phones that tap during the same 10-second window report the same shot,
            each with the loudness and delay you type.
          </li>
        </ol>
        <p className={s.muted}>
          Keep screens on: the phone card shows whether the screen is held awake, since the mic stops when it sleeps.
          The <b>Lockdown screen</b> switch (off by default while testing) controls whether alerts take over the
          phone.
        </p>
      </section>

      <section className={s.card}>
        <h2>Reading the dashboard</h2>
        <dl className={s.defs}>
          <dt>Map</dt>
          <dd>The demo floor plan (meters), or OpenStreetMap when the incident&apos;s phones checked in on the real map.</dd>
          <dt>Blue heatmap</dt>
          <dd>
            How well each 0.5 m cell explains the reports, relative to the best cell. Stronger blue = more plausible;
            it&apos;s not a probability, so several cells can be near 100% when the data can&apos;t tell them apart.
          </dd>
          <dt>Red ringed dot</dt>
          <dd>Best estimate for the latest shot, labeled with its nearest room or map label.</dd>
          <dt>Numbered dashed line</dt>
          <dd>Earlier shots in order, so you can see a shooter moving.</dd>
          <dt>Solid / hollow phones</dt>
          <dd>Solid phones heard the latest shot (with their loudness); hollow ones are listening but didn&apos;t.</dd>
          <dt>Detections table</dt>
          <dd>Grouped by shot, newest first: each phone&apos;s position, how long after the first phone it heard the shot, loudness and confidence.</dd>
        </dl>
      </section>

      <section className={s.card}>
        <h2>How localization works</h2>
        <ol className={s.steps}>
          <li>
            <b>Line up the reports.</b> Each phone sends its own clock time of the sound&apos;s onset. The server adds
            the phone&apos;s clock offset (re-synced every minute) and subtracts its calibrated audio delay; loudness
            gets the mic calibration.
          </li>
          <li>
            <b>Group into shots.</b> Reports within ±300 ms are one shot. One phone can only say &quot;near this
            phone&quot;; two or more go to the grid search.
          </li>
          <li>
            <b>Score every 0.5 m cell.</b> Loudness should fall 6 dB per doubling of distance, and each phone should
            hear the shot <i>distance ÷ 343 m/s</i> after it was fired. The gun&apos;s loudness and firing time are
            unknown, so they&apos;re fitted per cell; only differences between phones matter. Each phone counts by how
            accurate its position and timing are.
          </li>
          <li>
            <b>Pick the best fit.</b> The lowest-cost cell is the estimate. Two phones leave two mirror-image answers;
            a third phone off their line settles it.
          </li>
        </ol>
        <p className={s.muted}>
          Tunables live in <code>lib/localize.ts</code> (and <code>lib/geo.ts</code> for the real map).
        </p>
      </section>

      <section className={s.card}>
        <h2>API</h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <tbody>
              {ROUTES.map(([method, path, desc]) => (
                <tr key={method + path}>
                  <td>
                    <span className={method === "GET" ? s.get : s.post}>{method}</span>
                  </td>
                  <td className={s.mono}>
                    {method === "GET" && path !== "/api/nearby" ? (
                      <a href={path} target="_blank" rel="noreferrer">
                        {path}
                      </a>
                    ) : (
                      path
                    )}
                  </td>
                  <td>{desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={s.card}>
        <h2>Rooms</h2>
        <p className={s.muted}>
          Use these IDs as <code>roomId</code> at check-in. Coordinates are meters on the demo floor plan, which
          runs x −3 to 30, y −4 to 8.
        </p>
        <ul className={s.rooms}>
          {ROOMS.map((r) => (
            <li key={r.id}>
              <code>{r.id}</code> {r.name}{" "}
              <span className={s.muted}>
                ({r.x}, {r.y})
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={s.card}>
        <h2>Buildings</h2>
        {/* new */}
        <div className="w-96 border-l">
          <NearbyBuildingsPanel data={data} loading={loading} error={error} />
        </div>
      </section>
    </main>
  );
}
