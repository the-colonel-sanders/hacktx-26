// AudioWorklet: finds loud impulsive onsets in the mic stream.
//
// Runs on the audio thread, so the onset time is exact to the sample
// (independent of how long the main thread / ML model takes afterwards).
// Posts:
//   { type: "level", rmsDb, peakDb, noiseDb }                ~10×/s, for the UI meter
//   { type: "spike", onsetTime, peakDb, samples, sampleRate } once per onset;
//       onsetTime is in AudioContext seconds, samples is PRE_MS before → POST_MS after.

const PRE_MS = 100;
const POST_MS = 400;
const PEAK_WINDOW_MS = 50; // peakDb = loudest sample within this long after onset
const REFRACTORY_MS = 300; // one shot → one spike (ignore echoes)
const LEVEL_EVERY_MS = 100;

const toDb = (a) => 20 * Math.log10(Math.max(a, 1e-9));

class SpikeDetector extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const p = (options && options.processorOptions) || {};
    this.minDb = p.minDb ?? -30; // absolute floor for an onset (dBFS)
    this.riseDb = p.riseDb ?? 20; // must also be this far above the running noise floor

    this.pre = Math.round((PRE_MS / 1000) * sampleRate);
    this.post = Math.round((POST_MS / 1000) * sampleRate);
    this.peakWin = Math.round((PEAK_WINDOW_MS / 1000) * sampleRate);
    this.refractory = Math.round((REFRACTORY_MS / 1000) * sampleRate);
    this.ring = new Float32Array(this.pre + this.post);
    this.ringPos = 0;

    this.noiseDb = -60;
    this.pending = null; // { onsetFrame, peak, remaining }
    this.quietUntil = 0;
    this.levelEvery = Math.round((LEVEL_EVERY_MS / 1000) * sampleRate);
    this.levelCount = 0;
    this.levelPeak = 0;
    this.levelSumSq = 0;

    this.port.onmessage = (e) => {
      if (e.data.minDb != null) this.minDb = e.data.minDb;
      if (e.data.riseDb != null) this.riseDb = e.data.riseDb;
    };
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;

    let blockSumSq = 0;
    for (let i = 0; i < ch.length; i++) {
      const s = ch[i];
      const a = Math.abs(s);
      const frame = currentFrame + i;
      this.ring[this.ringPos] = s;
      this.ringPos = (this.ringPos + 1) % this.ring.length;
      blockSumSq += s * s;
      if (a > this.levelPeak) this.levelPeak = a;

      if (this.pending) {
        if (frame - this.pending.onsetFrame < this.peakWin && a > this.pending.peak) this.pending.peak = a;
        if (--this.pending.remaining === 0) this.emit();
      } else if (frame >= this.quietUntil) {
        const db = toDb(a);
        if (db > this.minDb && db > this.noiseDb + this.riseDb) {
          this.pending = { onsetFrame: frame, peak: a, remaining: this.post };
        }
      }
    }

    // Slow-moving noise floor (only while nothing is happening).
    const blockRmsDb = toDb(Math.sqrt(blockSumSq / ch.length));
    if (!this.pending && currentFrame >= this.quietUntil) this.noiseDb += 0.02 * (blockRmsDb - this.noiseDb);

    this.levelSumSq += blockSumSq;
    this.levelCount += ch.length;
    if (this.levelCount >= this.levelEvery) {
      this.port.postMessage({
        type: "level",
        rmsDb: toDb(Math.sqrt(this.levelSumSq / this.levelCount)),
        peakDb: toDb(this.levelPeak),
        noiseDb: this.noiseDb,
      });
      this.levelCount = 0;
      this.levelSumSq = 0;
      this.levelPeak = 0;
    }
    return true;
  }

  emit() {
    const { onsetFrame, peak } = this.pending;
    // Unroll the ring: oldest sample first. It now holds PRE_MS before the onset + POST_MS after.
    const n = this.ring.length;
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) samples[i] = this.ring[(this.ringPos + i) % n];
    this.port.postMessage(
      { type: "spike", onsetTime: onsetFrame / sampleRate, peakDb: toDb(peak), samples, sampleRate },
      [samples.buffer],
    );
    this.pending = null;
    this.quietUntil = onsetFrame + this.post + this.refractory;
  }
}

registerProcessor("spike-detector", SpikeDetector);
