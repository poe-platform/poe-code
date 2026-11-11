import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { audioSpeakerMasks, parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function highpassAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal, channelNames?: readonly string[]
): Promise<(Float32Array | Float64Array)[]> {
  let selected: string[] | undefined;
  const options = { frequency: 3000, poles: 2, mix: 1 };
  const aliases: Record<string, keyof typeof options> = {
    frequency: "frequency", f: "frequency", poles: "poles", p: "poles", mix: "mix", m: "mix"
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const name = separator < 0 && index === 0 ? "frequency" : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (name === "c" || name === "channels") {
      selected = value === "all" ? undefined : parseAudioChannelLayout(value);
      if (selected?.some(channel => !Object.hasOwn(audioSpeakerMasks, channel))) {
        throw new Error("highpass: invalid channels");
      }
      continue;
    }
    const key = Object.hasOwn(aliases, name) ? aliases[name] : undefined;
    if (!key) throw new Error(`highpass: unsupported option ${name}`);
    const number = Number(value);
    if (!value || !Number.isFinite(number)
      || key === "frequency" && (number < 0 || number > 999999)
      || key === "poles" && number !== 1 && number !== 2
      || key === "mix" && (number < 0 || number > 1)) throw new Error(`highpass: invalid ${key}`);
    options[key] = number;
  }
  signal?.throwIfAborted();
  budget.checkCpu();
  // Native FFmpeg bypasses an out-of-band cutoff when configuring the filter.
  if (options.mix === 0 || options.frequency === 0 || options.frequency > sampleRate / 2) return [...channels];
  const angle = 2 * Math.PI * options.frequency / sampleRate;
  const alpha = Math.sin(angle) / (2 * 0.707);
  const a0 = options.poles === 1 ? 1 : 1 + alpha;
  const a1 = options.poles === 1 ? -Math.exp(-angle) : -2 * Math.cos(angle) / a0;
  const a2 = options.poles === 1 ? 0 : (1 - alpha) / a0;
  const b0 = options.poles === 1 ? (1 - a1) / 2 : (1 + Math.cos(angle)) / (2 * a0);
  const b1 = options.poles === 1 ? -b0 : -2 * b0;
  const b2 = options.poles === 1 ? 0 : b0;
  const output: (Float32Array | Float64Array)[] = [];
  channelNames ??= channels.length === 1 ? ["FC"] : channels.length === 2 ? ["FL", "FR"] : [];
  let work = 0;
  for (const [index, channel] of channels.entries()) {
    if (selected && !selected.includes(channelNames[index] ?? "")) {
      output.push(channel);
      continue;
    }
    budget.allocateMemory(channel.length * 8);
    const samples = new Float64Array(channel.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < channel.length; i++) {
      if (++work % 1024 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const input = channel[i]!;
      const filtered = b0 * input + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      x2 = x1; x1 = input;
      y2 = y1; y1 = filtered;
      samples[i] = filtered * options.mix + input * (1 - options.mix);
    }
    output.push(samples);
  }
  return output;
}
