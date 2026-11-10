import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterFloat } from "./filter-float.js";

export async function echoAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  sampleFormat: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  warn?: (message: string) => Promise<void>
): Promise<Float64Array[]> {
  const options = { in_gain: "0.6", out_gain: "0.3", delays: "1000", decays: "0.5" };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  let position = 0;
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[position] : option.slice(0, separator).trim() as keyof typeof options;
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`aecho: unsupported option ${key}`);
    options[key] = separator < 0 ? option : option.slice(separator + 1);
  }
  const gains = [options.in_gain, options.out_gain].map((value, index) => {
    const gain = parseFilterExpression(value, "aecho", { min: 0, max: 1, default: index === 0 ? 0.6 : 0.3 });
    if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error("aecho: invalid gain");
    return Math.fround(gain);
  });
  // Native list options count NaN prefixes but skip nonnumeric/empty entries.
  const [delays, decays] = [options.delays, options.decays].map(value =>
    value.split("|").flatMap(part => {
      const parsed = Math.fround(parseFilterFloat(part));
      const text = part.trimStart().toLowerCase();
      const offset = text[0] === "+" || text[0] === "-" ? 1 : 0;
      return !Number.isNaN(parsed) || text.startsWith("nan", offset) ? [parsed] : [];
    }));
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
  const volume = decays!.reduce((sum, decay) => Math.fround(sum + decay), 1);
  if (Math.fround(Math.fround(volume * gains[0]!) * gains[1]!) > 1) {
    await warn?.(`[aecho] out_gain ${gains[1]!.toFixed(6)} can cause saturation of output\n`);
  }
  const length = (channels[0]?.length ?? 0) + tail;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  const scale = sampleFormat === "s16" || sampleFormat === "s16p" ? 32768 : sampleFormat === "s32" || sampleFormat === "s32p" ? 2147483648 : 1;
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
        const delayed = (input[frame - (offset || tail)] ?? 0) * scale;
        // C converts integer samples to float before multiplying by the decay.
        sample += (sampleFormat === "dbl" || sampleFormat === "dblp") ? delayed * decays![tap]!
          : Math.fround(Math.fround(delayed) * decays![tap]!);
      }
      sample = Math.max(-scale, Math.min(scale === 1 ? 1 : scale - 1, sample * gains[1]!));
      output[channel]![frame] = scale !== 1 ? Math.trunc(sample) / scale
        : (sampleFormat === "dbl" || sampleFormat === "dblp") ? sample : Math.fround(sample);
    }
  }
  return output;
}
