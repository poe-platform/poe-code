import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

/*
 * Algorithm adapted from FFmpeg af_deesser.c, Copyright (c) 2018 Chris Johnson.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
export async function deessAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const options = { i: 0, m: 0.5, f: 0.5, s: 1 };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["i", "m", "f", "s"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "threads" || key === "extra_hw_frames") {
      const min = key === "threads" ? 0 : -1;
      const number = parseFilterExpression(value, "deesser", { min, max: 2147483647, default: min });
      if (!Number.isFinite(number) || number < min || number > 2147483647) throw new Error(`deesser: invalid ${key}`);
      // Scheduling and hardware-frame settings do not change the rendered audio.
      continue;
    }
    if (key !== "i" && key !== "m" && key !== "f" && key !== "s") throw new Error(`deesser: unsupported option ${key}`);
    const number = key === "s" && ["i", "o", "e"].includes(value) ? ["i", "o", "e"].indexOf(value) : Number(value);
    if (!value || !Number.isFinite(number) || number < 0 || number > (key === "s" ? 2 : 1)
      || (key === "s" && !Number.isInteger(number))) throw new Error(`deesser: invalid ${key}`);
    options[key] = number;
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  const scale = sampleRate < 44100 ? 44100 / sampleRate : sampleRate / 44100;
  const intensity = Math.pow(options.i, 5) * (8192 / scale);
  const maxDeessing = 1 / Math.pow(10, (options.m - 1) * 48 / 20);
  const iirAmount = options.f * options.f / scale;
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    let previous = 0;
    let older = 0;
    const ratios = [1, 1];
    const lowpass = [0, 0];
    for (let i = 0; i < channel.length; i++) {
      if (work++ % 4096 === 0) {
        await yieldTurn(signal);
        signal?.throwIfAborted();
        budget.checkCpu();
      }
      const input = channel[i]!;
      const delta = input - previous;
      const m1 = delta * (delta / 1.3);
      const m2 = (previous - older) * (delta / 1.3);
      older = previous;
      previous = input;
      let sense = (m1 - m2) * ((m1 - m2) / 1.3);
      const attack = 7 + sense * 1024;
      sense = Math.min(1 + intensity * intensity * sense, intensity);
      const recovery = 1 + 0.01 / sense;
      const offset = (1 - Math.abs(input)) * iirAmount;
      const slot = i % 2;
      lowpass[slot] = lowpass[slot]! * (1 - offset) + input * offset;
      const ratio = ratios[slot]!;
      ratios[slot] = Math.min(ratio < sense ? (ratio * attack + sense) / (attack + 1) : 1 + (ratio - 1) / recovery, maxDeessing);
      const processed = lowpass[slot]! + (input - lowpass[slot]!) / ratios[slot]!;
      output[c]![i] = options.s === 0 ? input : options.s === 1 ? processed : input - processed;
    }
  }
  return output;
}
