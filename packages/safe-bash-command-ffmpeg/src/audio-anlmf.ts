import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function anlmfAudio(
  first: MediaTrack, desired: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const options: Record<string, number> = { order: 256, mu: 0.75, eps: 1, leakage: 0, out_mode: 2, precision: 0 };
  const bounds: Record<string, readonly [number, number]> = {
    order: [1, 32767], mu: [0, 2], eps: [0, 1], leakage: [0, 1], out_mode: [0, 4], precision: [0, 2]
  };
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (!key || !Object.hasOwn(options, key)) throw new Error(`anlmf: unsupported option ${key}`);
    const choices = key === "out_mode" ? ["i", "d", "o", "n", "e"] : key === "precision" ? ["auto", "float", "double"] : [];
    const numeric = choices.includes(value) ? choices.indexOf(value) : parseFilterExpression(value, "anlmf", {});
    const [min, max] = bounds[key]!;
    if (!value || !Number.isFinite(numeric) || numeric < min || numeric > max ||
      (["order", "out_mode", "precision"].includes(key) && !Number.isInteger(numeric))) throw new Error(`anlmf: invalid ${key}`);
    options[key] = Math.fround(numeric);
  }
  const a = first.decodedAudio;
  const b = desired.decodedAudio;
  if (!a || !b) throw new Error("anlmf requires decoded PCM audio");
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error("anlmf requires matching sample rates and channel layouts");
  }
  const order = options.order!;
  const kernel = Math.ceil(order / 16) * 16;
  const length = Math.min(a.channelData[0]!.length, b.channelData[0]!.length);
  const double = options.precision === 2;
  const round = double ? (value: number) => value : Math.fround;
  const ArrayType = double ? Float64Array : Float32Array;
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory((length * a.channels + 4 * kernel) * ArrayType.BYTES_PER_ELEMENT);
  const channelData = a.channelData.map(() => new ArrayType(length));
  const delay = new ArrayType(2 * kernel);
  const coeffs = new ArrayType(2 * kernel);
  const leakage = round(1 - options.leakage!);
  let work = 0;
  for (let channel = 0; channel < a.channels; channel++) {
    delay.fill(0);
    coeffs.fill(0);
    let offset = 0;
    for (let sample = 0; sample < length; sample++) {
      const input = round(a.channelData[channel]![sample]!);
      const target = round(b.channelData[channel]![sample]!);
      delay[offset] = delay[offset + order] = input;
      let filtered = 0;
      let power = 0;
      // Native's normalization includes the padded delay window, including its
      // duplicated history when the order is smaller than the SIMD alignment.
      for (let tap = 0; tap < kernel; tap++) {
        if (work++ % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        if (tap < order) filtered = round(filtered + round(delay[tap]! * coeffs[order - offset + tap]!));
        power = round(power + round(delay[tap]! * delay[tap]!));
      }
      const error = round(target - filtered);
      const gain = round(round(round(options.mu! * error) / round(options.eps! + power)) * round(error * error));
      for (let tap = 0; tap < order; tap++) {
        coeffs[tap] = round(round(coeffs[tap]! * leakage) + round(delay[offset + tap]! * gain));
      }
      coeffs.copyWithin(order, 0, order);
      offset = offset === 0 ? order - 1 : offset - 1;
      channelData[channel]![sample] = options.out_mode === 0 ? input : options.out_mode === 1 ? target
        : options.out_mode === 2 ? error : options.out_mode === 3 ? round(input - filtered) : filtered;
    }
  }
  const samples: MediaTrack["samples"][number][] = [];
  let start = 0;
  for (const packet of first.samples) {
    if (start >= length) break;
    budget.checkCpu();
    const duration = Math.min(length - start, Math.max(0, Math.round(packet.duration * a.sampleRate / first.timescale)
      - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0)));
    const pts = Math.round(packet.pts * a.sampleRate / first.timescale) + (packet.skipSamples ?? 0);
    budget.allocateMemory(96);
    samples.push({ data: new Uint8Array(0), size: 0, pts, dts: pts, cts: 0,
      duration, isKeyframe: true, sampleDescriptionIndex: 1 });
    start += duration;
  }
  return { ...first, timescale: a.sampleRate, duration: length, samples, editList: undefined,
    decodedAudio: { ...a, channelData } };
}
