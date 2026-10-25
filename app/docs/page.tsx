"use client";
import Link from "next/link";
import { ROOMS } from "@/lib/floorplan";
import s from "../home.module.css";
import { useState, useEffect } from "react";
import NearbyBuildingsPanel from "@/app/components/NearbyBuildingsPanel";
import { useNearbyBuildings } from "@/app/hooks/useNearbyBuildings";
import type { GunshotEvent } from "@/app/types/nearby";

const PAGES: { href: string; title: string; desc: string; external?: boolean }[] = [
  { href: "/spaces", title: "Live demo", desc: "Your own private demo, with step-by-step instructions and a QR code for phones." },
  { href: "/phone", title: "Phone listener", desc: "Open this on each phone (or browser tab) that should listen." },
  { href: "/admin", title: "Admin", desc: "Manage the phones: where they are, test buttons, alerts and calibration." },
  { href: "/calibrate", title: "Timing calibration", desc: "Measure each phone's audio delay with one sound at a known spot (optional)." },
];

const ROUTES: [string, string, string][] = [
  ["POST", "/api/spaces", "{ name? }: start a demo space and switch this browser into it → { id, code, name }"],
  ["GET", "/api/spaces/current", "The demo space this request is in (cookie from /join/CODE, ?space=CODE or an x-space header; otherwise the shared space)"],
  ["POST", "/api/spaces/leave", "Go back to the shared demo space"],
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

  const [latestGunshot, setLatestGunshot] = useState<GunshotEvent | null>({ id: "t1", lat: 30.2672, lng: -97.7431, timestamp: "" })
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

  return (
    <main className={s.page}>
      <section>
        <h1 className={s.title}>How Belugo works</h1>
        <p className={s.lead}>
          Ordinary phones in classrooms listen for a gunshot. When several of them hear one, the system works out
          where it came from, from <b>how loud</b> it was and <b>how soon</b> each phone heard it, and alerts
          everyone in the building within seconds.
        </p>
        <div className={s.ctaRow}>
          <Link href="/spaces" className={s.cta}>
            Open the live demo →
          </Link>
        </div>
        <p className={s.note}>
          A hackathon prototype (HackTX 2026), not a validated gunshot detector or emergency system. Please test with
          claps or the <b>Simulate shot</b> button only.
        </p>
      </section>

      <section className={s.card}>
        <h2>How it works</h2>
        <ol className={s.flow}>
          <li>
            <b>Phones listen.</b> Each phone runs a web page that listens to its microphone. The audio is analyzed on
            the phone itself and never leaves it.
          </li>
          <li>
            <b>They report a bang.</b> When a phone hears a sudden, sharp sound, it sends only <i>when</i> it heard it
            and <i>how loud</i> it was.
          </li>
          <li>
            <b>The server compares.</b> Sound travels about 1 m every 3 ms and gets quieter with distance, so phones
            closer to the shot hear it sooner and louder. The server finds the spot that best explains every
            phone&apos;s report.
          </li>
          <li>
            <b>Everyone is alerted.</b> The dashboard shows the estimated location, and every listening phone gets the
            alert and can report &quot;I&apos;m safe&quot;, &quot;Need help&quot; or &quot;Injured&quot;.
          </li>
        </ol>
      </section>

      <section className={s.card} id="demo">
        <h2>Try it</h2>
        <p className={s.muted}>
          The <Link href="/spaces">live demo</Link> walks you through it step by step in about 2 minutes: it sets up your
          own private demo, then three browser tabs act as three phones in three rooms and you fire a pretend shot. After
          that you can add your own phone with a QR code and clap.
        </p>
        <div className={s.ctaRow}>
          <Link href="/spaces" className={s.cta}>
            Open the live demo →
          </Link>
        </div>
      </section>

      <section className={s.card}>
        <h2>Reading the dashboard</h2>
        <dl className={s.defs}>
          <dt>Blue shading</dt>
          <dd>
            Where the shot could have come from: the darker, the better that spot explains what the phones heard. A
            large shaded area means the phones couldn&apos;t narrow it down.
          </dd>
          <dt>Red ringed dot</dt>
          <dd>The best estimate for the latest shot, with the nearest room named above the map.</dd>
          <dt>Numbered dashed line</dt>
          <dd>Earlier shots in order, so you can see if a shooter is moving.</dd>
          <dt>Solid / hollow dots</dt>
          <dd>Phones that heard the latest shot (with how loud) / phones that are listening but didn&apos;t.</dd>
          <dt>Status reports</dt>
          <dd>People on the phones reporting safe, need help or injured, and where they are.</dd>
          <dt>Detections table</dt>
          <dd>Every phone&apos;s report, grouped by shot: how long after the first phone it heard it, and how loud.</dd>
        </dl>
      </section>

      <section className={s.card}>
        <h2>Privacy and limits</h2>
        <ul className={s.bullets}>
          <li>
            <b>No recordings leave the phone.</b> Only the time, loudness and a confidence score of a detected sound are
            sent. Phones listen only after someone presses <b>Start listening</b>.
          </li>
          <li>
            <b>The detector is a placeholder.</b> It accepts any short, sharp sound, which is why a clap works for the
            demo. A real deployment needs a trained gunshot classifier.
          </li>
          <li>
            <b>The location is an estimate.</b> It depends on knowing where each phone is, on how many phones heard the
            shot, and on echoes. Three or more phones around the area give the best results.
          </li>
          <li>
            <b>Not for real emergencies.</b> Use it to evaluate the idea, not to make safety decisions.
          </li>
        </ul>
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
        <h2>Nearby buildings</h2>
        <p className={s.muted}>Buildings around the latest estimate, when phones are on the real map.</p>
        <div className="w-96 border-l">
          <NearbyBuildingsPanel data={data} loading={loading} error={error} />
        </div>
      </section>

      <details className={s.details}>
        <summary>For developers</summary>

        <section className={s.devBlock}>
          <h2>Simulate without any phones</h2>
          <p className={s.muted}>With the dev server running, fake phones in every room report a shot at (9, 2) m:</p>
          <pre>npx tsx scripts/simulate.ts 9 2</pre>
          <p className={s.muted}>
            A shooter moving 6 m between 3 shots, or phones on the real map:
          </p>
          <pre>
            npx tsx scripts/simulate.ts 2 -2 --shots 3 --move 6{"\n"}npx tsx scripts/simulate.ts 9 2 --geo
            30.2849,-97.7341
          </pre>
          <p className={s.muted}>
            The simulator clears the previous incident first; add <code>--keep</code> to append,{" "}
            <code>--rooms 202,204</code> to use fewer phones, <code>--parallel</code> to have every phone report at the
            same instant, or <code>--space CODE</code> to run in a demo space.
          </p>
        </section>

        <section className={s.devBlock}>
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
              <b>Score every grid cell.</b> Loudness should fall 6 dB per doubling of distance, and each phone should
              hear the shot <i>distance ÷ 343 m/s</i> after it was fired. The gun&apos;s loudness and firing time are
              unknown, so they&apos;re fitted per cell; only differences between phones matter. Each phone counts by
              how accurate its position and timing are, and the shading is the likelihood relative to the best cell.
            </li>
            <li>
              <b>Pick the best fit.</b> The lowest-cost cell is the estimate. Two phones leave two mirror-image answers;
              a third phone off their line settles it.
            </li>
          </ol>
          <p className={s.muted}>
            Tunables live in <code>lib/localize.ts</code> (and <code>lib/geo.ts</code> for the real map). Phone
            settings are managed in the <Link href="/admin">admin panel</Link>; per-phone audio delays are measured
            with a <Link href="/calibrate">timing calibration</Link>.
          </p>
        </section>

        <section className={s.devBlock}>
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

        <section className={s.devBlock}>
          <h2>Rooms</h2>
          <p className={s.muted}>
            Use these IDs as <code>roomId</code> at check-in. Coordinates are meters on the demo floor plan, which runs
            x −3 to 30, y −4 to 8.
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
      </details>
    </main>
  );
}
