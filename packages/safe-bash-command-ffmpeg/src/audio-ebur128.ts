import type { MediaAudioData, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { updateAudioMetadata } from "./audio-metadata.js";
import { createResampleKernel } from "./audio-resample-kernel.js";
import { parseFilterExpression } from "./filter-expression.js";

// BS.1770 K-weighting, 400 ms overlapping gates and 3 s loudness range.
// Histogram resolution and reporting follow FFmpeg's ebur128 filter.
export async function* measureEbur128(
  channels: MediaAudioData["channelData"], sampleRate: number, channelMask: number | undefined,
  options: string, budget: MediaBudgetTracker, logLevel: number, signal?: AbortSignal,
  timestamps?: { start: number; end: number; pts: number }[], startSample = 0,
  metadata?: { tags: Map<string, string> }[]
): AsyncGenerator<string> {
  signal?.throwIfAborted();
  budget.checkCpu();
  let truePeaks = false;
  let samplePeaks = false;
  let target = -23;
  let scale = 0;
  let frameLog = metadata ? 40 : 32;
  let dualMono = false;
  let panLaw = -3.01029995663978;
  for (const option of options ? options.split(":") : []) {
    if (option.startsWith("target=") || option.startsWith("scale=")) {
      const key = option.slice(0, option.indexOf("="));
      const value = parseFilterExpression(option.slice(key.length + 1), "ebur128",
        key === "scale" ? { absolute: 0, LUFS: 0, relative: 1, LU: 1 } : {});
      if (!Number.isFinite(value) || value < (key === "target" ? -23 : 0) || value > (key === "target" ? 0 : 1)) {
        throw new Error(`ebur128: invalid ${key}`);
      }
      // AVOption integers round to nearest, with ties to even.
      const lower = Math.floor(value);
      const rounded = value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
      if (key === "target") target = rounded;
      else scale = rounded;
      continue;
    }
    if (option.startsWith("peak=")) {
      const [name, value, extra] = option.split("=");
      const modes = value?.split("+") ?? [];
      if (name !== "peak" || extra !== undefined || !modes.length ||
          modes.some(mode => !["none", "0", "1", "sample", "2", "3", "true", "4", "5", "6", "7"].includes(mode))) {
        throw new Error(`ebur128: unsupported option ${option}`);
      }
      const peaks = modes.reduce((mask, mode) => mask | (mode === "sample" ? 2 : mode === "true" ? 4 : mode === "none" ? 0 : Number(mode)), 0);
      samplePeaks = Boolean(peaks & 2);
      truePeaks = Boolean(peaks & 4);
    } else if (option === "framelog=info" || option === "framelog=32") frameLog = 32;
    else if (option === "framelog=verbose" || option === "framelog=40") frameLog = 40;
    else if (option.startsWith("dualmono=")) {
      const value = option.slice("dualmono=".length).toLowerCase();
      if (["1", "true", "yes", "on"].includes(value)) dualMono = true;
      else if (["0", "false", "no", "off"].includes(value)) dualMono = false;
      else throw new Error(`ebur128: invalid option ${option}`);
    } else if (option.startsWith("panlaw=")) {
      const value = option.slice("panlaw=".length).trim();
      panLaw = Number(value);
      if (!value || !Number.isFinite(panLaw) || panLaw < -10 || panLaw > 0) {
        throw new Error(`ebur128: invalid option ${option}`);
      }
    } else throw new Error(`ebur128: unsupported option ${option}`);
  }
  const resampler = truePeaks && sampleRate !== 192000
    ? createResampleKernel(sampleRate, 192000, budget) : undefined;
  const compensation = channels.length === 1 && dualMono ? -panLaw : 0;
  const offset = scale === 1 ? target : 0;
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
  const state = channels.map(() => ({ x1: 0, x2: 0, y1: 0, y2: 0, z1: 0, z2: 0, peak: 0, truePeak: 0, framePeak: 0 }));
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
  let timestampIndex = 0;
  let peakPosition = 0;
  let peakWork = 0;
  for (let frame = 0; frame < frames; frame++) {
    if (truePeaks && frame % interval === 0) {
      for (const s of state) s.framePeak = 0;
      const end = Math.min(frames, frame + interval);
      // swresample retains the right half of its kernel. ebur128 does not flush
      // that delay, but it does measure the final partial input interval.
      const peakEnd = resampler
        ? end <= resampler.taps ? 0 : Math.ceil((end - (resampler.taps - resampler.center - 1)) * 192000 / sampleRate)
        : end;
      budget.checkSamples(peakEnd);
      for (; peakPosition < peakEnd; peakPosition++) {
        const position = peakPosition * sampleRate / 192000;
        const base = Math.floor(position);
        const kernel = resampler?.kernels[Math.min(resampler.phases - 1,
          Math.round((position - base) * resampler.phases))];
        for (const [ch, s] of state.entries()) {
          let value = 0;
          if (resampler && kernel) {
            for (let j = 0; j < kernel.length; j++) {
              value += channels[ch]![Math.abs(base + j - resampler.center)]! * kernel[j]!;
            }
          } else value = channels[ch]![peakPosition]!;
          s.framePeak = Math.max(s.framePeak, Math.abs(value));
          s.truePeak = Math.max(s.truePeak, s.framePeak);
        }
        if ((peakWork += (kernel?.length ?? 1) * channels.length) >= 32768) {
          peakWork = 0; budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted();
        }
      }
    }
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
      // Compensate reported loudness, leaving the absolute and relative gates unchanged.
      if (index === 0) integrated = loudness(sum / count) + compensation;
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
    if (metadata) {
      const tags = metadata[(frame + 1) / interval - 1]!.tags;
      const values: [string, number][] = [
        ["M", windows[0]!.loudness + compensation], ["S", windows[1]!.loudness + compensation], ["I", integrated],
        ["LRA", high - low], ["LRA.low", low], ["LRA.high", high]
      ];
      if (samplePeaks) {
        for (const [ch, s] of state.entries()) values.push([`sample_peaks_ch${ch}`, s.peak]);
        values.push(["sample_peak", Math.max(...state.map(s => s.peak))]);
      }
      if (truePeaks) {
        for (const [ch, s] of state.entries()) values.push([`true_peaks_ch${ch}`, s.truePeak]);
        values.push(["true_peak", Math.max(...state.map(s => s.truePeak))]);
      }
      for (const [key, value] of values) {
        const text = value.toFixed(3);
        budget.allocateMemory(64 + 2 * (11 + key.length + text.length));
        updateAudioMetadata(tags, `lavfi.r128.${key}`, text);
      }
    }
    while (timestamps && timestampIndex + 1 < timestamps.length && timestamps[timestampIndex]!.end <= frame) timestampIndex++;
    const timestamp = timestamps?.[timestampIndex];
    const time = (timestamp ? timestamp.pts + frame - timestamp.start : startSample + frame) / sampleRate;
    const timeText = String(Number(Math.abs(time) < 1 ? time.toPrecision(6) : time.toFixed(6)));
    if (logLevel >= frameLog) yield `t: ${timeText.padEnd(10)} TARGET:${target} LUFS    M:${(windows[0]!.loudness + compensation - offset).toFixed(1).padStart(6)} S:${(windows[1]!.loudness + compensation - offset).toFixed(1).padStart(6)}     I:${(integrated - offset).toFixed(1).padStart(6)} ${scale === 1 ? "LU" : "LUFS"}       LRA:${(high - low).toFixed(1).padStart(6)} LU${samplePeaks ? `  SPK: ${state.map(s => db(s.peak)).join(" ")} dBFS` : ""}${truePeaks ? `  FTPK: ${state.map(s => db(s.framePeak)).join(" ")} dBFS  TPK: ${state.map(s => db(s.truePeak)).join(" ")} dBFS` : ""}\n`;
  }
  if (logLevel >= 32) yield `Summary:\n\n  Integrated loudness:\n    I:         ${integrated.toFixed(1)} LUFS\n    Threshold: ${(windows[0]!.threshold + compensation).toFixed(1)} LUFS\n\n  Loudness range:\n    LRA:       ${(high - low).toFixed(1)} LU\n    Threshold: ${(windows[1]!.threshold + compensation).toFixed(1)} LUFS\n    LRA low:   ${(low + compensation).toFixed(1)} LUFS\n    LRA high:  ${(high + compensation).toFixed(1)} LUFS${samplePeaks ? `\n\n  Sample peak:\n    Peak:      ${db(Math.max(...state.map(s => s.peak)))} dBFS` : ""}${truePeaks ? `\n\n  True peak:\n    Peak:      ${db(Math.max(...state.map(s => s.truePeak)))} dBFS` : ""}\n`;
}
