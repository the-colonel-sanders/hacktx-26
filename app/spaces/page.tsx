"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import s from "./spaces.module.css";

type Space = { id: string; code: string; name: string | null; shared: boolean };

// The phone page pre-fills its room from ?room=.
const PHONES = [
  { id: "202", name: "Room 202" },
  { id: "204", name: "Room 204" },
  { id: "hall-c", name: "Hallway Center" },
];

// The live demo: starts the visitor's own demo space (a separate sandbox with its own phones, incident,
// alerts, status reports, calibration and phone settings, so several judges can try it at once) and walks
// them through it. Every link opens a new tab, so these instructions stay open.
export default function SpacesPage() {
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState(false);
  const autoStarted = useRef(false); // React runs mount effects twice in dev; create only one space

  const load = useCallback(async (): Promise<Space | null> => {
    const res = await fetch("/api/spaces/current", { cache: "no-store" });
    const data = await res.json();
    window.dispatchEvent(new Event("space-changed")); // the nav badge re-reads it
    if (res.ok) {
      setSpace(data);
      return data;
    }
    setSpace(null);
    setError(data.error);
    return null;
  }, []);

  const create = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/spaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [load]);

  useEffect(() => {
    setOrigin(window.location.origin);
    const missing = new URLSearchParams(window.location.search).get("missing");
    if (missing) setError(`No demo space with code ${missing.toUpperCase()}. Check the code, or start a new space.`);
    load().then((current) => {
      // Not in a private space yet: start one. (Not after a bad join code: show that error instead.)
      if (current?.shared && !missing && !autoStarted.current) {
        autoStarted.current = true;
        create();
      }
    });
  }, [load, create]);

  const mySpace = space && !space.shared ? space : null;
  const phoneLink = mySpace && origin ? `${origin}/join/${mySpace.code}?to=phone` : null;
  useEffect(() => {
    if (!phoneLink) return setQr(null);
    QRCode.toDataURL(phoneLink, { margin: 1, width: 320 }).then(setQr);
  }, [phoneLink]);

  const leave = async () => {
    await fetch("/api/spaces/leave", { method: "POST" });
    await load();
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code) window.location.href = `/join/${encodeURIComponent(code)}?to=spaces`;
  };

  const copy = async () => {
    if (!phoneLink) return;
    try {
      await navigator.clipboard.writeText(phoneLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };

  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <main className={s.page}>
      <h1 className={s.title}>Live demo</h1>
      <p className={s.lead}>
        About 2 minutes. Each browser tab can act as a separate phone, so you&apos;ll put three &quot;phones&quot; in
        three rooms and fire a pretend shot that they all hear equally loud, at the same moment. The only place that fits
        is the spot equally far from all three, so the system should find the middle. <b>Keep this page open:</b> each
        link below opens a new tab, so come back here for the next step.
      </p>

      {error && <p className={s.error}>{error}</p>}

      <section className={s.card}>
        <ol className={s.guide}>
          <li className={mySpace ? s.done : undefined}>
            <span className={s.guideTitle}>Your demo space</span>
            <span className={s.guideText}>
              Your own private copy of the system, so nobody else&apos;s tests mix with yours.
            </span>
            {mySpace ? (
              <span className={s.guideOk}>
                ✓ Ready: demo space <span className={s.code}>{mySpace.code}</span>
              </span>
            ) : busy || !space ? (
              <span className={s.hint}>Setting up your demo space…</span>
            ) : (
              <div className={s.row}>
                <button className={s.primary} onClick={create}>
                  Start my demo space
                </button>
              </div>
            )}
          </li>

          <li>
            <span className={s.guideTitle}>Open three phones</span>
            <span className={s.guideText}>
              Open each one. Its room is already chosen: press <b>Start listening</b> and allow the microphone, then come
              back here.
            </span>
            <div className={s.row}>
              {PHONES.map((room, i) => (
                <a key={room.id} className={s.secondary} href={`/phone?room=${room.id}`} target="_blank" rel="noreferrer">
                  Phone {i + 1}: {room.name} ↗
                </a>
              ))}
            </div>
          </li>

          <li>
            <span className={s.guideTitle}>Open the dashboard</span>
            <span className={s.guideText}>This is what a school office or responder would watch.</span>
            <div className={s.row}>
              <a className={s.secondary} href="/incident" target="_blank" rel="noreferrer">
                Dashboard ↗
              </a>
            </div>
          </li>

          <li>
            <span className={s.guideTitle}>Fire the pretend shot</span>
            <span className={s.guideText}>
              In each of the three phone tabs, press <b>Simulate shot</b>. Do all three within the same 10 seconds: each
              tab counts down (<i>Window ends in N s</i>), so start right after it resets. If you&apos;re up for it,
              skip the buttons and try one sharp, loud <b>clap</b> in front of your computer instead.
            </span>
          </li>

          <li>
            <span className={s.guideTitle}>Watch the dashboard</span>
            <span className={s.guideText}>
              Within a second or two the incident turns <b>Active</b>, every phone gets the alert, and the red marker lands
              in <b>Room 203</b>, in the middle of the three phones. The blue shading shows how sure the system is. Press{" "}
              <b>All clear</b> on the dashboard to reset and try again.
            </span>
          </li>
        </ol>
        <p className={s.hint}>
          Want to move the shot? In the{" "}
          <a href="/admin" target="_blank" rel="noreferrer">
            admin panel
          </a>
          , make one phone louder (<i>Sim. loudness</i> −8 instead of −15) and fire again: the estimate moves toward it.
        </p>
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Then try it with your own phone</h2>
        <div className={s.invite}>
          {qr && mySpace && <img src={qr} alt={`QR code to join demo space ${mySpace.code}`} className={s.qr} />}
          <ol className={s.guide}>
            <li>
              <span className={s.guideTitle}>Scan the code with your phone&apos;s camera</span>
              <span className={s.guideText}>
                It joins your phone to this demo space{mySpace && (
                  <>
                    {" "}
                    (or open <code>/join/{mySpace.code}</code> on it)
                  </>
                )}
                .
              </span>
              {phoneLink && (
                <div className={s.row}>
                  <button className={s.secondary} onClick={copy}>
                    {copied ? "✓ Copied" : "Copy phone link"}
                  </button>
                </div>
              )}
            </li>
            <li>
              <span className={s.guideTitle}>Start listening</span>
              <span className={s.guideText}>
                Choose a room, press <b>Start listening</b> and allow the microphone. Keep the screen on: phones stop
                listening when the screen sleeps.
              </span>
            </li>
            <li>
              <span className={s.guideTitle}>Clap</span>
              <span className={s.guideText}>
                Clap once, sharply, about 1 m from the phone, and watch the dashboard. Claps work because the detector in
                this prototype accepts any sharp bang.
              </span>
            </li>
          </ol>
        </div>
        {isLocal ? (
          <p className={s.warn}>
            This page is open at {origin}, which phones can&apos;t reach, so the code won&apos;t work on a phone. Open
            it from the deployed or ngrok address instead (see <b>DEMO.md</b> in the repository).
          </p>
        ) : (
          <p className={s.hint}>Phones only allow the microphone on secure (https://) sites.</p>
        )}
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Other options</h2>
        <div className={s.row}>
          <input
            className={`${s.input} ${s.codeInput}`}
            placeholder="CODE"
            aria-label="Demo space code"
            value={joinCode}
            maxLength={8}
            autoCapitalize="characters"
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className={s.secondary} onClick={join} disabled={!joinCode.trim()}>
            Join someone else&apos;s space
          </button>
        </div>
        {mySpace && (
          <div className={s.row}>
            <button className={s.secondary} onClick={leave}>
              Leave this space
            </button>
            <span className={s.hint}>Goes back to the shared space everyone else sees.</span>
          </div>
        )}
      </section>
    </main>
  );
}
