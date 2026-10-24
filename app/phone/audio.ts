import { now } from "./api";

export type Level = { rmsDb: number; peakDb: number; noiseDb: number };
export type Spike = { localSpikeTsMs: number; peakDb: number; samples: Float32Array; sampleRate: number };

export type Listener = { stop: () => void; context: AudioContext };

/**
 * Opens the mic with all browser processing off (AGC would flatten the loudness we
 * need to compare across phones) and runs the spike-detector worklet on it.
 * Must be called from a user gesture (tap) so the AudioContext may start.
 */
export async function startListening(onSpike: (s: Spike) => void, onLevel: (l: Level) => void): Promise<Listener> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
  const context = new AudioContext({ latencyHint: "interactive" });
  await context.audioWorklet.addModule("/spike-detector.js");

  const source = context.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(context, "spike-detector", { numberOfInputs: 1, numberOfOutputs: 0 });
  source.connect(node);

  // Mic → worklet delay, when the browser reports it (Chrome does). Otherwise assume ~0;
  // it's roughly constant per phone, which matters far less than ML latency would.
  const track = stream.getAudioTracks()[0];
  const inputLatencyMs = ((track.getSettings() as { latency?: number }).latency ?? 0) * 1000;

  node.port.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "level") onLevel(msg);
    else if (msg.type === "spike") {
      // Convert the onset's AudioContext time to our wall clock *right now*, before any ML runs.
      const ageMs = (context.currentTime - msg.onsetTime) * 1000;
      onSpike({
        localSpikeTsMs: now() - ageMs - inputLatencyMs,
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

/** Keep the screen on — the mic stops when the page is backgrounded (especially on iOS). */
export async function keepAwake(): Promise<() => void> {
  let lock: WakeLockSentinel | null = null;
  const acquire = async () => {
    try {
      lock = await navigator.wakeLock?.request("screen");
    } catch {}
  };
  const onVisible = () => document.visibilityState === "visible" && acquire();
  await acquire();
  document.addEventListener("visibilitychange", onVisible);
  return () => {
    document.removeEventListener("visibilitychange", onVisible);
    lock?.release();
  };
}
