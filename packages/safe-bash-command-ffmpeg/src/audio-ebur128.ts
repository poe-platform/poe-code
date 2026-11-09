import type { MediaAudioData, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

// BS.1770 K-weighting, 400 ms overlapping gates and 3 s loudness range.
// Histogram resolution and reporting follow FFmpeg's ebur128 filter.
export async function* measureEbur128(
  channels: MediaAudioData["channelData"], sampleRate: number, channelMask: number | undefined,
  options: string, budget: MediaBudgetTracker, signal?: AbortSignal
): AsyncGenerator<string> {
  let samplePeaks = false;
  for (const option of options ? options.split(":") : []) {
    if (option === "peak=sample") samplePeaks = true;
    else if (option === "peak=none" || option === "peak=0") samplePeaks = false;
    else throw new Error(`ebur128: unsupported option ${option}`);
  }
  const mask = channelMask || [0, 4, 3, 7, 0x107, 0x37, 0x3f, 0x70f, 0x63f][channels.length];
  if (!mask) throw new Error("ebur128: unsupported channel layout");
  const weights: number[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (mask & (1 << bit)) weights.push(bit === 3 ? 0 : [4, 5, 8, 9, 10, 15, 16, 17].includes(bit) ? 1.41 : 1);
  }
  if (weights.length !== channels.length) throw new Error("ebur128: mismatched channel layout");
  const k = Math.tan(Math.PI * 1681.974450955533 / sampleRate);
  const q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20);
  const vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const b0 = (vh + vb * k / q + k * k) / a0;
  const b1 = 2 * (k * k - vh) / a0;
  const b2 = (vh - vb * k / q + k * k) / a0;
  const a1 = 2 * (k * k - 1) / a0;
  const a2 = (1 - k / q + k * k) / a0;
  const r = Math.tan(Math.PI * 38.13547087602444 / sampleRate);
  const rq = 0.5003270373238773;
  const ra1 = 2 * (r * r - 1) / (1 + r / rq + r * r);
  const ra2 = (1 - r / rq + r * r) / (1 + r / rq + r * r);
  const state = channels.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, z1: 0, z2: 0, peak: 0 }));
  const windows = [Math.floor(sampleRate * 0.4), sampleRate * 3].map(size => ({
    cache: new Float64Array(size), sum: 0, loudness: -120.691,
    histogram: new Float64Array(8001), keptSum: 0, keptCount: 0, threshold: 0, gate: 0
  }));
  const loudness = (energy: number) => -0.691 + 10 * Math.log10(energy);
  const bin = (level: number) => Math.max(0, Math.min(8000, Math.trunc((level + 70) * 100)));
  const energies = Float64Array.from({ length: 8001 }, (_, i) => 10 ** ((i / 100 - 70 + 0.691) / 10));
  const db = (value: number) => value === 0 ? "-inf" : (20 * Math.log10(value)).toFixed(1);
  let integrated = -70;
  let low = 0;
  let high = 0;
  let work = 0;
  const frames = channels[0]?.length ?? 0;
  const interval = Math.max(1, Math.floor(sampleRate / 10));
  for (let frame = 0; frame < frames; frame++) {
    let power = 0;
    for (const [ch, s] of state.entries()) {
      if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted(); }
      const x = channels[ch]![frame]!;
      s.peak = Math.max(s.peak, Math.abs(x));
      const y = x * b0 + s.x1 * b1 + s.x2 * b2 - s.y1 * a1 - s.y2 * a2;
      const z = y - 2 * s.y1 + s.y2 - s.z1 * ra1 - s.z2 * ra2;
      s.x2 = s.x1; s.x1 = x;
      s.y2 = s.y1; s.y1 = y;
      s.z2 = s.z1; s.z1 = z;
      power += weights[ch]! * z * z;
    }
    for (const window of windows) {
      const position = frame % window.cache.length;
      window.sum += power - window.cache[position]!;
      window.cache[position] = power;
    }
    if ((frame + 1) % interval !== 0) continue;
    for (const [index, window] of windows.entries()) {
      const energy = frame + 1 >= window.cache.length
        ? (Math.max(0, window.sum) + 1e-12) / window.cache.length : 1e-12;
      window.loudness = loudness(energy);
      if (window.loudness < -70) continue;
      window.histogram[bin(window.loudness)]!++;
      window.keptSum += energy;
      window.keptCount++;
      window.threshold = loudness(window.keptSum / window.keptCount) - (index === 0 ? 10 : 20);
      window.gate = bin(window.threshold);
      let count = 0;
      let sum = 0;
      for (let i = window.gate; i < window.histogram.length; i++) {
        count += window.histogram[i]!;
        sum += window.histogram[i]! * energies[i]!;
      }
      if (index === 0) integrated = loudness(sum / count);
      else {
        let accumulated = 0;
        const lowerCount = Math.floor(count * 0.1 + 0.5);
        const upperCount = Math.floor(count * 0.95 + 0.5);
        for (let i = window.gate; i < window.histogram.length; i++) {
          accumulated += window.histogram[i]!;
          if (accumulated >= lowerCount) { low = i / 100 - 70; break; }
        }
        accumulated = count;
        for (let i = window.histogram.length - 1; i >= 0; i--) {
          accumulated -= window.histogram[i]!;
          if (accumulated < upperCount) { high = i / 100 - 70; break; }
        }
      }
    }
    const time = frame / sampleRate;
    const timeText = String(Number(time < 1 ? time.toPrecision(6) : time.toFixed(6)));
    yield `t: ${timeText.padEnd(10)} TARGET:-23 LUFS    M:${windows[0]!.loudness.toFixed(1).padStart(6)} S:${windows[1]!.loudness.toFixed(1).padStart(6)}     I:${integrated.toFixed(1).padStart(6)} LUFS       LRA:${(high - low).toFixed(1).padStart(6)} LU${samplePeaks ? `  SPK: ${state.map(s => db(s.peak)).join(" ")} dBFS` : ""}\n`;
  }
  yield `Summary:\n\n  Integrated loudness:\n    I:         ${integrated.toFixed(1)} LUFS\n    Threshold: ${windows[0]!.threshold.toFixed(1)} LUFS\n\n  Loudness range:\n    LRA:       ${(high - low).toFixed(1)} LU\n    Threshold: ${windows[1]!.threshold.toFixed(1)} LUFS\n    LRA low:   ${low.toFixed(1)} LUFS\n    LRA high:  ${high.toFixed(1)} LUFS${samplePeaks ? `\n\n  Sample peak:\n    Peak:      ${db(Math.max(...state.map(s => s.peak)))} dBFS` : ""}\n`;
}
