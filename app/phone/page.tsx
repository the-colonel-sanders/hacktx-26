"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROOMS, inBounds } from "@/lib/floorplan";
import { CAL_MAX_ACCURACY_M, MAX_GPS_ACCURACY_M, PIN_ACCURACY_M } from "@/lib/geo";
import { browserDb } from "@/lib/supabaseBrowser";
import {
  calibrate,
  checkIn,
  getTimingCal,
  now,
  reportTimingCal,
  sendDetection,
  sendStatus,
  type ActiveTimingCal,
  type Estimate,
  type PhoneLocation,
  type Sync,
} from "./api";
import { keepAwake, startListening, type AwakeStatus, type Level, type Spike, type TimingMethod } from "./audio";
import { MIN_CONFIDENCE, classify } from "./detector";
import type { GeoSpot } from "./GeoPicker";
import { useGpsFix } from "./gps";
import PositionPicker from "./PositionPicker";
import s from "./phone.module.css";

// Leaflet needs `window`.
const GeoPicker = dynamic(() => import("./GeoPicker"), { ssr: false, loading: () => <p className={s.hint}>Loading map…</p> });

// Phone clocks drift (tens of ppm ≈ a few ms per minute), and arrival times are compared
// to a few ms, so re-sync often.
const RESYNC_MS = 60_000;
const TIMING_CAL_POLL_MS = 2_000;
const POLL_MS = 10_000; // fallback in case Realtime drops
const LOCATION_KEY = "gunshot.location";
const TEST_WINDOW_MS = 10_000; // simulated shots in the same window (server clock) are one shot
const LOCKDOWN_KEY = "gunshot.lockdownScreen";
const TIMING_METHOD_KEY = "gunshot.timingMethod";
const TIMING_METHODS: [TimingMethod, string, string][] = [
  [
    "output",
    "Output timestamp",
    "No jitter, but can be off by a constant amount (the browser's latency estimate) until timing calibration removes it. Best with calibration.",
  ],
  [
    "current",
    "Current time",
    "No latency estimate involved, but each reading can be off by up to ~10 ms, and calibration can't remove that.",
  ],
];

type Status = "safe" | "need_help" | "injured";
type ActiveIncident = { id: string; best_room_id: string | null; best_label: string | null } | null;
type CheckedIn = { location: PhoneLocation; roomId: string | null };
type LogEntry = { t: number; text: string; tone?: "sent" | "muted" | "error" };

const roomName = (id: string | null | undefined) => ROOMS.find((r) => r.id === id)?.name ?? id ?? "unknown";
const describe = ({ location, roomId }: CheckedIn) =>
  "lat" in location
    ? `${location.label || "Map spot"} · ±${Math.round(location.accuracyM)} m`
    : "x" in location
      ? `(${location.x}, ${location.y}) m · near ${roomName(roomId)}`
      : roomName(roomId);
// For the lockdown screen: "you are …"
const whereYouAre = ({ location, roomId }: CheckedIn) =>
  "lat" in location ? (location.label ? `at ${location.label}` : null) : `${"x" in location ? "near" : "in"} ${roomName(roomId)}`;
const incidentPlace = (i: NonNullable<ActiveIncident>) => i.best_label ?? roomName(i.best_room_id);
const estimateName = (e: Estimate) =>
  e.label ?? (e.lat != null && e.lng != null ? `${e.lat.toFixed(5)}, ${e.lng.toFixed(5)}` : roomName(e.roomId));

/** Why this phone can't take part in a timing calibration (same map, precise spot), or null if it can. */
function calibrationProblem({ location }: CheckedIn, cal: NonNullable<ActiveTimingCal>): string | null {
  const onMap = "lat" in location;
  if (onMap !== (cal.frame === "geo")) {
    return `This phone is checked in on ${onMap ? "the real map" : "the floor plan"}, but the calibration is on ${onMap ? "the floor plan" : "the real map"}, so it can't take part.`;
  }
  if ("lat" in location) {
    return location.accuracyM <= CAL_MAX_ACCURACY_M ? null : "This phone's spot came from GPS, so it can't take part. Place the pin by hand.";
  }
  return "x" in location ? null : "This phone is checked in by room, so it can't take part. Use an exact spot.";
}

export default function PhonePage() {
  const [mode, setMode] = useState<"room" | "spot" | "map">("room");
  const [roomId, setRoomId] = useState("");
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [geoSpot, setGeoSpot] = useState<GeoSpot | null>(null);
  const [pinned, setPinned] = useState(false); // placed by hand rather than by GPS
  const [placeLabel, setPlaceLabel] = useState("");
  const [checkedIn, setCheckedIn] = useState<CheckedIn | null>(null);
  const [phase, setPhase] = useState<"setup" | "starting" | "listening">("setup");
  const [error, setError] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [sync, setSync] = useState<Sync | null>(null);
  const [level, setLevel] = useState<Level | null>(null);
  const [awake, setAwake] = useState<AwakeStatus | null>(null);
  const [calibrating, setCalibrating] = useState(false);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [incident, setIncident] = useState<ActiveIncident>(null);
  const [myStatus, setMyStatus] = useState<Status | null>(null);
  // Off while testing: alerts show as a banner instead of taking over the screen.
  const [lockdownScreen, setLockdownScreen] = useState(false);
  const [testDb, setTestDb] = useState(-15);
  const [testDelayMs, setTestDelayMs] = useState(0);
  const [windowLeft, setWindowLeft] = useState(0);

  const deviceRef = useRef<string | null>(null);
  const calibratingRef = useRef(false);
  // While a timing calibration runs, sounds go to it instead of being reported as shots.
  const [timingCal, setTimingCal] = useState<ActiveTimingCal>(null);
  const timingCalRef = useRef<ActiveTimingCal>(null);
  // How spike times are converted to the wall clock; read at each spike, so it can change while listening.
  const [timingMethod, setTimingMethod] = useState<TimingMethod>("output");
  const timingMethodRef = useRef<TimingMethod>("output");
  const cleanups = useRef<(() => void)[]>([]);

  const addLog = (text: string, tone?: LogEntry["tone"]) =>
    setLog((l) => [{ t: Date.now(), text, tone }, ...l].slice(0, 8));

  // Location from the URL (?room=203 from a QR code, or ?x=7.5&y=2), else the last one used.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    let saved: { roomId?: string; x?: number; y?: number; lat?: number; lng?: number; accuracyM?: number; label?: string } = {};
    try {
      saved = JSON.parse(localStorage.getItem(LOCATION_KEY) ?? "{}");
    } catch {}
    const ux = q.get("x");
    const uy = q.get("y");
    const urlSpot = ux != null && uy != null ? { x: Number(ux), y: Number(uy) } : null;
    const room = q.get("room") ?? (urlSpot ? undefined : saved.roomId);
    const pt = urlSpot ?? (!room && saved.x != null && saved.y != null ? { x: saved.x, y: saved.y } : null);
    if (room && ROOMS.some((r) => r.id === room)) {
      setMode("room");
      setRoomId(room);
    } else if (pt && inBounds(pt.x, pt.y)) {
      setMode("spot");
      setSpot(pt);
    } else if (!room && !urlSpot && saved.lat != null && saved.lng != null && saved.accuracyM != null) {
      setMode("map");
      setGeoSpot({ lat: saved.lat, lng: saved.lng, accuracyM: saved.accuracyM });
      setPinned(saved.accuracyM <= PIN_ACCURACY_M);
      setPlaceLabel(saved.label ?? "");
    }
    try {
      setLockdownScreen(localStorage.getItem(LOCKDOWN_KEY) === "on");
      if (localStorage.getItem(TIMING_METHOD_KEY) === "current") {
        timingMethodRef.current = "current";
        setTimingMethod("current");
      }
    } catch {}
  }, []);

  const toggleLockdownScreen = (on: boolean) => {
    setLockdownScreen(on);
    try {
      localStorage.setItem(LOCKDOWN_KEY, on ? "on" : "off");
    } catch {}
  };

  const chooseTimingMethod = (m: TimingMethod) => {
    if (m === timingMethodRef.current) return;
    timingMethodRef.current = m;
    setTimingMethod(m);
    try {
      localStorage.setItem(TIMING_METHOD_KEY, m);
    } catch {}
    addLog(`Timing method: ${TIMING_METHODS.find(([v]) => v === m)![1]}. Run timing calibration again.`);
  };

  // Watch for alerts from page load, even before the mic is started.
  const refreshIncident = useCallback(async () => {
    try {
      const res = await fetch("/api/incidents/current", { cache: "no-store" });
      const data = await res.json();
      setIncident(res.ok && data ? { id: data.id, best_room_id: data.best_room_id, best_label: data.best_label } : null);
    } catch {}
  }, []);

  useEffect(() => {
    refreshIncident();
    const poll = setInterval(refreshIncident, POLL_MS);
    const channel = browserDb()
      .channel("phone-alerts")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts" }, refreshIncident)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents" }, (p) => {
        const row = p.new as { id: string; status: string; best_room_id: string | null; best_label: string | null };
        if (row?.status === "active") setIncident({ id: row.id, best_room_id: row.best_room_id, best_label: row.best_label });
        else refreshIncident();
      })
      .subscribe();
    return () => {
      clearInterval(poll);
      browserDb().removeChannel(channel);
    };
  }, [refreshIncident]);

  // New incident: buzz (no sound — it could give away where people are hiding) and reset status.
  const incidentId = incident?.id;
  useEffect(() => {
    if (!incidentId) return;
    setMyStatus(null);
    if (lockdownScreen) navigator.vibrate?.([400, 200, 400, 200, 400]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only buzz when a new incident starts
  }, [incidentId]);

  useEffect(() => () => cleanups.current.forEach((f) => f()), []);

  // Watch for a timing calibration while listening.
  useEffect(() => {
    if (phase !== "listening") return;
    const check = async () => {
      try {
        const cal = await getTimingCal();
        timingCalRef.current = cal;
        setTimingCal(cal);
      } catch {}
    };
    check();
    const t = setInterval(check, TIMING_CAL_POLL_MS);
    return () => clearInterval(t);
  }, [phase]);

  // Countdown to the next simulated-shot window, so testers can tap together.
  useEffect(() => {
    if (!sync) return;
    const tick = () => setWindowLeft(TEST_WINDOW_MS - ((now() + sync.offsetMs) % TEST_WINDOW_MS));
    tick();
    const t = setInterval(tick, 250);
    return () => clearInterval(t);
  }, [sync]);

  const onSpike = useCallback(async (spike: Spike) => {
    const deviceId = deviceRef.current;
    if (!deviceId) return;
    try {
      if (timingCalRef.current) {
        const { kept } = await reportTimingCal(deviceId, spike.localSpikeTsMs, spike.peakDb);
        addLog(`Timing calibration: heard reference at ${spike.peakDb.toFixed(0)} dB (kept ${kept})`, "sent");
        return;
      }
      if (calibratingRef.current) {
        calibratingRef.current = false;
        setCalibrating(false);
        const { gainOffsetDb } = await calibrate(deviceId, spike.peakDb);
        addLog(`Calibrated: clap at ${spike.peakDb.toFixed(1)} dB → gain offset ${gainOffsetDb.toFixed(1)} dB`, "sent");
        return;
      }
      const { confidence, label } = await classify(spike.samples, spike.sampleRate);
      if (confidence < MIN_CONFIDENCE) {
        addLog(`Sound at ${spike.peakDb.toFixed(0)} dB ignored (confidence ${confidence})`, "muted");
        return;
      }
      const { estimate } = await sendDetection({
        deviceId,
        localSpikeTsMs: spike.localSpikeTsMs,
        peakDb: spike.peakDb,
        confidence,
        label,
      });
      addLog(
        `Reported ${spike.peakDb.toFixed(0)} dB (confidence ${confidence}) → estimate ${estimateName(estimate)}, ${estimate.deviceCount} phone(s)`,
        "sent",
      );
    } catch (e) {
      addLog(`Failed to send: ${(e as Error).message}`, "error");
    }
  }, []);

  // On the real map, take the GPS fix until a pin is placed by hand; fixes rougher than MAX_GPS_ACCURACY_M need a pin.
  const gps = useGpsFix(mode === "map" && !pinned && phase === "setup");
  useEffect(() => {
    if (gps.fix && !pinned) setGeoSpot(gps.fix);
  }, [gps.fix, pinned]);

  const label = placeLabel.trim();
  const location: PhoneLocation | null =
    mode === "room"
      ? roomId
        ? { roomId }
        : null
      : mode === "spot"
        ? spot && inBounds(spot.x, spot.y)
          ? spot
          : null
        : geoSpot && geoSpot.accuracyM <= MAX_GPS_ACCURACY_M
          ? { lat: geoSpot.lat, lng: geoSpot.lng, accuracyM: geoSpot.accuracyM, ...(label ? { label } : {}) }
          : null;

  const start = async () => {
    if (!location) return;
    setPhase("starting");
    setError(null);
    try {
      try {
        localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
      } catch {}
      // Mic first: it needs the tap's user activation, which awaiting the network could use up.
      const listener = await startListening(onSpike, setLevel, () => timingMethodRef.current);
      cleanups.current.push(listener.stop);
      cleanups.current.push(await keepAwake(setAwake));

      const res = await checkIn(location);
      const me: CheckedIn = { location, roomId: res.roomId };
      deviceRef.current = res.deviceId;
      setDeviceId(res.deviceId);
      setSync(res.sync);
      setCheckedIn(me);

      const resync = setInterval(async () => {
        try {
          setSync((await checkIn(location)).sync);
        } catch {}
      }, RESYNC_MS);
      cleanups.current.push(() => clearInterval(resync));

      setPhase("listening");
      addLog(`Checked in: ${describe(me)}`);
    } catch (e) {
      cleanups.current.forEach((f) => f());
      cleanups.current = [];
      const err = e as Error;
      setError(
        err.name === "NotAllowedError"
          ? "Microphone permission was denied. Allow it in your browser settings and try again."
          : !window.isSecureContext
            ? "The microphone needs HTTPS. Open this page over https:// (see the setup notes)."
            : err.message,
      );
      setPhase("setup");
    }
  };

  // Testing: report a shot as if this phone just heard one, bypassing the mic and classifier.
  // The shot "fires" at the start of the current shared window (server clock), and this phone
  // hears it testDelayMs later — so phones tapping in the same window report the same shot.
  const simulateShot = async () => {
    if (!deviceId || !sync) return;
    try {
      const fireServerMs = Math.floor((now() + sync.offsetMs) / TEST_WINDOW_MS) * TEST_WINDOW_MS;
      const { estimate } = await sendDetection({
        deviceId,
        localSpikeTsMs: fireServerMs - sync.offsetMs + testDelayMs,
        peakDb: testDb,
        confidence: 1,
        label: "test shot",
      });
      addLog(
        `Simulated: ${testDb} dB, heard +${testDelayMs} ms → estimate ${estimateName(estimate)}, ${estimate.deviceCount} phone(s)`,
        "sent",
      );
    } catch (e) {
      addLog(`Failed to send: ${(e as Error).message}`, "error");
    }
  };

  const reportStatus = async (status: Status) => {
    if (!deviceId) return;
    setMyStatus(status);
    try {
      await sendStatus(deviceId, status);
    } catch (e) {
      setMyStatus(null);
      addLog(`Failed to send status: ${(e as Error).message}`, "error");
    }
  };

  if (incident && lockdownScreen) {
    return (
      <main className={s.alert}>
        <div className={s.alertInner}>
          <p className={s.alertKicker}>⚠ Building alert</p>
          <h1 className={s.alertTitle}>Lockdown</h1>
          <p className={s.alertWhere}>
            Shots reported near <b>{incidentPlace(incident)}</b>
            {checkedIn && whereYouAre(checkedIn) && <> · you are {whereYouAre(checkedIn)}</>}
          </p>
          <ul className={s.alertSteps}>
            <li>Lock or barricade the door. Turn off the lights.</li>
            <li>Stay out of sight and away from the door.</li>
            <li>Silence your phone. Don&apos;t open the door until all clear.</li>
          </ul>

          {deviceId ? (
            <div className={s.statusBlock}>
              <p>Tell responders your status:</p>
              <div className={s.statusButtons}>
                {(
                  [
                    ["safe", "I'm safe"],
                    ["need_help", "Need help"],
                    ["injured", "Injured"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={`${s.statusBtn} ${myStatus === value ? s.statusOn : ""}`}
                    onClick={() => reportStatus(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {myStatus && <p className={s.sent}>✓ Sent to responders</p>}
            </div>
          ) : (
            <p className={s.alertNote}>This phone isn&apos;t checked in, so it can&apos;t report status.</p>
          )}
          {phase === "listening" && <p className={s.alertNote}>● Still listening and reporting</p>}
        </div>
      </main>
    );
  }

  return (
    <main className={s.page}>
      <h1 className={s.title}>Classroom listener</h1>

      {incident && (
        <p className={s.banner}>
          <b>Alert active</b> · shots near {incidentPlace(incident)}. Lockdown screen is off for testing.
        </p>
      )}

      {phase !== "listening" ? (
        <section className={s.card}>
          <span className={s.label}>Where is this phone?</span>
          <div className={s.segmented} role="tablist">
            <button role="tab" aria-selected={mode === "room"} className={mode === "room" ? s.segOn : ""} onClick={() => setMode("room")}>
              Room
            </button>
            <button role="tab" aria-selected={mode === "spot"} className={mode === "spot" ? s.segOn : ""} onClick={() => setMode("spot")}>
              Exact spot
            </button>
            <button role="tab" aria-selected={mode === "map"} className={mode === "map" ? s.segOn : ""} onClick={() => setMode("map")}>
              Real map
            </button>
          </div>

          {mode === "room" ? (
            <select aria-label="Room" className={s.select} value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">Choose a room…</option>
              {ROOMS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          ) : mode === "spot" ? (
            <>
              <PositionPicker value={spot} onChange={setSpot} />
              <div className={s.xy}>
                <label>
                  x (m)
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    value={spot?.x ?? ""}
                    onChange={(e) => setSpot({ x: Number(e.target.value), y: spot?.y ?? 0 })}
                  />
                </label>
                <label>
                  y (m)
                  <input
                    type="number"
                    inputMode="decimal"
                    step={0.5}
                    value={spot?.y ?? ""}
                    onChange={(e) => setSpot({ x: spot?.x ?? 0, y: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className={s.hint}>Tap the map or type coordinates. Squares are room centers. The floor runs x −3 to 30 m, y −4 to 8 m.</p>
              {spot && !inBounds(spot.x, spot.y) && <p className={s.error}>That spot is outside the floor plan.</p>}
            </>
          ) : (
            <>
              <GeoPicker
                value={geoSpot}
                onChange={(p) => {
                  setGeoSpot({ ...p, accuracyM: PIN_ACCURACY_M });
                  setPinned(true);
                }}
                follow={!pinned}
              />
              <p className={s.hint}>
                {pinned ? (
                  <>
                    Placed by hand (±{PIN_ACCURACY_M} m). Drag the pin to adjust, or{" "}
                    <button className={s.linkBtn} onClick={() => setPinned(false)}>
                      use GPS again
                    </button>
                    .
                  </>
                ) : !geoSpot ? (
                  "Finding your location… or tap the map where this phone is."
                ) : geoSpot.accuracyM > 10 ? (
                  `GPS says ±${Math.round(geoSpot.accuracyM)} m, which is rough. Drag the pin to exactly where this phone is: every meter of error moves the shot estimate too.`
                ) : (
                  `GPS says ±${Math.round(geoSpot.accuracyM)} m. Drag the pin if it's off.`
                )}
              </p>
              {gps.error && !pinned && <p className={s.error}>{gps.error}</p>}
              {geoSpot && geoSpot.accuracyM > MAX_GPS_ACCURACY_M && (
                <p className={s.error}>That fix is too rough to use. Tap the map where this phone is.</p>
              )}
              <label className={s.field}>
                Label (optional)
                <input
                  value={placeLabel}
                  maxLength={60}
                  placeholder="e.g. Room 214, 2nd floor"
                  onChange={(e) => setPlaceLabel(e.target.value)}
                />
              </label>
            </>
          )}

          <button className={s.primary} onClick={start} disabled={!location || phase === "starting"}>
            {phase === "starting" ? "Starting…" : "Start listening"}
          </button>
          <p className={s.hint}>
            Leave this page open with the screen on. Only event times and loudness are sent, never audio.
          </p>
          {error && <p className={s.error}>{error}</p>}
        </section>
      ) : (
        <>
          <section className={s.card}>
            <div className={s.row}>
              <span className={s.live}>● Listening</span>
              <span>{checkedIn && describe(checkedIn)}</span>
            </div>
            <Meter level={level} />
            <dl className={s.facts}>
              <dt>Clock offset</dt>
              <dd>{sync ? `${sync.offsetMs.toFixed(0)} ms (±${(sync.rttMs / 2).toFixed(0)} ms)` : "—"}</dd>
              <dt>Device</dt>
              <dd className={s.mono}>{deviceId?.slice(0, 8)}</dd>
              <dt>Screen</dt>
              <dd className={awake === "off" ? s.warnText : undefined}>
                {awake === "on" ? "✓ Kept on" : awake === "fallback" ? "✓ Kept on (older-browser mode)" : "⚠ May turn off"}
              </dd>
            </dl>
            {awake === "off" && (
              <p className={s.warnBox}>
                This browser won&apos;t keep the screen on (battery saver can block it). If the screen turns off, the mic
                stops listening. Tap anywhere to retry, turn off battery saver, or set Auto-Lock / Screen timeout to
                Never in Settings while testing.
              </p>
            )}
          </section>

          <section className={s.card}>
            <label className={s.toggle}>
              <input type="checkbox" checked={lockdownScreen} onChange={(e) => toggleLockdownScreen(e.target.checked)} />
              <span>
                <b>Lockdown screen</b>
                <br />
                <span className={s.hint}>Take over the screen and vibrate when an alert is raised. Leave off while testing.</span>
              </span>
            </label>
          </section>

          {timingCal && (
            <p className={s.calBanner}>
              <b>Timing calibration running.</b> Make one sharp sound at{" "}
              {timingCal.frame === "geo"
                ? `the spot marked on the calibration map (${timingCal.lat!.toFixed(5)}, ${timingCal.lng!.toFixed(5)})`
                : `(${timingCal.x}, ${timingCal.y}) m`}
              . Sounds this phone hears now are used for calibration, not reported as shots.
              {checkedIn && calibrationProblem(checkedIn, timingCal) && ` ${calibrationProblem(checkedIn, timingCal)}`}
            </p>
          )}

          <section className={s.card}>
            <h2 className={s.h2}>Simulate a shot (testing)</h2>
            <p className={s.hint}>
              Reports a gunshot as if this phone heard it. Phones that tap during the same 10-second window report the
              same shot; the delay is how long after the shot this phone heard it.
            </p>
            <div className={s.xy}>
              <label>
                Loudness (dB)
                <input type="number" inputMode="decimal" step={0.5} max={0} value={testDb} onChange={(e) => setTestDb(Number(e.target.value))} />
              </label>
              <label>
                Heard after (ms)
                <input
                  type="number"
                  inputMode="decimal"
                  step={1}
                  min={0}
                  max={250}
                  value={testDelayMs}
                  onChange={(e) => setTestDelayMs(Math.min(250, Math.max(0, Number(e.target.value))))}
                />
              </label>
            </div>
            <p className={s.hint}>
              Closer to 0 dB = louder (e.g. −5 right next to it, −30 far away). Sound travels about 1 m per 3 ms.
              Window ends in {Math.ceil(windowLeft / 1000)} s.
            </p>
            <button className={s.danger} onClick={simulateShot} disabled={!sync}>
              Simulate shot
            </button>
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Timing method</h2>
            <div className={s.segmented} role="tablist" aria-label="Timing method">
              {TIMING_METHODS.map(([value, name]) => (
                <button
                  key={value}
                  role="tab"
                  aria-selected={timingMethod === value}
                  className={timingMethod === value ? s.segOn : ""}
                  onClick={() => chooseTimingMethod(value)}
                >
                  {name}
                </button>
              ))}
            </div>
            <p className={s.hint}>
              {TIMING_METHODS.find(([v]) => v === timingMethod)![2]} Switching changes this phone&apos;s timing, so run
              timing calibration again afterwards.
            </p>
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Calibrate microphone</h2>
            <p className={s.hint}>Hold the phone about 1 m away and clap once, sharply. Do this once per phone.</p>
            <button
              className={s.secondary}
              onClick={() => {
                calibratingRef.current = !calibrating;
                setCalibrating(!calibrating);
              }}
            >
              {calibrating ? "Waiting for clap… (tap to cancel)" : "Calibrate"}
            </button>
          </section>

          <section className={s.card}>
            <h2 className={s.h2}>Activity</h2>
            {log.length === 0 ? (
              <p className={s.hint}>Nothing yet. A sharp clap will show up here (the placeholder detector accepts claps).</p>
            ) : (
              <ul className={s.log}>
                {log.map((l) => (
                  <li key={l.t + l.text} className={l.tone ? s[l.tone] : undefined}>
                    <span className={s.time}>{new Date(l.t).toLocaleTimeString()}</span> {l.text}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function Meter({ level }: { level: Level | null }) {
  const pct = (db: number) => `${Math.min(100, Math.max(0, ((db + 80) / 80) * 100))}%`;
  return (
    <div className={s.meterWrap}>
      <div className={s.meter} role="meter" aria-label="Microphone level" aria-valuemin={-80} aria-valuemax={0} aria-valuenow={level ? Math.round(level.peakDb) : -80}>
        <div className={s.meterFill} style={{ width: level ? pct(level.peakDb) : "0%" }} />
        {level && <div className={s.meterNoise} style={{ left: pct(level.noiseDb) }} />}
      </div>
      <div className={s.meterText}>
        {level ? `${level.peakDb.toFixed(0)} dB peak · noise floor ${level.noiseDb.toFixed(0)} dB` : "Starting mic…"}
      </div>
    </div>
  );
}
