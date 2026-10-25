"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import s from "./spaces.module.css";

type Space = { id: string; code: string; name: string | null; shared: boolean };

// Start, join or leave a demo space. Each space is a separate sandbox: its own phones, incident,
// alerts, status reports, calibration and phone settings, so several judges can try it at once.
// Opening this page outside a space ("Try demo") starts a fresh space right away.
export default function SpacesPage() {
  const [space, setSpace] = useState<Space | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
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

  const create = useCallback(
    async (spaceName?: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch("/api/spaces", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: spaceName?.trim() || undefined }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        setName("");
        await load();
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

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

  const phoneLink = space && origin ? `${origin}/join/${space.code}?to=phone` : null;
  useEffect(() => {
    if (!phoneLink || space?.shared) return setQr(null);
    QRCode.toDataURL(phoneLink, { margin: 1, width: 320 }).then(setQr);
  }, [phoneLink, space?.shared]);

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
    } catch { }
  };

  const isLocal = /localhost|127\.0\.0\.1/.test(origin);

  return (
    <main className={s.page}>
      <h1 className={s.title}>Demo spaces</h1>
      <p className={s.lead}>
        A demo space is a private sandbox with its own phones, incident, alerts and status reports. Share its code or QR code with the phones
        that should join.
      </p>

      {error && <p className={s.error}>{error}</p>}

      {space?.shared && busy ? (
        <section className={s.card}>
          <h2 className={s.h2}>Setting up your demo space…</h2>
        </section>
      ) : space && (
        <section className={s.card}>
          <span className={s.kicker}>You&apos;re in</span>
          {space.shared ? (
            <>
              <h2 className={s.h2}>The shared demo space</h2>
              <p className={s.hint}>
                Everyone without a space code lands here, so others&apos; tests show up too. Start your own space below for
                a clean demo.
              </p>
            </>
          ) : (
            <>
              <h2 className={s.h2}>
                {space.name ?? "Demo space"} <span className={s.code}>{space.code}</span>
              </h2>
              <div className={s.invite}>
                {qr && <img src={qr} alt={`QR code to join space ${space.code}`} className={s.qr} />}
                <div className={s.inviteText}>
                  <b>Add phones:</b> scan this code, or open <code>/join/{space.code}</code> on the phone. They join this
                  space and open the listener.
                  {phoneLink && (
                    <button className={s.secondary} onClick={copy}>
                      {copied ? "✓ Copied" : "Copy phone link"}
                    </button>
                  )}
                  {isLocal && (
                    <span className={s.warn}>
                      This link points to {origin}, which phones can&apos;t reach. Open this page from your deployed or
                      ngrok address to share it.
                    </span>
                  )}
                </div>
              </div>
            </>
          )}
          <div className={s.row}>
            <a className={s.primary} href="/incident">
              Open dashboard
            </a>
            <a className={s.secondary} href="/admin">
              Admin
            </a>
            <a className={s.secondary} href="/phone">
              Listen on this device
            </a>
            {!space.shared && (
              <button className={s.secondary} onClick={leave}>
                Leave space
              </button>
            )}
          </div>
        </section>
      )}

      <section className={s.card}>
        <h2 className={s.h2}>{space && !space.shared ? "Start another space" : "Start a new space"}</h2>
        <div className={s.row}>
          <input
            className={s.input}
            placeholder="Name (optional)"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button className={s.primary} onClick={() => create(name)} disabled={busy}>
            {busy ? "Creating…" : "Create space"}
          </button>
        </div>
      </section>

      <section className={s.card}>
        <h2 className={s.h2}>Join a space</h2>
        <div className={s.row}>
          <input
            className={`${s.input} ${s.codeInput}`}
            placeholder="CODE"
            value={joinCode}
            maxLength={8}
            autoCapitalize="characters"
            onChange={(e) => setJoinCode(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && join()}
          />
          <button className={s.secondary} onClick={join} disabled={!joinCode.trim()}>
            Join
          </button>
        </div>
      </section>
    </main>
  );
}
