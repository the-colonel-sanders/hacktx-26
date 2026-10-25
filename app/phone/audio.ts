import { now } from "./api";

export type Level = { rmsDb: number; peakDb: number; noiseDb: number };
export type Spike = { localSpikeTsMs: number; peakDb: number; samples: Float32Array; sampleRate: number };

export type Listener = { stop: () => void; context: AudioContext };

/**
 * How a spike's audio-clock time is converted to the wall clock (see contextToWallMs):
 * - "output": getOutputTimestamp()'s matched pair minus the browser's render-ahead estimate. No jitter,
 *   but a constant offset per audio session if that estimate is off; timing calibration removes it.
 * - "current": context.currentTime read against now(). No estimate involved, but each reading is off by
 *   up to one device buffer (~10 ms), which calibration can't remove.
 */
export type TimingMethod = "output" | "current";

/**
 * Opens the mic with all browser processing off (AGC would flatten the loudness we
 * need to compare across phones) and runs the spike-detector worklet on it.
 * Must be called from a user gesture (tap) so the AudioContext may start.
 * `timingMethod` is read at each spike, so it can be switched while listening.
 */
export async function startListening(
  onSpike: (s: Spike) => void,
  onLevel: (l: Level) => void,
  timingMethod: () => TimingMethod = () => "output",
): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext({ latencyHint: "interactive" });
  await context.audioWorklet.addModule("/spike-detector.js");

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "spike-detector", { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);

  // Mic → worklet delay, when the browser reports it (Chrome does). Otherwise assume ~0;
  // what's left is constant per phone and removed by timing calibration.
  const track = stream.getAudioTracks()[0];
  const inputLatencyMs = ((track.getSettings() as { latency?: number }).latency ?? 0) * 1000;

  node.port.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "level") onLevel(msg);
    else if (msg.type === "spike") {
      // Convert the onset's AudioContext time to our wall clock *right now*, before any ML runs.
      onSpike({
        localSpikeTsMs: contextToWallMs(context, msg.onsetTime, timingMethod()) - inputLatencyMs,
        peakDb: msg.peakDb,
        samples: msg.samples,
        sampleRate: msg.sampleRate,
      });
    }
  };

  if (context.state === "suspended") await context.resume();

  return {
    context,
    stop: () => {
      node.disconnect();
      source.disconnect();
      track.stop();
      context.close();
    },
  };
}

/**
 * Wall-clock time (same clock as `now()`) at which audio-context time `ctxTime` was captured.
 *
 * Reading `context.currentTime` against `now()` is jittery: currentTime advances in whole
 * device buffers (~10 ms on Windows), so the pair is off by however far into the buffer we read.
 * getOutputTimestamp() returns a matched pair (context time, performance time) for the moment a
 * frame reaches the speaker; frames are rendered `baseLatency + outputLatency` before that, and
 * an input frame is processed as it is rendered. That removes the jitter but trusts the browser's
 * latency estimate (see TimingMethod).
 */
function contextToWallMs(context: AudioContext, ctxTime: number, method: TimingMethod): number {
  const ts = method === "output" ? context.getOutputTimestamp?.() : undefined;
  if (ts?.contextTime && ts.performanceTime) {
    const renderAheadMs = ((context.baseLatency ?? 0) + (context.outputLatency ?? 0)) * 1000;
    return performance.timeOrigin + ts.performanceTime + (ctxTime - ts.contextTime) * 1000 - renderAheadMs;
  }
  // "current", or older browsers without getOutputTimestamp: the jittery pair.
  return now() - (context.currentTime - ctxTime) * 1000;
}

/**
 * "on": the browser's screen wake lock is held.
 * "fallback": no wake lock API (iOS < 16.4); a muted inline video is playing, which keeps
 *   some older browsers awake — best effort.
 * "off": neither worked; the screen may sleep and the mic will stop.
 */
export type AwakeStatus = "on" | "fallback" | "off";

const RECHECK_MS = 10_000;

/**
 * Keep the screen on while listening — when it sleeps, the browser stops the mic.
 * The browser can drop the lock at any time (tab hidden, battery saver, a call), so it is
 * re-requested when the page is visible again, on any tap, and every few seconds.
 */
export async function keepAwake(onStatus: (s: AwakeStatus) => void): Promise<() => void> {
  let lock: WakeLockSentinel | null = null;
  let video: HTMLVideoElement | null = null;
  let stopped = false;

  const startFallbackVideo = async () => {
    if (video) return;
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 2;
    canvas.getContext("2d")?.fillRect(0, 0, 2, 2);
    video = document.createElement("video");
    Object.assign(video, { muted: true, loop: true, playsInline: true, srcObject: canvas.captureStream(1) });
    video.setAttribute("playsinline", "");
    video.style.cssText = "position:fixed;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(video);
    try {
      await video.play();
    } catch {}
  };

  const acquire = async () => {
    if (stopped || (lock && !lock.released)) return;
    if (document.visibilityState !== "visible") return;
    if ("wakeLock" in navigator) {
      try {
        lock = await navigator.wakeLock.request("screen");
        lock.addEventListener("release", () => {
          onStatus("off");
          acquire(); // dropped by the system while visible: ask again
        });
        onStatus("on");
        return;
      } catch {
        // Refused (battery saver, not visible yet, no user gesture); retried below.
      }
    } else {
      await startFallbackVideo();
      onStatus(video && !video.paused ? "fallback" : "off");
      return;
    }
    onStatus("off");
  };

  const onVisible = () => {
    if (document.visibilityState === "visible") acquire();
  };
  const onTap = () => acquire();

  await acquire();
  document.addEventListener("visibilitychange", onVisible);
  document.addEventListener("pointerdown", onTap);
  const timer = setInterval(acquire, RECHECK_MS);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener("visibilitychange", onVisible);
    document.removeEventListener("pointerdown", onTap);
    lock?.release();
    video?.pause();
    video?.remove();
  };
}
