import type { MediaBudgetTracker, MediaTrack } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function adaptiveAudio(
  first: MediaTrack, desired: MediaTrack, filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaTrack> {
  const name = filter.split("=", 1)[0]!;
  const defaults: Record<string, number> = { order: 256, mu: 0.75, eps: 1, leakage: 0, out_mode: 2, precision: 0 };
  const options = { ...defaults };
  const bounds: Record<string, readonly [number, number]> = {
    order: [1, 32767], mu: [0, 2], eps: [0, 1], leakage: [0, 1], out_mode: [0, 4], precision: [0, 2]
  };
  let enable: string | undefined;
  const names = Object.keys(options);
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const fields = argument ? argument.split(":") : [];
  for (const [index, option] of fields.entries()) {
    if (!option && index === fields.length - 1) continue;
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(value, `${name} enable`, { n: 0, t: 0, pos: NaN, w: 0, h: 0 });
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`${name}: unsupported option ${key}`);
    const choices = key === "out_mode" ? ["i", "d", "o", "n", "e"] : key === "precision" ? ["auto", "float", "double"] : [];
    const [min, max] = bounds[key]!;
    const numeric = parseFilterExpression(value, name, {
      min, max, default: defaults[key]!,
      ...Object.fromEntries(choices.map((choice, index) => [choice, index]))
    });
    if (!value || !Number.isFinite(numeric) || numeric < min || numeric > max ||
      (["order", "out_mode", "precision"].includes(key) && !Number.isInteger(numeric))) throw new Error(`${name}: invalid ${key}`);
    options[key] = Math.fround(numeric);
  }
  const a = first.decodedAudio;
  const b = desired.decodedAudio;
  if (!a || !b) throw new Error(`${name} requires decoded PCM audio`);
  if (a.sampleRate !== b.sampleRate || a.channels !== b.channels || a.channelMask !== b.channelMask) {
    throw new Error(`${name} requires matching sample rates and channel layouts`);
  }
  const order = options.order!;
  const kernel = Math.ceil(order / 16) * 16;
  const length = Math.min(a.channelData[0]!.length, b.channelData[0]!.length);
  // FFmpeg 7 anlms always negotiates float planar PCM.
  const double = name === "anlmf" && options.precision === 2;
  const round = double ? (value: number) => value : Math.fround;
  const ArrayType = double ? Float64Array : Float32Array;
  budget.checkSamples(length);
  budget.checkDuration(length / a.sampleRate);
  budget.allocateMemory((length * a.channels + 4 * kernel) * ArrayType.BYTES_PER_ELEMENT);
  // Both input consumptions evaluate the internal timeline. The desired input
  // is consumed last, so its timestamp determines bypass for the paired frame.
  let enabled: Uint8Array | undefined;
  if (enable !== undefined) {
    budget.allocateMemory(length + 80);
    enabled = new Uint8Array(length);
    const registers = new Float64Array(10);
    const randomStates: BigUint64Array[] = [];
    const tracks = [first, desired];
    const indices = [0, 0];
    const starts = [0, 0];
    let start = 0;
    let n = 0;
    while (start < length) {
      if (n % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const packets = tracks.map((track, i) => {
        let packet = track.samples[indices[i]!];
        while (packet) {
          const duration = Math.max(0, Math.round(packet.duration * a.sampleRate / track.timescale)
            - (packet.skipSamples ?? 0) - (packet.discardPadding ?? 0));
          if (starts[i]! + duration > start) return { packet, end: starts[i]! + duration };
          starts[i]! += duration;
          indices[i]!++;
          packet = track.samples[indices[i]!];
        }
        return undefined;
      });
      const end = Math.min(length, ...packets.map(packet => packet?.end ?? length));
      let active = true;
      for (const [i, track] of tracks.entries()) {
        const packet = packets[i]?.packet;
        const pts = packet ? Math.round(packet.pts * a.sampleRate / track.timescale)
          + (packet.skipSamples ?? 0) + start - starts[i]! : start;
        active = Math.abs(parseFilterExpression(enable, `${name} enable`, {
          n, t: pts / a.sampleRate, pos: NaN, w: 0, h: 0
        }, undefined, registers, randomStates)) >= 0.5;
      }
      enabled.fill(Number(active), start, end);
      start = end;
      n++;
    }
  }
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
      let gain = round(round(options.mu! * error) / round(options.eps! + power));
      if (name === "anlmf") gain = round(gain * round(error * error));
      for (let tap = 0; tap < order; tap++) {
        coeffs[tap] = round(round(coeffs[tap]! * leakage) + round(delay[offset + tap]! * gain));
      }
      coeffs.copyWithin(order, 0, order);
      offset = offset === 0 ? order - 1 : offset - 1;
      channelData[channel]![sample] = (enabled && !enabled[sample]) || options.out_mode === 0 ? input : options.out_mode === 1 ? target
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
