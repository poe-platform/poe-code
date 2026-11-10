import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { parseFilterFloat } from "./filter-float.js";

export async function chorusAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { in_gain: "0.4", out_gain: "0.4", delays: "", decays: "", speeds: "", depths: "" };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let position = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[position] : option.slice(0, separator).trim() as keyof typeof options;
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`chorus: unsupported option ${key}`);
    options[key] = separator < 0 ? option : option.slice(separator + 1);
  }
  const gains = [options.in_gain, options.out_gain].map(value => {
    const gain = parseFilterExpression(value, "chorus", { default: 0.4, min: 0, max: 1 });
    if (!Number.isFinite(gain) || gain < 0 || gain > 1) throw new Error("chorus: invalid gain");
    return Math.fround(gain);
  });
  const [delays, decays, speeds, depths] = [options.delays, options.decays, options.speeds, options.depths].map(value =>
    value.split("|").map(part => Math.fround(parseFilterFloat(part))).filter(value => !Number.isNaN(value)));
  if (!delays!.length || [decays, speeds, depths].some(list => list!.length !== delays!.length)) {
    throw new Error("chorus: delays, decays, speeds and depths must have matching entries");
  }
  budget.allocateMemory(delays!.length * 32);
  let tail = 0;
  const voices = delays!.map((delay, index) => {
    const decay = decays![index]!, speed = speeds![index]!, depth = depths![index]!;
    if (![delay, decay, speed, depth].every(Number.isFinite) || delay < 0 || depth < 0 || speed <= 0) {
      throw new Error("chorus: invalid voice");
    }
    const samples = Math.trunc(Math.fround(Math.fround(delay + depth) * sampleRate) / 1000);
    const depthSamples = Math.trunc(Math.fround(depth * sampleRate) / 1000);
    const period = Math.trunc(Math.fround(sampleRate / speed));
    if (samples < 1 || samples > 2147483647 || period < 1 || period > 2147483647) {
      throw new Error("chorus: delay or speed is out of range");
    }
    tail = Math.max(tail, samples);
    return { decay, depthSamples, period };
  });
  const length = (channels[0]?.length ?? 0) + tail;
  budget.checkSamples(length);
  budget.checkDuration(length / sampleRate);
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  let work = 0;
  for (let frame = 0; frame < length; frame++) {
    for (let channel = 0; channel < channels.length; channel++) {
      const input = channels[channel]!;
      let sample = Math.fround(Math.fround(input[frame] ?? 0) * gains[0]!);
      for (const voice of voices) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        // Native chorus uses depth for its sinusoidal tap; delay only sizes the
        // history and EOF tail. A zero tap reads the oldest slot before writing.
        const offset = Math.floor((Math.sin((frame % voice.period) / voice.period * 2 * Math.PI) + 1) / 2 * voice.depthSamples + 0.5);
        const delayed = Math.fround(input[frame - (offset || tail)] ?? 0);
        sample = Math.fround(sample + Math.fround(delayed * voice.decay));
      }
      output[channel]![frame] = Math.fround(sample * gains[1]!);
    }
  }
  return output;
}
