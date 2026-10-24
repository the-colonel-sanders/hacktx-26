import Link from "next/link";
import { ROOMS } from "@/lib/floorplan";
import s from "./home.module.css";

const ROUTES: [string, string, string][] = [
  ["GET", "/api/time", "Server clock. Phones call it ~5× at check-in to compute their clock offset."],
  ["POST", "/api/checkin", "{ deviceId?, roomId OR x/y in meters, clockOffsetMs } → { deviceId, roomId }. With x/y, the room is the nearest one."],
  ["POST", "/api/calibrate", "{ deviceId, peakDb } from a reference clap → stores the mic gain offset"],
  ["POST", "/api/detection", "{ deviceId, localSpikeTsMs, peakDb, confidence, label } → { incidentId, estimate }"],
  ["POST", "/api/status", "{ deviceId, status: safe | need_help | injured }"],
  ["POST", "/api/alert", "Raise a manual alert (creates an incident if none is active)"],
  ["POST", "/api/all-clear", "Clear the active incident"],
  ["GET", "/api/incidents/current", "Active incident with heatmap, trail and detections, or null"],
];

export default function Home() {
  return (
    <main className={s.page}>
      <section>
        <h1 className={s.title}>Gunshot Locator</h1>
        <p className={s.lead}>
          Phones in each room listen for gunshots on-device and report only event metadata (time, loudness,
          confidence) — never audio. The server groups reports into shots, estimates where the sound came from, and
          raises a building-wide alert.
        </p>
        <Link href="/incident" className={s.cta}>
          Open incident dashboard →
        </Link>
      </section>

      <section className={s.card}>
        <h2>Try it</h2>
        <ol className={s.steps}>
          <li>
            Open the <Link href="/incident">incident dashboard</Link> in one window.
          </li>
          <li>
            In a terminal, simulate a shot from (9, 2) m:
            <pre>npx tsx scripts/simulate.ts 9 2</pre>
          </li>
          <li>
            Or a shooter moving 6 m between 3 shots:
            <pre>npx tsx scripts/simulate.ts 2 -2 --shots 3 --move 6</pre>
          </li>
          <li>
            Watch the estimate and trail update, then press <b>All clear</b>. The simulator clears the previous
            incident on start; add <code>--keep</code> to append instead.
          </li>
        </ol>
      </section>

      <section className={s.card}>
        <h2>Reading the dashboard</h2>
        <dl className={s.defs}>
          <dt>Blue heatmap</dt>
          <dd>How likely each 0.5 m cell is to be the source. Stronger blue = more likely.</dd>
          <dt>Red ringed dot</dt>
          <dd>Best estimate for the latest shot. Its nearest room is shown as “Estimated location”.</dd>
          <dt>Numbered dashed line</dt>
          <dd>Earlier shots in order, so you can see a shooter moving.</dd>
          <dt>Solid / hollow phones</dt>
          <dd>Solid phones heard the latest shot (with normalized loudness); hollow ones didn&apos;t.</dd>
          <dt>Detections table</dt>
          <dd>Every report: arrival time relative to the first phone, loudness after calibration, and ML confidence.</dd>
        </dl>
      </section>

      <section className={s.card}>
        <h2>How localization works</h2>
        <p>
          Each phone stands in for its room center. For every cell on the floor plan the server scores two things:
          whether the loudness pattern fits sound fading with distance, and whether phones that heard it first are
          closer. The lowest-cost cell is the estimate. Phones sync clocks with <code>/api/time</code> and calibrate
          their mic with a reference clap so readings are comparable. Tunables live in <code>lib/localize.ts</code>.
        </p>
      </section>

      <section className={s.card}>
        <h2>API</h2>
        <div className={s.tableWrap}>
          <table className={s.table}>
            <tbody>
              {ROUTES.map(([method, path, desc]) => (
                <tr key={path}>
                  <td>
                    <span className={method === "GET" ? s.get : s.post}>{method}</span>
                  </td>
                  <td className={s.mono}>
                    {method === "GET" ? (
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
          Use these IDs as <code>roomId</code> at check-in. Coordinates are meters on the floor plan.
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
    </main>
  );
}
