import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function limitAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float64Array[]; delay: number }> {
  const options = { level_in: 1, level_out: 1, limit: 1, attack: 5, release: 50, asc: 0, asc_level: 0.5, level: 1, latency: 0 };
  const ranges = { level_in: [0.015625, 64], level_out: [0.015625, 64], limit: [0.0625, 1], attack: [0.1, 80], release: [1, 8000], asc: [0, 0], asc_level: [0, 1], level: [0, 1], latency: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`alimiter: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const boolean = key === "asc" || key === "level" || key === "latency";
    const number = !boolean ? parseFilterExpression(value, "alimiter", {})
      : ["1", "true", "yes", "on"].includes(value.toLowerCase()) ? 1
      : ["0", "false", "no", "off"].includes(value.toLowerCase()) ? 0 : NaN;
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max!) {
      throw new Error(`alimiter: invalid or unsupported ${key}`);
    }
    options[key] = number;
  }
  const { limit, level_in: inputGain, level_out: outputGain } = options;
  const window = Math.floor(sampleRate * (options.attack / 1000));
  if (window < 1) throw new Error("alimiter: attack is too small for the sample rate");
  const length = channels[0]?.length ?? 0;
  const delay = options.latency ? window - 1 : 0;
  budget.allocateMemory(length * channels.length * 8 + window * 20);
  const output = channels.map(() => new Float64Array(length));
  const peaks = new Float64Array(window);
  const positions = new Int32Array(window).fill(-1);
  const slopes = new Float64Array(window);
  const releaseSamples = sampleRate * options.release / 1000;
  const gain = outputGain * (options.level ? 1 / limit : 1);
  let attenuation = 1;
  let slope = 0;
  let head = 0;
  let count = 0;
  let work = 0;
  // Pending peaks define linear gain ramps over the lookahead window. All
  // channels share the envelope so limiting preserves their relative levels.
  for (let frame = 0; frame < length + delay; frame++) {
    if (++work % 1024 === 0) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
    }
    const slot = frame % window;
    let peak = 0;
    for (const channel of channels) peak = Math.max(peak, Math.abs((channel[frame] ?? 0) * inputGain));
    peaks[slot] = peak;
    if (peak > limit) {
      const target = limit / peak;
      const releaseSlope = (1 - target) / releaseSamples;
      const attackSlope = (target - attenuation) / window;
      if (attackSlope < slope) {
        slope = attackSlope;
        head = 0;
        count = 1;
        positions[0] = slot;
        slopes[0] = releaseSlope;
      } else {
        for (let offset = 0; offset < count; offset++) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          const entry = (head + offset) % window;
          const position = positions[entry]!;
          const distance = (window - position + slot) % window;
          const nextSlope = (target - limit / peaks[position]!) / distance;
          if (nextSlope < slopes[entry]!) {
            slopes[entry] = nextSlope;
            count = offset + 2;
            const next = (entry + 1) % window;
            positions[next] = slot;
            slopes[next] = releaseSlope;
            break;
          }
        }
      }
    }
    const oldest = (slot + 1) % window;
    const source = frame - (window - 1);
    attenuation += slope;
    const destination = frame - delay;
    if (destination >= 0) {
      for (let c = 0; c < channels.length; c++) {
        const sample = (channels[c]![source] ?? 0) * inputGain * attenuation;
        output[c]![destination] = Math.max(-limit, Math.min(limit, sample)) * gain;
      }
    }
    if (count && oldest === positions[head]) {
      slope = slopes[head]!;
      attenuation = limit / peaks[oldest]!;
      count--;
      head = (head + 1) % window;
    }
    if (attenuation > 1) {
      attenuation = 1;
      slope = 0;
      count = 0;
      head = 0;
    }
    if (attenuation <= 0) {
      attenuation = 1e-13;
      slope = (1 - attenuation) / releaseSamples;
    }
    if (1 - attenuation < 1e-13) attenuation = 1;
    if (Math.abs(slope) < 1e-14) slope = 0;
  }
  return { channels: output, delay };
}
