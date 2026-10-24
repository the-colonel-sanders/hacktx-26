// PLACEHOLDER gunshot classifier — replace with your on-device model.
//
// Input: mono samples around the spike (100 ms before the onset → 400 ms after) and the sample rate.
// Output: confidence 0..1 and a label. Detections below MIN_CONFIDENCE are not sent.
//
// This heuristic just accepts sharp, fast-decaying impulses (gunshots, but also claps,
// slammed books, dropped objects), which is handy for demos. It is NOT a gunshot detector.

export const MIN_CONFIDENCE = 0.6;

export type Classification = { confidence: number; label: string };

export async function classify(samples: Float32Array, sampleRate: number): Promise<Classification> {
  const ms = (t: number) => Math.round((t / 1000) * sampleRate);
  const onset = ms(100);

  const rms = (from: number, to: number) => {
    let sum = 0;
    for (let i = from; i < to; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, to - from));
  };
  const db = (a: number) => 20 * Math.log10(Math.max(a, 1e-9));

  const before = db(rms(0, onset - ms(5))); // background just before
  const attack = db(rms(onset, onset + ms(20))); // the bang
  const tail = db(rms(onset + ms(200), onset + ms(400))); // should have died down

  const rise = attack - before; // impulsive: big jump
  const decay = attack - tail; // impulsive: fast decay (sustained noise/music fails this)
  const score = Math.min(1, Math.max(0, (rise - 10) / 20)) * Math.min(1, Math.max(0, (decay - 6) / 14));

  return { confidence: Math.round(score * 100) / 100, label: "impulse (placeholder)" };
}
