"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";
import { ROOMS, inBounds } from "@/lib/floorplan";
import { CAL_MAX_ACCURACY_M, MAX_GPS_ACCURACY_M, PIN_ACCURACY_M } from "@/lib/geo";
import {
  DEFAULT_PHONE_SETTINGS,
  LOCATION_MODE_NAMES,
  TIMING_METHOD_NAMES,
  type LocationMode,
  type PhoneSettings,
} from "@/lib/phoneSettings";
import { browserDb } from "@/lib/supabaseBrowser";
import {
  calibrate,
  checkIn,
  getPhoneSettings,
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
import { startFollowing, type FollowInfo, type MapLocation } from "./follow";
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
const SETTINGS_POLL_MS = 2_000; // settings are changed from the admin panel

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
const modeOf = (l: PhoneLocation): LocationMode => ("lat" in l ? "map" : "x" in l ? "spot" : "room");

/** Admin-panel changes worth telling the person holding the phone about. */
function settingChanges(a: PhoneSettings, b: PhoneSettings): string[] {
  const out: string[] = [];
  if (a.locationMode !== b.locationMode) out.push(`location set to ${LOCATION_MODE_NAMES[b.locationMode]}. Pick where this phone is.`);
  if (a.timingMethod !== b.timingMethod) {
    out.push(`timing method set to ${TIMING_METHOD_NAMES[b.timingMethod]}. Run timing calibration again.`);
  }
  if (a.lockdownScreen !== b.lockdownScreen) out.push(`lockdown screen turned ${b.lockdownScreen ? "on" : "off"}.`);
  if (a.followLocation !== b.followLocation) out.push(`follow my location turned ${b.followLocation ? "on" : "off"}.`);
  return out;
}
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
  // Settings come from the admin panel (lib/phoneSettings.ts), including how this phone gives its location.
  const [settings, setSettings] = useState<PhoneSettings>(DEFAULT_PHONE_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const settingsRef = useRef<PhoneSettings | null>(null);
  const micCalSeenRef = useRef<string | null | undefined>(undefined);
  const mode = settings.locationMode;
  const [roomId, setRoomId] = useState("");
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(null);
  const [geoSpot, setGeoSpot] = useState<GeoSpot | null>(null);
  const [pinned, setPinned] = useState(false); // placed by hand rather than by GPS
  // On the real map, while listening: GPS status from following the phone (when the admin panel has it on).
  const [followInfo, setFollowInfo] = useState<FollowInfo>(null);
  // Where the phone is checked in right now; following can change it after start().
  const locationRef = useRef<PhoneLocation | null>(null);
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
  // Incident whose lockdown screen was closed by hand; a new incident shows it again.
  const [dismissedIncident, setDismissedIncident] = useState<string | null>(null);
  const [windowLeft, setWindowLeft] = useState(0);

  const deviceRef = useRef<string | null>(null);
  const calibratingRef = useRef(false);
  // While a timing calibration runs, sounds go to it instead of being reported as shots.
  const [timingCal, setTimingCal] = useState<ActiveTimingCal>(null);
  const timingCalRef = useRef<ActiveTimingCal>(null);
  // How spike times are converted to the wall clock; read at each spike, so it can change while listening.
  const timingMethodRef = useRef<TimingMethod>("output");
  const cleanups = useRef<(() => void)[]>([]);

  const addLog = (text: string, tone?: LogEntry["tone"]) =>
    setLog((l) => [{ t: Date.now(), text, tone }, ...l].slice(0, 8));

  // Pre-fill the location from the URL (?room=203 or ?x=7.5&y=2), else the last one used.
  // The admin panel decides which kind of location the phone gives; this only fills in the picker.
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
    if (room && ROOMS.some((r) => r.id === room)) setRoomId(room);
    if (pt && inBounds(pt.x, pt.y)) setSpot(pt);
    if (!room && !urlSpot && saved.lat != null && saved.lng != null && saved.accuracyM != null) {
      setGeoSpot({ lat: saved.lat, lng: saved.lng, accuracyM: saved.accuracyM });
      setPinned(saved.accuracyM <= PIN_ACCURACY_M);
      setPlaceLabel(saved.label ?? "");
    }
  }, []);

  // Follow the admin panel's settings for this phone. Changes apply within a couple of seconds.
  useEffect(() => {
    let stopped = false;
    const check = async () => {
      try {
        const remote = await getPhoneSettings(deviceRef.current);
        if (stopped) return;
        const prev = settingsRef.current;
        settingsRef.current = remote.settings;
        setSettings(remote.settings);
        timingMethodRef.current = remote.settings.timingMethod;
        if (phase !== "listening" || !deviceRef.current) return;
        if (prev) for (const change of settingChanges(prev, remote.settings)) addLog(`Admin: ${change}`);
        // A mic calibration requested from the admin panel: wait for the next clap. Requests made before
        // this phone started listening are ignored.
        if (micCalSeenRef.current === undefined) micCalSeenRef.current = remote.micCalRequestedAt;
        else if (remote.micCalRequestedAt && remote.micCalRequestedAt !== micCalSeenRef.current) {
          micCalSeenRef.current = remote.micCalRequestedAt;
          calibratingRef.current = true;
          setCalibrating(true);
          addLog("Admin: calibrate the mic. Clap once, sharply, about 1 m from this phone.");
        }
      } catch {
        // Keep the last settings; the next poll tries again.
      } finally {
        if (!stopped) setSettingsLoaded(true);
      }
    };
    check();
    const t = setInterval(check, SETTINGS_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [phase]);

  // Watch for alerts from page load, even before the mic is started.
  const refreshIncident = useCallback(async () => {
    try {
      // The summary, not /api/incidents/current: phones don't need the heatmap or detections.
      const res = await fetch("/api/incidents/summary", { cache: "no-store" });
      const data = await res.json();
      setIncident(res.ok && data ? { id: data.id, best_room_id: data.best_room_id, best_label: data.best_label } : null);
    } catch {}
  }, []);

  // Which demo space this phone is in: Realtime updates are filtered to it.
  const [space, setSpace] = useState<{ id: string; code: string; name: string | null; shared: boolean } | null>(null);
  useEffect(() => {
    fetch("/api/spaces/current", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setSpace)
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshIncident();
    const poll = setInterval(refreshIncident, POLL_MS);
    if (!space) return () => clearInterval(poll);
    const inSpace = `space_id=eq.${space.id}`;
    const channel = browserDb()
      .channel(`phone-alerts-${space.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "alerts", filter: inSpace }, refreshIncident)
      .on("postgres_changes", { event: "*", schema: "public", table: "incidents", filter: inSpace }, (p) => {
        const row = p.new as { id: string; status: string; best_room_id: string | null; best_label: string | null };
        if (row?.status === "active") setIncident({ id: row.id, best_room_id: row.best_room_id, best_label: row.best_label });
        else refreshIncident();
      })
      .subscribe();
    return () => {
      clearInterval(poll);
      browserDb().removeChannel(channel);
    };
  }, [refreshIncident, space]);

  // New incident: buzz (no sound — it could give away where people are hiding) and reset status.
  const incidentId = incident?.id;
  useEffect(() => {
    if (!incidentId) return;
    setMyStatus(null);
    if (settings.lockdownScreen) navigator.vibrate?.([400, 200, 400, 200, 400]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only buzz when a new incident starts
  }, [incidentId]);

  useEffect(() => () => cleanups.current.forEach((f) => f()), []);

  // Follow the phone on the real map while listening (when the admin panel has it on). Room / exact-spot phones can't:
  // there's no indoor positioning to say where on the floor plan they went.
  const followable = phase === "listening" && checkedIn != null && "lat" in checkedIn.location;
  useEffect(() => {
    if (!settings.followLocation || !followable) return;
    return startFollowing({
      current: () => locationRef.current as MapLocation,
      onFix: setFollowInfo,
      onMove: async (to, movedM, refine) => {
        if (timingCalRef.current) return; // a move mid-calibration would be measured as fake delay
        const res = await checkIn(to);
        locationRef.current = to;
        setCheckedIn({ location: to, roomId: res.roomId });
        setSync(res.sync);
        setGeoSpot(to);
        setPinned(false);
        try {
          localStorage.setItem(LOCATION_KEY, JSON.stringify(to));
        } catch {}
        addLog(
          refine
            ? `Position refined by GPS (±${Math.round(to.accuracyM)} m)`
            : `Moved about ${Math.round(movedM)} m: position updated (GPS ±${Math.round(to.accuracyM)} m)`,
          "sent",
        );
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart only when the switch or listening state changes
  }, [settings.followLocation, followable]);

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
      const { estimate, pending } = await sendDetection({
        deviceId,
        localSpikeTsMs: spike.localSpikeTsMs,
        peakDb: spike.peakDb,
        confidence,
        label,
      });
      addLog(
        `Reported ${spike.peakDb.toFixed(0)} dB (confidence ${confidence}) → ${pending ? "estimate updating…" : `estimate ${estimateName(estimate)}`}, ${estimate.deviceCount} phone(s)`,
        "sent",
      );
    } catch (e) {
      addLog(`Failed to send: ${(e as Error).message}`, "error");
    }
  }, []);

  // The admin panel switched this phone to a different kind of location while it listens: it picks again.
  const relocating = phase === "listening" && checkedIn != null && modeOf(checkedIn.location) !== mode;

  // On the real map, take the GPS fix until a pin is placed by hand; fixes rougher than MAX_GPS_ACCURACY_M need a pin.
  const gps = useGpsFix(mode === "map" && !pinned && (phase === "setup" || relocating));
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
      locationRef.current = location;
      const me: CheckedIn = { location, roomId: res.roomId };
      deviceRef.current = res.deviceId;
      setDeviceId(res.deviceId);
      setSync(res.sync);
      setCheckedIn(me);

      const resync = setInterval(async () => {
        try {
          setSync((await checkIn(locationRef.current ?? location)).sync);
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

  // Check in again with the newly picked location; the phone keeps listening.
  const relocate = async () => {
    if (!location) return;
    try {
      const res = await checkIn(location);
      locationRef.current = location;
      const me: CheckedIn = { location, roomId: res.roomId };
      setCheckedIn(me);
      setSync(res.sync);
      try {
        localStorage.setItem(LOCATION_KEY, JSON.stringify(location));
      } catch {}
      addLog(`Checked in: ${describe(me)}`, "sent");
    } catch (e) {
      addLog(`Failed to check in: ${(e as Error).message}`, "error");
    }
  };

  // Testing: report a shot as if this phone just heard one, bypassing the mic and classifier.
  // The shot "fires" at the start of the current shared window (server clock), and this phone
  // hears it simulateDelayMs later — so phones tapping in the same window report the same shot.
  const simulateShot = async () => {
    if (!deviceId || !sync) return;
    const { simulateDb: testDb, simulateDelayMs: testDelayMs } = settings;
    try {
      const fireServerMs = Math.floor((now() + sync.offsetMs) / TEST_WINDOW_MS) * TEST_WINDOW_MS;
      const { estimate, pending } = await sendDetection({
        deviceId,
        localSpikeTsMs: fireServerMs - sync.offsetMs + testDelayMs,
        peakDb: testDb,
        confidence: 1,
        label: "test shot",
      });
      addLog(
        `Simulated: ${testDb} dB, heard +${testDelayMs} ms → ${pending ? "estimate updating…" : `estimate ${estimateName(estimate)}`}, ${estimate.deviceCount} phone(s)`,
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

  // The location picker for the mode the admin panel set; used to start, and to re-pick after the mode changes.
  const picker =
    mode === "room" ? (
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
    );

  if (incident && settings.lockdownScreen && dismissedIncident !== incident.id) {
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
          <button className={s.exitBtn} onClick={() => setDismissedIncident(incident.id)}>
            Exit lockdown screen
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className={s.page}>
      <h1 className={s.title}>Classroom listener</h1>

      {incident && (
        <p className={s.banner}>
          <b>Alert active</b> · shots near {incidentPlace(incident)}.{" "}
          {settings.lockdownScreen ? (
            <button className={s.linkBtn} onClick={() => setDismissedIncident(null)}>
              Show lockdown screen
            </button>
          ) : (
            "Lockdown screen is off for testing."
          )}
        </p>
      )}

      {phase !== "listening" ? (
        <section className={s.card}>
          <span className={s.label}>
            Where is this phone?{settingsLoaded && ` · ${LOCATION_MODE_NAMES[mode]}`}
          </span>
          {settingsLoaded ? picker : <p className={s.hint}>Loading…</p>}

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
              <dt>Lockdown screen</dt>
              <dd>{settings.lockdownScreen ? "On" : "Off"}</dd>
              <dt>Timing</dt>
              <dd>{TIMING_METHOD_NAMES[settings.timingMethod]}</dd>
              {checkedIn && "lat" in checkedIn.location && (
                <>
                  <dt>Follow location</dt>
                  <dd>
                    {!settings.followLocation
                      ? "Off"
                      : followInfo
                        ? `On · GPS ±${Math.round(followInfo.lastFixAccuracyM)} m, ${Math.round(followInfo.movedM)} m from spot`
                        : "On · waiting for GPS…"}
                  </dd>
                </>
              )}
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
            <p className={s.hint}>Settings for this phone are changed in the admin panel.</p>
          </section>

          {relocating && (
            <section className={s.card}>
              <h2 className={s.h2}>Pick this phone&apos;s location again</h2>
              <p className={s.hint}>
                The admin panel switched this phone to <b>{LOCATION_MODE_NAMES[mode]}</b>. Until you check in, it keeps
                reporting from {describe(checkedIn!)}.
              </p>
              {picker}
              <button className={s.primary} onClick={relocate} disabled={!location}>
                Check in here
              </button>
            </section>
          )}

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

          {calibrating && (
            <p className={s.calBanner}>
              <b>Calibrating the microphone.</b> Hold the phone about 1 m away and clap once, sharply.{" "}
              <button
                className={s.linkBtn}
                onClick={() => {
                  calibratingRef.current = false;
                  setCalibrating(false);
                }}
              >
                Cancel
              </button>
            </p>
          )}

          {settings.showSimulate && (
            <section className={s.card}>
              <h2 className={s.h2}>Simulate a shot (testing)</h2>
              <p className={s.hint}>
                Reports a gunshot as if this phone heard it, at {settings.simulateDb} dB, {settings.simulateDelayMs} ms
                after the shot (set in the admin panel). Phones that tap during the same 10-second window report the same
                shot. Window ends in {Math.ceil(windowLeft / 1000)} s.
              </p>
              <button className={s.danger} onClick={simulateShot} disabled={!sync}>
                Simulate shot
              </button>
            </section>
          )}

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
