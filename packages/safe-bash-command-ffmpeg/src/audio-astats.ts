import type { MediaAudioData, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { updateAudioMetadata } from "./audio-metadata.js";
import { parseFilterExpression } from "./filter-expression.js";

// Bit positions from FFmpeg's af_astats.c (the order is part of the option format).
const measurementFlags: Record<string, number> = Object.fromEntries([
  "DC_offset", "Min_level", "Max_level", "Min_difference", "Max_difference",
  "Mean_difference", "RMS_difference", "Peak_level", "RMS_level", "RMS_peak",
  "RMS_trough", "Crest_factor", "Flat_factor", "Peak_count", "Bit_depth",
  "Dynamic_range", "Zero_crossings", "Zero_crossings_rate", "Number_of_samples",
  "Number_of_NaNs", "Number_of_Infs", "Number_of_denormals", "Noise_floor",
  "Noise_floor_count", "Entropy", "Abs_Peak_count"
].map((name, bit) => [name, 2 ** bit]));

export function parseAstatsMeasurements(value: string, current = 0xffffffff): number {
  let mask = current;
  let position = 0;
  for (;;) {
    const operation = value[position];
    if (operation === "+" || operation === "-") position++;
    const start = position;
    while (position < value.length && value[position] !== "+" && value[position] !== "-") position++;
    const bits = parseFilterExpression(value.slice(start, position), "astats", {
      ...measurementFlags, none: 0, all: 0xffffffff, default: 0xffffffff, min: 0, max: 0xffffffff
    });
    if (!Number.isInteger(bits) || bits < 0 || bits > 0xffffffff) {
      throw new RangeError("astats: invalid measurement mask");
    }
    mask = operation === "+" ? mask | bits : operation === "-" ? mask & ~bits : bits;
    if (position === value.length) return mask >>> 0;
  }
}

function fixed(value: number): string {
  return Number.isNaN(value) ? "nan" : value === -Infinity ? "-inf" : value === Infinity ? "inf" : value.toFixed(6);
}

function db(value: number): string {
  return fixed(20 * Math.log10(value));
}

function bitDepth(masks: number[], bits: number): number[] {
  const counts = [0, 0, bits, 0];
  let varying = (masks[1]! & ~masks[2]!) >>> 0;
  for (let bit = 0; bit < bits; bit++) {
    counts[0]! += (masks[0]! >>> bit) & 1;
    counts[1]! += (masks[1]! >>> bit) & 1;
    counts[3]! += (masks[3]! >>> bit) & 1;
  }
  while (counts[2]! > 0 && !(varying & 1)) {
    counts[2]!--;
    varying >>>= 1;
  }
  return counts;
}

function measurements(title: string, fields: [string, string | number][], mask?: number): string {
  if (mask === 0) return "";
  let report = `${title}\n`;
  for (const [name, value] of fields) {
    const key = (name.endsWith(" dB") ? name.slice(0, -3) : name).replaceAll(" ", "_");
    if (mask === undefined || (mask & measurementFlags[key]!) !== 0) report += `${name}: ${value}\n`;
  }
  return report;
}

// Default astats measurements follow FFmpeg 7's af_astats.c, including its
// completed extrema runs and value-based eviction of sliding noise peaks.
export async function measureAstats(
  channels: MediaAudioData["channelData"], sampleRate: number, scale: number, length: number,
  budget: MediaBudgetTracker, signal?: AbortSignal,
  perChannel?: number, overall?: number,
  metadata?: { end: number; tags: Map<string, string> }[]
): Promise<string> {
  const window = Math.max(1, Math.floor(sampleRate * length + 0.5));
  const decay = Math.exp(-1 / length / sampleRate);
  const bits = scale === 32768 / 32767 ? 16 : 32;
  const unit = scale === 1 ? 1 : 2 ** (bits - 1);
  budget.allocateMemory((8192 + 2 * window) * 8);
  const histogram = new Float64Array(8192);
  const samples = new Float64Array(window);
  const peaks = new Float64Array(window);
  const setMetadata = (tags: Map<string, string>, section: string, values: Record<string, string | number>, mask?: number) => {
    for (const [name, value] of Object.entries(values)) {
      const flag = measurementFlags[name.startsWith("Bit_depth") ? "Bit_depth" : name]!;
      if (mask !== undefined && (mask & flag) === 0) continue;
      const key = `lavfi.astats.${section}.${name}`;
      const formatted = typeof value === "number" ? fixed(value) : value;
      budget.allocateMemory(64 + 2 * (key.length + formatted.length));
      updateAudioMetadata(tags, key, formatted);
    }
  };
  budget.allocateMemory((metadata?.length ?? 1) * 256);
  const totals = Array.from({ length: metadata?.length ?? 1 }, () => ({
    count: 0, sum: 0, squares: 0, min: Infinity, max: -Infinity,
    minDiff: Infinity, maxDiff: 0, differences: 0, differenceSquares: 0,
    minRms: Infinity, maxRms: -Infinity, peak: 0, runs: 0, peakCount: 0,
    absPeakCount: 0, noise: 0, noiseCount: 0, entropy: 0, masks: [0, 0, -1, 0]
  }));
  let report = "";
  let work = 0;
  for (const [channelIndex, channel] of channels.entries()) {
    if (channel.length === 0) continue;
    histogram.fill(0);
    samples.fill(0);
    peaks.fill(-1);
    let front = 0, back = 0, position = 0;
    let sum = 0, squares = 0, average = 0;
    let minRms = Number.MAX_VALUE, maxRms = -Number.MAX_VALUE;
    let min = Infinity, max = -Infinity, minNonzero = Number.MAX_VALUE;
    let minCount = 0, maxCount = 0, minRun = 0, maxRun = 0, minRuns = 0, maxRuns = 0;
    let peak = 0, absPeakCount = 0, noise = NaN, noiseCount = 0;
    let minDiff = Number.MAX_VALUE, maxDiff = 0, differences = 0, differenceSquares = 0;
    let last = NaN, lastInteger = 0, lastNonzero = 0, crossings = 0;
    const masks = [0, 0, -1, 0];
    let frameIndex = 0;
    for (let i = 0; i < channel.length; i++) {
      if (++work % 1024 === 0) {
        budget.checkCpu();
        await yieldTurn(signal);
        signal?.throwIfAborted();
      }
      const value = channel[i]! * unit;
      const normalized = channel[i]! * scale;
      const absolute = Math.abs(value);
      const amplitude = Math.abs(normalized);
      if (absolute > peak) { peak = absolute; absPeakCount = 1; }
      else if (absolute === peak) absPeakCount++;
      if (value < min) {
        min = value; minCount = 1; minRun = 1; minRuns = 0;
      } else if (value === min) {
        minCount++; minRun = value === last ? minRun + 1 : 1;
      } else if (last === min) minRuns += minRun * minRun;
      if (value > max) {
        max = value; maxCount = 1; maxRun = 1; maxRuns = 0;
      } else if (value === max) {
        maxCount++; maxRun = value === last ? maxRun + 1 : 1;
      } else if (last === max) maxRuns += maxRun * maxRun;
      if (value !== 0) {
        minNonzero = Math.min(minNonzero, absolute);
        // FFmpeg treats zero as negative when counting the first crossing.
        if ((value > 0) !== (lastNonzero > 0)) crossings++;
        lastNonzero = value;
      }
      sum += normalized;
      squares += normalized * normalized;
      average = average * decay + (1 - decay) * normalized * normalized;
      if (i > 0) {
        const difference = Math.abs(value - last);
        minDiff = Math.min(minDiff, difference);
        maxDiff = Math.max(maxDiff, difference);
        differences += difference;
        differenceSquares += difference * difference;
      }
      const integer = scale === 1 ? Math.round(value * 2147483648) | 0 : value;
      masks[0]! |= Math.abs(integer);
      masks[1]! |= integer;
      masks[2]! &= integer;
      if (i > 0) masks[3]! |= integer ^ lastInteger;
      lastInteger = integer;
      last = value;
      const bin = Math.min(amplitude, 1) * 8191;
      const floor = Math.floor(bin);
      histogram[bin - floor === 0.5 ? floor + floor % 2 : Math.round(bin)]!++;
      const drop = samples[position]!;
      samples[position] = amplitude;
      position = (position + 1) % window;
      if (i >= window) {
        minRms = Math.min(minRms, average);
        maxRms = Math.max(maxRms, average);
      }
      let empty = front === back && peaks[front] === -1;
      if (!empty && drop === peaks[front]) {
        peaks[front] = -1;
        if (back !== front) front = (front + window - 1) % window;
        empty = front === back;
      }
      if (!empty && amplitude >= peaks[front]!) {
        while (true) {
          peaks[front] = -1;
          if (back === front) { empty = true; break; }
          front = (front + window - 1) % window;
        }
      }
      while (!empty && amplitude >= peaks[back]!) {
        peaks[back] = -1;
        if (back === front) { empty = true; break; }
        back = (back + 1) % window;
      }
      if (!empty) back = (back + window - 1) % window;
      peaks[back] = amplitude;
      const floorPeak = peaks[front]!;
      if (i + 1 >= window) {
        if (Number.isNaN(noise) || floorPeak < noise) { noise = floorPeak; noiseCount = 1; }
        else if (floorPeak === noise) noiseCount++;
      }
      const length = i + 1;
      const frame = metadata?.[frameIndex];
      if (length !== (frame?.end ?? channel.length)) continue;
      const total = totals[frameIndex++]!;
      if (length < window) minRms = maxRms = squares / length;
      let entropy = 0;
      for (const count of histogram) {
        const probability = count / length;
        if (probability > 1e-8) entropy -= probability * Math.log2(probability) / 13;
      }
      const normalizedPeak = peak / unit * scale;
      const rms = Math.sqrt(squares / length);
      if (frame) {
        const depth = bitDepth(masks, bits);
        setMetadata(frame.tags, String(channelIndex + 1), {
          DC_offset: sum / length, Min_level: min, Max_level: max,
          Min_difference: minDiff, Max_difference: maxDiff,
          Mean_difference: differences / (length - 1), RMS_difference: Math.sqrt(differenceSquares / (length - 1)),
          Peak_level: db(normalizedPeak), RMS_level: db(rms),
          RMS_peak: db(Math.sqrt(maxRms)), RMS_trough: db(Math.sqrt(minRms)),
          // FFmpeg metadata uses the raw peak for crest factor and overwrites
          // the channel Peak_count with the absolute peak count.
          Crest_factor: squares ? peak / rms : 1,
          Flat_factor: db((minRuns + maxRuns) / (minCount + maxCount)), Peak_count: absPeakCount,
          Noise_floor: db(noise), Noise_floor_count: noiseCount,
          Entropy: entropy === 0 ? "-0.000000" : fixed(entropy),
          Bit_depth: depth[0]!, Bit_depth2: depth[1]!, Bit_depth3: depth[2]!, Bit_depth4: depth[3]!,
          Dynamic_range: db(2 * peak / minNonzero), Zero_crossings: crossings, Zero_crossings_rate: crossings / length
        }, perChannel);
      }
      if (length === channel.length) {
        report += measurements(`Channel: ${channelIndex + 1}`, [
          ["DC offset", fixed(sum / channel.length)], ["Min level", fixed(min)], ["Max level", fixed(max)],
          ["Min difference", fixed(minDiff)], ["Max difference", fixed(maxDiff)],
          ["Mean difference", fixed(differences / (channel.length - 1))],
          ["RMS difference", fixed(Math.sqrt(differenceSquares / (channel.length - 1)))],
          ["Peak level dB", db(normalizedPeak)], ["RMS level dB", db(rms)], ["RMS peak dB", db(Math.sqrt(maxRms))],
          ...(minRms === 1 ? [] : [["RMS trough dB", db(Math.sqrt(minRms))]] as [string, string][]),
          ["Crest factor", fixed(squares ? normalizedPeak / rms : 1)], ["Flat factor", db((minRuns + maxRuns) / (minCount + maxCount))],
          ["Peak count", minCount + maxCount], ["Abs Peak count", absPeakCount],
          ["Noise floor dB", db(noise)], ["Noise floor count", noiseCount],
          ["Entropy", fixed(entropy)], ["Bit depth", bitDepth(masks, bits).join("/")], ["Dynamic range", db(2 * peak / minNonzero)],
          ["Zero crossings", crossings], ["Zero crossings rate", fixed(crossings / channel.length)]
        ], perChannel);
      }
      total.count += length;
      if (Math.abs(sum) > Math.abs(total.sum)) total.sum = sum;
      total.squares += squares;
      total.min = Math.min(total.min, min);
      total.max = Math.max(total.max, max);
      total.minDiff = Math.min(total.minDiff, minDiff);
      total.maxDiff = Math.max(total.maxDiff, maxDiff);
      total.differences += differences;
      total.differenceSquares += differenceSquares;
      total.minRms = Math.min(total.minRms, minRms);
      total.maxRms = Math.max(total.maxRms, maxRms);
      total.peak = Math.max(total.peak, normalizedPeak);
      total.runs += minRuns + maxRuns;
      total.peakCount += minCount + maxCount;
      total.absPeakCount += absPeakCount;
      total.noise = Math.max(total.noise, noise);
      total.noiseCount += noiseCount;
      total.entropy += entropy;
      total.masks[0]! |= masks[0]!;
      total.masks[1]! |= masks[1]!;
      total.masks[2]! &= masks[2]!;
      total.masks[3]! |= masks[3]!;
    }
  }
  for (const [frameIndex, total] of totals.entries()) {
    if (++work % 1024 === 0) { budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted(); }
    if (!total.count) continue;
    const count = channels.length;
    const frame = metadata?.[frameIndex];
    if (frame) {
      const depth = bitDepth(total.masks, bits);
      setMetadata(frame.tags, "Overall", {
        DC_offset: total.sum / (total.count / count), Min_level: total.min, Max_level: total.max,
        Min_difference: total.minDiff, Max_difference: total.maxDiff,
        Mean_difference: total.differences / (total.count - count),
        RMS_difference: Math.sqrt(total.differenceSquares / (total.count - count)),
        Peak_level: db(total.peak), RMS_level: db(Math.sqrt(total.squares / total.count)),
        RMS_peak: db(Math.sqrt(total.maxRms)), RMS_trough: db(Math.sqrt(total.minRms)),
        Flat_factor: db(total.runs / total.peakCount), Peak_count: total.peakCount / count,
        Abs_Peak_count: total.absPeakCount / count, Noise_floor: db(total.noise),
        Noise_floor_count: total.noiseCount / count, Entropy: total.entropy / count,
        Bit_depth: depth[0]!, Bit_depth2: depth[1]!, Bit_depth3: depth[2]!, Bit_depth4: depth[3]!,
        Number_of_samples: total.count / count
      }, overall);
    }
    if (frameIndex !== totals.length - 1) continue;
    report += measurements("Overall", [
      ["DC offset", fixed(total.sum / (total.count / count))], ["Min level", fixed(total.min)], ["Max level", fixed(total.max)],
      ["Min difference", fixed(total.minDiff)], ["Max difference", fixed(total.maxDiff)],
      ["Mean difference", fixed(total.differences / (total.count - count))],
      ["RMS difference", fixed(Math.sqrt(total.differenceSquares / (total.count - count)))],
      ["Peak level dB", db(total.peak)], ["RMS level dB", db(Math.sqrt(total.squares / total.count))],
      ["RMS peak dB", db(Math.sqrt(total.maxRms))],
      ...(total.minRms === 1 ? [] : [["RMS trough dB", db(Math.sqrt(total.minRms))]] as [string, string][]),
      ["Flat factor", db(total.runs / total.peakCount)], ["Peak count", fixed(total.peakCount / count)],
      ["Abs Peak count", fixed(total.absPeakCount / count)], ["Noise floor dB", db(total.noise)],
      ["Noise floor count", fixed(total.noiseCount / count)], ["Entropy", fixed(total.entropy / count)],
      ["Bit depth", bitDepth(total.masks, bits).join("/")], ["Number of samples", total.count / count]
    ], overall);
  }
  return report;
}
