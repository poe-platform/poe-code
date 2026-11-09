import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function cutSubAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  codec: string | undefined, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { cutoff: 20, order: 10, level: 1 };
  const ranges = { cutoff: [2, 200], order: [3, 20], level: [0, 1] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options;
    if (!key || !Object.hasOwn(options, key)) throw new Error(`asubcut: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = Number(value);
    const [min, max] = ranges[key];
    if (!value || !Number.isFinite(number) || number < min! || number > max!) throw new Error(`asubcut: invalid ${key}`);
    options[key] = key === "order" ? Math.round(number) : number;
  }
  signal?.throwIfAborted();
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => Float64Array.from(channel));
  if (options.cutoff >= sampleRate / 2) return output;

  // Butterworth high-pass sections, with a first-order section for odd orders.
  // Native PCM16 negotiation uses planar float, including float coefficients/state.
  const round = codec === "pcm_f64le" ? (value: number) => value : Math.fround;
  const k = Math.tan(Math.PI * options.cutoff / sampleRate);
  const sections: number[][] = [];
  if (options.order % 2) {
    const omega = 2 * k;
    const b0 = 2 / (2 + omega);
    sections.push([b0, -b0, 0, -(omega - 2) / (2 + omega), 0]);
  }
  for (let i = 0; i < Math.floor(options.order / 2); i++) {
    const q = 1 / (-2 * Math.cos(Math.PI * (2 * (i + 1) + options.order - 1) / (2 * options.order)));
    const norm = 1 / (1 + k / q + k * k);
    sections.push([norm, -2 * norm, norm, -2 * (k * k - 1) * norm, -(1 - k / q + k * k) * norm]);
  }
  let work = 0;
  for (const samples of output) {
    for (const [section, coefficients] of sections.entries()) {
      const [b0, b1, b2, a1, a2] = coefficients.map(round);
      let state0 = 0;
      let state1 = 0;
      for (let i = 0; i < samples.length; i++) {
        if (++work % 1024 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const input = section === 0 ? round(round(samples[i]!) * options.level) : samples[i]!;
        const value = round(round(input * b0!) + state0);
        state0 = round(round(round(b1! * input) + state1) + round(a1! * value));
        state1 = round(round(b2! * input) + round(a2! * value));
        samples[i] = value;
      }
    }
  }
  return output;
}
