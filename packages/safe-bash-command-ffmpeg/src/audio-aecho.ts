import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function echoAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  codec: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { in_gain: "0.6", out_gain: "0.3", delays: "1000", decays: "0.5" };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let position = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[position] : option.slice(0, separator).trim() as keyof typeof options;
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`aecho: unsupported option ${key}`);
    options[key] = separator < 0 ? option : option.slice(separator + 1);
  }
  const gains = [options.in_gain, options.out_gain].map(value => {
    const gain = parseFilterExpression(value, "aecho", {});
    if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error("aecho: invalid gain");
    return Math.fround(gain);
  });
  // Native list options read numeric prefixes and skip nonnumeric/empty entries.
  const [delays, decays] = [options.delays, options.decays].map(value =>
    value.split("|").map(part => Math.fround(parseListFloat(part))).filter(value => !Number.isNaN(value)));
  if (!delays!.length || delays!.length !== decays!.length) throw new Error("aecho: delays and decays must have matching entries");
  budget.allocateMemory(delays!.length * 16);
  let tail = 0;
  const offsets = delays!.map((delay, index) => {
    const decay = decays![index]!;
    if (!Number.isFinite(delay) || delay <= 0 || delay > 90000 || !Number.isFinite(decay) || decay <= 0 || decay > 1) {
      throw new Error("aecho: delay or decay is out of range");
    }
    const samples = Math.trunc(Math.fround(delay * sampleRate) / 1000);
    tail = Math.max(tail, samples);
    return samples;
  });
  if (tail < 1) throw new Error("aecho: delay is too small");
  const length = (channels[0]?.length ?? 0) + tail;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  const scale = codec === "pcm_s16le" ? 32768 : codec === "pcm_s32le" ? 2147483648 : 1;
  let work = 0;
  for (const [channel, input] of channels.entries()) {
    for (let frame = 0; frame < length; frame++) {
      let sample = (input[frame] ?? 0) * scale * gains[0]!;
      for (const [tap, offset] of offsets.entries()) {
        if (++work % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        // A sub-sample tap reads the oldest entry in native's delay ring.
        const delayed = (input[frame - (offset || tail)] ?? 0) * scale * decays![tap]!;
        sample += codec === "pcm_f64le" ? delayed : Math.fround(delayed);
      }
      sample = Math.max(-scale, Math.min(scale === 1 ? 1 : scale - 1, sample * gains[1]!));
      output[channel]![frame] = scale !== 1 ? Math.trunc(sample) / scale
        : codec === "pcm_f64le" ? sample : Math.fround(sample);
    }
  }
  return output;
}

function parseListFloat(source: string): number {
  const text = source.trimStart().toLowerCase();
  const signed = text[0] === "+" || text[0] === "-";
  let offset = signed ? 1 : 0;
  if (!text.startsWith("0x", offset)) return Number.parseFloat(source);
  offset += 2;
  let value = 0;
  let digits = 0;
  let fractionDigits = 0;
  let fraction = false;
  for (; offset < text.length; offset++) {
    const digit = "0123456789abcdef".indexOf(text[offset]!);
    if (digit >= 0) {
      value = value * 16 + digit;
      digits++;
      if (fraction) fractionDigits++;
    } else if (text[offset] === "." && !fraction) fraction = true;
    else break;
  }
  if (!digits) return NaN;
  value /= 16 ** fractionDigits;
  if (text[offset] === "p") {
    const exponent = Number.parseInt(text.slice(offset + 1), 10);
    if (!Number.isNaN(exponent)) value *= 2 ** exponent;
  }
  return text[0] === "-" ? -value : value;
}
