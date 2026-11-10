import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { audioSpeakerMasks, parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function boostSubAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal, channelNames?: readonly string[]
): Promise<Float64Array[]> {
  const options = { dry: 1, wet: 1, boost: 2, decay: 0, feedback: 0.9, cutoff: 100, slope: 0.5, delay: 20 };
  const ranges = { dry: [0, 1], wet: [0, 1], boost: [1, 12], decay: [0, 1], feedback: [0, 1], cutoff: [50, 900], slope: [0.0001, 1], delay: [1, 100] };
  const names = Object.keys(options) as (keyof typeof options)[];
  let selected: string[] | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let optionPosition = 0;
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? [...names, "channels"][optionPosition] : option.slice(0, separator).trim();
    // FFmpeg restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "channels") {
      selected = value === "all" ? undefined : parseAudioChannelLayout(value);
      if (selected?.some(name => !Object.hasOwn(audioSpeakerMasks, name))) throw new Error("asubboost: invalid channels");
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`asubboost: unsupported option ${key}`);
    const numericKey = key as keyof typeof options;
    const number = Number(value);
    const [min, max] = ranges[numericKey];
    if (!value || !Number.isFinite(number) || number < min! || number > max!) throw new Error(`asubboost: invalid ${key}`);
    options[numericKey] = number;
  }
  signal?.throwIfAborted();
  const angle = 2 * Math.PI * options.cutoff / sampleRate;
  const cosine = Math.cos(angle);
  const alpha = Math.sin(angle) / 2 * Math.sqrt(2 * (1 / options.slope - 1) + 2);
  const a0 = 1 + alpha;
  const a1 = 2 * cosine / a0;
  const a2 = -(1 - alpha) / a0;
  const b0 = (1 - cosine) / 2 / a0;
  const b1 = (1 - cosine) / a0;
  const delaySamples = Math.max(1, Math.trunc(sampleRate * options.delay / 1000));
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0) + delaySamples * 8);
  const buffer = new Float64Array(delaySamples);
  const output: Float64Array[] = [];
  let work = 0;
  channelNames ??= channels.length === 1 ? ["FC"] : channels.length === 2 ? ["FL", "FR"] : [];
  for (const [channelIndex, channel] of channels.entries()) {
    const enabled = !selected || selected.includes(channelNames[channelIndex] ?? "");
    buffer.fill(0);
    const samples = new Float64Array(channel.length);
    let position = 0;
    let state0 = 0;
    let state1 = 0;
    let gain = 0;
    for (let i = 0; i < channel.length; i++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const input = channel[i]!;
      if (!enabled) {
        samples[i] = input;
        continue;
      }
      const low = input * b0 + state0;
      state0 = b1 * input + state1 + a1 * low;
      state1 = b0 * input + a2 * low;
      const delayed = buffer[position]! * options.decay + low * options.feedback;
      buffer[position] = delayed;
      // Native asubboost smooths available headroom, with a slow rise and fast fall.
      const headroom = (1 - Math.abs(input * options.dry)) / Math.abs(delayed);
      // Zero headroom and a zero delayed signal must not poison subsequent gain values.
      const boost = Math.min(options.boost, Math.max(0, Number.isNaN(headroom) ? 0 : headroom));
      gain = boost > gain ? gain * 0.99999 + 0.00001 * boost : gain * 0.00001 + 0.99999 * boost;
      gain = Math.min(options.boost, Math.max(0, gain));
      samples[i] = (input * options.dry + gain * delayed) * options.wet;
      if (++position >= delaySamples) position = 0;
    }
    output.push(samples);
  }
  return output;
}
