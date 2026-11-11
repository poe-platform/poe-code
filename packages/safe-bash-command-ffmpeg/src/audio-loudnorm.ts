import type { MediaAudioData, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { createResampleKernel } from "./audio-resample-kernel.js";
import { limitAudio } from "./audio-alimiter.js";

// loudnorm negotiates double precision at 192 kHz. Use the swresample default
// 32-tap Kaiser kernel (beta 9), including the downsampling antialias cutoff.
export async function resampleLoudnorm(
  channels: MediaAudioData["channelData"], from: number, to: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  signal?.throwIfAborted();
  budget.checkCpu();
  const length = channels[0]?.length ?? 0;
  const count = Math.round(length * to / from);
  budget.checkSamples(count);
  budget.allocateMemory(count * channels.length * 8);
  const output = channels.map(() => new Float64Array(count));
  if (!length) return output;
  if (from === to) { for (let c = 0; c < channels.length; c++) output[c]!.set(channels[c]!); return output; }
  const { taps, center, phases, kernels } = createResampleKernel(from, to, budget);
  let work = 0;
  for (let i = 0; i < count; i++) {
    const position = i * from / to;
    const base = Math.floor(position);
    const kernel = kernels[Math.min(phases - 1, Math.round((position - base) * phases))]!;
    for (let c = 0; c < channels.length; c++) {
      let sum = 0;
      for (let j = 0; j < taps; j++) {
        // swresample reflects the initial edge; the flushed tail is reflected too.
        let index = Math.abs(base + j - center);
        if (index >= length) index = Math.max(0, 2 * length - 1 - index);
        sum += channels[c]![index]! * kernel[j]!;
      }
      output[c]![i] = sum;
    }
    if ((work += taps * channels.length) >= 32768) {
      work = 0; await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    }
  }
  return output;
}

const energy = (lu: number) => 10 ** ((lu + 0.691) / 10);
const loudness = (power: number) => -0.691 + 10 * Math.log10(power);
const histogramEnergy = Float64Array.from({ length: 1000 }, (_, i) => energy(i / 10 - 69.95));

// libebur128, used by loudnorm, has 0.1 LU bins (the ebur128 display filter
// instead uses 0.01 LU bins). Keep channel energies separate until weighting.
function meter(rate: number, channels: number) {
  const k = Math.tan(Math.PI * 1681.974450955533 / rate), q = 0.7071752369554196;
  const vh = 10 ** (3.999843853973347 / 20), vb = vh ** 0.4996667741545416;
  const a0 = 1 + k / q + k * k;
  const pb = [(vh + vb * k / q + k * k) / a0, 2 * (k * k - vh) / a0, (vh - vb * k / q + k * k) / a0];
  const pa = [1, 2 * (k * k - 1) / a0, (1 - k / q + k * k) / a0];
  const r = Math.tan(Math.PI * 38.13547087602444 / rate), rq = 0.5003270373238773;
  const ra = [1, 2 * (r * r - 1) / (1 + r / rq + r * r), (1 - r / rq + r * r) / (1 + r / rq + r * r)];
  const a = new Float64Array(5), b = new Float64Array(5);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { a[i + j]! += pa[i]! * ra[j]!; b[i + j]! += pb[i]! * [1, -2, 1][j]!; }
  const states = Array.from({ length: channels }, () => new Float64Array(5));
  const ring = new Float64Array(rate * 3);
  const histogram = new Float64Array(1000), shortHistogram = new Float64Array(1000);
  const interval = rate / 10;
  let frames = 0, momentarySum = 0, shortSum = 0, peak = 0;
  const addBin = (hist: Float64Array, power: number) => {
    if (power >= energy(-70)) hist[Math.min(999, Math.max(0, Math.floor((loudness(power) + 70) * 10)))]!++;
  };
  const mean = (hist: Float64Array, threshold = 0) => {
    let sum = 0, count = 0;
    for (let i = 0; i < hist.length; i++) if (histogramEnergy[i]! >= threshold) { sum += hist[i]! * histogramEnergy[i]!; count += hist[i]!; }
    return count ? sum / count : 0;
  };
  return {
    add(input: MediaAudioData["channelData"], start: number, end: number) {
      for (let i = start; i < end; i++) {
        let power = 0;
        for (let c = 0; c < channels; c++) {
          const x = input[c]![i]!, state = states[c]!;
          peak = Math.max(peak, Math.abs(x));
          state[0] = x - a[1]! * state[1]! - a[2]! * state[2]! - a[3]! * state[3]! - a[4]! * state[4]!;
          const y = b[0]! * state[0]! + b[1]! * state[1]! + b[2]! * state[2]! + b[3]! * state[3]! + b[4]! * state[4]!;
          for (let j = 4; j > 0; j--) state[j] = state[j - 1]!;
          power += y * y;
        }
        const pos = frames % ring.length;
        momentarySum += power - ring[(frames + ring.length - 4 * interval) % ring.length]!;
        shortSum += power - ring[pos]!;
        ring[pos] = power;
        frames++;
        if (frames >= 4 * interval && frames % interval === 0) addBin(histogram, Math.max(0, momentarySum) / (4 * interval));
        if (frames >= ring.length && frames % rate === 0) addBin(shortHistogram, Math.max(0, shortSum) / ring.length);
      }
    },
    read() {
      const threshold = mean(histogram) * 0.1;
      const shortThreshold = mean(shortHistogram) * 0.01;
      let count = 0;
      for (let i = 0; i < 1000; i++) if (histogramEnergy[i]! >= shortThreshold) count += shortHistogram[i]!;
      const lowRank = Math.round((count - 1) * 0.1), highRank = Math.round((count - 1) * 0.95);
      let accumulated = 0, low = -1, high = -1;
      for (let i = 0; i < 1000; i++) if (histogramEnergy[i]! >= shortThreshold) {
        accumulated += shortHistogram[i]!;
        if (low < 0 && accumulated > lowRank) low = i;
        if (high < 0 && accumulated > highRank) high = i;
      }
      return { integrated: loudness(mean(histogram, threshold)), threshold: threshold ? loudness(threshold) : -70,
        short: loudness(Math.max(0, shortSum) / ring.length), range: count ? (high - low) / 10 : 0, peak };
    }
  };
}

export async function normalizeLoudness(
  channels: MediaAudioData["channelData"], rate: number, options: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float64Array[]; report: string }> {
  const targets = { i: -24, tp: -2, lra: 7 };
  const ranges = { i: [-70, -5], tp: [-9, 0], lra: [1, 50] };
  let format = "none";
  for (const option of options ? options.split(":") : []) {
    const [key, value, extra] = option.split("=");
    const name = key!.toLowerCase();
    if (name === "print_format" && ["none", "json", "summary"].includes(value ?? "") && extra === undefined) { format = value!; continue; }
    if (!Object.hasOwn(targets, name)) throw new Error(`loudnorm: unsupported option ${key}`);
    const target = name as keyof typeof targets;
    const number = Number(value);
    if (!value?.trim() || extra !== undefined || !Number.isFinite(number) || number < ranges[target][0]! || number > ranges[target][1]!) throw new Error(`loudnorm: invalid ${key}`);
    targets[target] = number;
  }
  if (channels.length < 1 || channels.length > 2) throw new Error("loudnorm: only mono and stereo are supported");
  const samples = await resampleLoudnorm(channels, rate, 192000, budget, signal);
  const length = samples[0]!.length, block = 19200, window = 576000;
  budget.allocateMemory(2 * (window + 2000 + channels.length * 5) * 8 + length * channels.length * 8);
  const input = meter(192000, channels.length), output = meter(192000, channels.length);
  const normalized = samples.map(() => new Float64Array(length));
  for (let start = 0; start < Math.min(window, length); start += block) {
    input.add(samples, start, Math.min(start + block, length));
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
  }
  const first = input.read();
  const linear = length < window;
  const ceiling = 10 ** (targets.tp / 20);
  // Ungated short clips have -Infinity integrated loudness; their gain is
  // bounded by the true-peak ceiling below. Keep silence at unity gain.
  let gain = (linear ? first.peak > 0 : first.short > -70)
    ? 10 ** ((targets.i - (linear ? first.integrated : first.short)) / 20) : 1;
  if (linear && first.peak) gain = Math.min(gain, ceiling / first.peak);
  const deltas = new Float64Array(30).fill(gain);
  const weights = Float64Array.from({ length: 21 }, (_, i) => Math.exp(-((i - 10) ** 2) / 24.5));
  const sum = weights.reduce((a, b) => a + b, 0);
  const smooth = (index: number) => weights.reduce((total, weight, i) => total + weight * deltas[(index + i + 20) % 30]!, 0) / sum;
  let deltaIndex = 1;
  for (let start = 0; start < length; start += block) {
    let nextGain = gain;
    if (!linear && start > 0 && start + window - block < length) {
      const end = Math.min(length, start + window);
      input.add(samples, start + window - block, end);
      gain = smooth(deltaIndex + 10);
      nextGain = smooth(deltaIndex + 11);
      const current = input.read();
      if (current.short >= current.threshold && current.short > -70) {
        const correction = Math.max(-targets.lra / 2, Math.min(targets.lra / 2, current.short - current.integrated));
        deltas[deltaIndex] = 10 ** ((targets.i - current.short + correction) / 20);
      } else deltas[deltaIndex] = deltas[(deltaIndex + 29) % 30]!;
      deltaIndex = (deltaIndex + 1) % 30;
    }
    const end = Math.min(length, start + block);
    for (let c = 0; c < samples.length; c++) for (let i = start; i < end; i++) normalized[c]![i] = samples[c]![i]! * (gain + (nextGain - gain) * (i - start) / (end - start));
    gain = nextGain;
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
  }
  // Native's final drain is also submitted to the input meter.
  if (!linear) for (let start = Math.max(block, length - window + block); start < length; start += block) {
    input.add(samples, start, Math.min(start + block, length));
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
  }
  const limited = linear ? normalized : (await limitAudio(normalized, 192000,
    `alimiter=limit=${ceiling}:attack=10:release=100:level=0:latency=1`, budget, signal)).channels;
  for (let start = 0; start < length; start += block) {
    output.add(limited, start, Math.min(start + block, length));
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
  }
  const before = input.read(), after = output.read();
  const number = (x: number) => Number.isFinite(x) ? x.toFixed(2) : x < 0 ? "-inf" : "inf";
  const report = {
    input_i: number(before.integrated), input_tp: number(20 * Math.log10(before.peak)), input_lra: number(before.range), input_thresh: number(before.threshold),
    output_i: number(after.integrated), output_tp: number(20 * Math.log10(after.peak)), output_lra: number(after.range), output_thresh: number(after.threshold),
    normalization_type: linear ? "linear" : "dynamic", target_offset: number(targets.i - after.integrated)
  };
  return { channels: limited, report: format === "json" ? `${JSON.stringify(report, null, 2)}\n` : format === "summary"
    ? `Input Integrated: ${report.input_i} LUFS\nInput True Peak: ${report.input_tp} dBTP\nInput LRA: ${report.input_lra} LU\nInput Threshold: ${report.input_thresh} LUFS\nOutput Integrated: ${report.output_i} LUFS\nOutput True Peak: ${report.output_tp} dBTP\nOutput LRA: ${report.output_lra} LU\nOutput Threshold: ${report.output_thresh} LUFS\nNormalization Type: ${report.normalization_type}\nTarget Offset: ${report.target_offset} LU\n` : "" };
}
