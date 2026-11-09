import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function phaseAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  codec: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { in_gain: 0.4, out_gain: 0.74, delay: 3, decay: 0.4, speed: 0.5, type: 1 };
  const ranges = { in_gain: [0, 1], out_gain: [0, 1e9], delay: [0, 5], decay: [0, 0.99], speed: [0.1, 2], type: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`aphaser: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = key === "type" && ["t", "triangular"].includes(value) ? 1
      : key === "type" && ["s", "sinusoidal"].includes(value) ? 0 : Number(value);
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max! || key === "type" && !Number.isInteger(number)) {
      throw new Error(`aphaser: invalid ${key}`);
    }
    options[key] = number;
  }
  const delayLength = Math.round(options.delay * 0.001 * sampleRate);
  if (delayLength < 1) throw new Error("aphaser: delay is too small");
  const period = Math.round(sampleRate / options.speed);
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory((length + delayLength) * channels.length * 8);
  const output = channels.map(() => new Float64Array(length));
  const history = channels.map(() => new Float64Array(delayLength));
  // Native aphaser negotiates unsigned 8-bit input to signed 16-bit samples.
  const scale = codec === "pcm_u8" || codec === "pcm_s16le" ? 32768 : codec === "pcm_s32le" ? 2147483648 : 1;
  let position = 0;
  let work = 0;
  for (let frame = 0; frame < length; frame++) {
    // Evaluate the periodic modulation directly instead of allocating a full wave table.
    const point = (frame + Math.round(period / 4)) % period;
    const fraction = point / period;
    const wave = options.type === 0 ? (Math.sin(fraction * 2 * Math.PI) + 1) / 2
      : fraction < 0.25 ? fraction * 2 + 0.5 : fraction < 0.75 ? 1.5 - fraction * 2 : fraction * 2 - 1.5;
    const offset = Math.round(1 + wave * (delayLength - 1));
    const read = (position + offset) % delayLength;
    position = (position + 1) % delayLength;
    for (let channel = 0; channel < channels.length; channel++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const value = channels[channel]![frame]! * scale * options.in_gain + history[channel]![read]! * options.decay;
      history[channel]![position] = value;
      const sample = value * options.out_gain;
      // Native integer phasers truncate and retain the sample format between filters.
      // x86 int32 conversion produces INT32_MIN on overflow rather than wrapping.
      output[channel]![frame] = scale === 32768 ? ((Math.trunc(sample) << 16) >> 16) / scale
        : scale === 2147483648 ? (Math.trunc(sample) < -2147483648 || Math.trunc(sample) > 2147483647 ? -2147483648 : Math.trunc(sample)) / scale
        : codec === "pcm_f32le" ? Math.fround(sample) : sample;
    }
  }
  return output;
}
