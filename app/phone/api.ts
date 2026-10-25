// Phone → server calls. Everything uses one clock (`now`) so the clock offset
// measured here applies exactly to the spike timestamps we send later.

export const now = () => performance.timeOrigin + performance.now();

const DEVICE_KEY = "gunshot.deviceId";

export type Sync = { offsetMs: number; rttMs: number };

async function post<T>(path: string, body: unknown, retries = 2): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw Object.assign(new Error(data.error ?? `HTTP ${res.status}`), { status: res.status });
      return data;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (attempt >= retries || (status && status < 500)) throw e; // don't retry bad requests
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)));
    }
  }
}

/**
 * NTP-style: offset = serverTime − (t0+t1)/2, keeping the sample with the smallest round trip.
 * The error is up to half that round trip, and the localizer compares arrival times to a few ms,
 * so take plenty of samples. The first request is a throwaway: it pays for connection setup
 * (and route compilation in dev), which makes it slow and lopsided.
 */
export async function syncClock(samples = 12): Promise<Sync> {
  await fetch("/api/time", { cache: "no-store" });
  let best: Sync = { offsetMs: 0, rttMs: Infinity };
  for (let i = 0; i < samples; i++) {
    const t0 = now();
    const res = await fetch("/api/time", { cache: "no-store" });
    const { serverTime } = await res.json();
    const t1 = now();
    if (t1 - t0 < best.rttMs) best = { offsetMs: serverTime - (t0 + t1) / 2, rttMs: t1 - t0 };
  }
  return best;
}

/**
 * Where the phone is. On the demo floor plan: a room (its center is used) or an exact spot in meters.
 * On the real map: lat/lng with its accuracy radius in meters (GPS, or a hand-placed pin) and an optional label.
 */
export type PhoneLocation =
  | { roomId: string }
  | { x: number; y: number }
  | { lat: number; lng: number; accuracyM: number; label?: string };

export async function checkIn(
  location: PhoneLocation,
): Promise<{ deviceId: string; roomId: string | null; sync: Sync }> {
  const sync = await syncClock();
  const { deviceId, roomId } = await post<{ deviceId: string; roomId: string | null }>("/api/checkin", {
    deviceId: await claimDeviceId(),
    ...location,
    clockOffsetMs: sync.offsetMs,
    clockRttMs: sync.rttMs,
  });
  tabDeviceId = deviceId;
  try {
    sessionStorage.setItem(DEVICE_KEY, deviceId);
  } catch {}
  return { deviceId, roomId, sync };
}

// One device ID per browser tab, so two tabs on one laptop act as two phones.
// sessionStorage is per tab and survives reloads, but "Duplicate tab" copies it — so a tab
// asks the others over a BroadcastChannel whether its ID is already in use, and drops it if so.
let tabDeviceId: string | null = null;
let channel: BroadcastChannel | null = null;

function tabChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === "undefined") return channel;
  channel = new BroadcastChannel("gunshot-device");
  channel.addEventListener("message", (e) => {
    if (e.data?.type === "who" && tabDeviceId && e.data.id === tabDeviceId) {
      channel!.postMessage({ type: "taken", id: tabDeviceId });
    }
  });
  return channel;
}

async function claimDeviceId(): Promise<string | undefined> {
  if (tabDeviceId) return tabDeviceId;
  let id: string | null = null;
  try {
    id = sessionStorage.getItem(DEVICE_KEY);
  } catch {}
  const ch = tabChannel();
  if (!id || !ch) return id ?? undefined;

  const taken = await new Promise<boolean>((resolve) => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.type === "taken" && e.data.id === id) done(true);
    };
    const done = (result: boolean) => {
      ch.removeEventListener("message", onMessage);
      resolve(result);
    };
    ch.addEventListener("message", onMessage);
    ch.postMessage({ type: "who", id });
    setTimeout(() => done(false), 200);
  });
  return taken ? undefined : id; // undefined → server issues a new ID
}

export const calibrate = (deviceId: string, peakDb: number) =>
  post<{ gainOffsetDb: number }>("/api/calibrate", { deviceId, peakDb });

export const sendDetection = (body: {
  deviceId: string;
  localSpikeTsMs: number;
  peakDb: number;
  confidence: number;
  label: string;
}) => post<{ incidentId: string; estimate: Estimate }>(
  "/api/detection",
  body,
);

export const sendStatus = (deviceId: string, status: "safe" | "need_help" | "injured") =>
  post("/api/status", { deviceId, status });

export type Estimate = {
  x: number;
  y: number;
  lat: number | null; // real map only
  lng: number | null;
  roomId: string | null; // floor plan only
  label: string | null; // room name, or the nearest labeled phone on the real map
  deviceCount: number;
};

// The reference spot is x/y on the floor plan or lat/lng on the real map.
export type ActiveTimingCal = {
  id: string;
  frame: "grid" | "geo";
  x: number | null;
  y: number | null;
  lat: number | null;
  lng: number | null;
} | null;

export async function getTimingCal(): Promise<ActiveTimingCal> {
  const res = await fetch("/api/timing-cal", { cache: "no-store" });
  const data = await res.json();
  if (!res.ok || !data.active) return null;
  const { id, frame, x, y, lat, lng } = data.active;
  return { id, frame: frame ?? "grid", x, y, lat, lng };
}

export const reportTimingCal = (deviceId: string, localSpikeTsMs: number, peakDb: number) =>
  post<{ calibrationId: string; kept: string }>("/api/timing-cal/report", { deviceId, localSpikeTsMs, peakDb });
