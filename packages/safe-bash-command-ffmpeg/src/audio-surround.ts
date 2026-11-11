import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { transform } from "./audio-fft.js";
import { parseFilterExpression } from "./filter-expression.js";
import { parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function surroundAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float32Array[]; frameSize: number }> {
  let size = 4096, lfe = true;
  let outputChannels = 6;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["chl_out", "chl_in", "level_in", "level_out", "lfe"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "chl_out") {
      const layout = parseAudioChannelLayout(value).join("+");
      if (layout !== "FL+FR" && layout !== "FL+FR+FC+LFE+BL+BR") throw new Error("surround: supported output layouts are stereo and 5.1");
      outputChannels = layout === "FL+FR" ? 2 : 6;
    } else if (key === "chl_in") {
      if (parseAudioChannelLayout(value).join("+") !== "FL+FR") throw new Error("surround: supported input layout is stereo");
    } else if (key === "win_size") {
      const number = parseFilterExpression(value, "surround", { min: 1024, max: 65536, default: 4096 });
      if (!Number.isFinite(number) || number < 1024 || number > 65536) {
        throw new RangeError("surround: win_size must be between 1024 and 65536");
      }
      // Integer AVOptions validate the range before rounding, with ties to even.
      size = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "lfe") {
      const boolean = value.toLowerCase();
      if (["1", "true", "yes", "on", "y", "enabled"].includes(boolean)) lfe = true;
      else if (["0", "false", "no", "off", "n", "disabled"].includes(boolean)) lfe = false;
      else throw new Error("surround: invalid lfe");
    } else throw new Error(`surround: unsupported option ${key}`);
  }
  if (size % 4 !== 0) throw new Error("surround: unsupported transform size");
  if (channels.length !== 2) throw new Error("surround: stereo input required");
  const length = channels[0]!.length, hop = size / 2;
  const scratchLength = (size & (size - 1)) === 0 ? 0 : 4 * 2 ** Math.ceil(Math.log2(2 * size - 1));
  // Output and overlap planes for each channel, two complex input transforms,
  // one complex inverse workspace, and the analysis/synthesis window.
  budget.allocateMemory(length * outputChannels * 4 + size * (outputChannels * 4 + 6 * 8 + 4) + scratchLength * 8);
  const scratch = scratchLength ? new Float64Array(scratchLength) : undefined;
  const output = Array.from({ length: outputChannels }, () => new Float32Array(length));
  const overlap = Array.from({ length: outputChannels }, () => new Float32Array(size));
  const real = channels.map(() => new Float64Array(size));
  const imaginary = channels.map(() => new Float64Array(size));
  const outReal = new Float64Array(size), outImaginary = new Float64Array(size);
  // FFmpeg uses float spectra, a square-root Hann window and 50% overlap.
  const f = Math.fround, pi = f(Math.PI), halfPi = f(Math.PI / 2);
  const window = Float32Array.from({ length: size }, (_, i) => Math.sqrt(f(0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)))) / size));
  let max = 0;
  for (let i = 0; i < hop; i++) max = Math.max(max, f(window[i]! + window[i + hop]!));
  const gain = f(1 / f(max * f(Math.sqrt(size))));
  const low = f(128 * size / sampleRate), high = f(256 * size / sampleRate);
  for (let start = 0; start < length; start += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < size; i++) real[c]![i] = f(f(channels[c]![start - hop + i] ?? 0) * window[i]!);
      imaginary[c]!.fill(0);
      transform(real[c]!, imaginary[c]!, false, scratch);
    }
    for (let c = 0; c < outputChannels; c++) {
      for (let n = 0; n <= hop; n++) {
        const lr = f(real[0]![n]!), li = f(imaginary[0]![n]!);
        const rr = f(real[1]![n]!), ri = f(imaginary[1]![n]!);
        const lm = f(Math.hypot(lr, li)), rm = f(Math.hypot(rr, ri));
        const lp = f(Math.atan2(li, lr)), rp = f(Math.atan2(ri, rr));
        const centerPhase = f(Math.atan2(f(li + ri), f(lr + rr)));
        let phase = Math.abs(f(lp - rp));
        if (phase > pi) phase = f(2 * pi - phase);
        const sum = f(lm + rm), center = f(sum * 0.5);
        const difference = f(f(lm - rm) / (sum < 1e-8 ? 1 : sum));
        const widening = Math.max(0, f(f(phase * phase) - halfPi));
        const x = Math.max(-1, Math.min(1, f(difference + f(difference * widening))));
        const balanceCosine = f(Math.cos(f(f(difference * halfPi) + pi)));
        const phaseCosine = f(Math.cos(f(halfPi - f(phase / pi))));
        const y = Math.max(-1, Math.min(1, f(f(f(balanceCosine * phaseCosine) * f(Math.LN10)) + 1)));
        const front = f(f(y + 1) * 0.5);
        const horizontal = c === 2 ? f(1 - Math.abs(x)) : f(0.5 * f((c === 0 || c === 4 ? x : -x) + 1));
        const vertical = c < 3 ? front : f(1 - front);
        const factor = c === 3 ? 1 : f(f(Math.sqrt(horizontal)) * f(Math.sqrt(vertical)));
        const lowpass = !lfe || n >= high ? 0 : n < low ? 1
          : f(0.5 * f(1 + f(Math.cos(f(f(pi * f(low - n)) / f(low - high))))));
        const magnitude = f((c === 3 ? f(lowpass * center) : c === 2 ? center : f(Math.hypot(lm, rm))) * factor);
        const phaseOut = c === 2 || c === 3 ? centerPhase : c === 0 || c === 4 ? lp : rp;
        outReal[n] = f(magnitude * f(Math.cos(phaseOut)));
        outImaginary[n] = n === 0 || n === hop ? 0 : f(magnitude * f(Math.sin(phaseOut)));
        if (n > 0 && n < hop) {
          outReal[size - n] = outReal[n]!;
          outImaginary[size - n] = -outImaginary[n]!;
        }
      }
      transform(outReal, outImaginary, true, scratch);
      const buffer = overlap[c]!;
      buffer.copyWithin(0, hop); buffer.fill(0, hop);
      for (let i = 0; i < size; i++) buffer[i] = f(buffer[i]! + f(f(f(outReal[i]!) * window[i]!) * gain));
      output[c]!.set(buffer.subarray(0, Math.min(hop, length - start)), start);
    }
  }
  return { channels: output, frameSize: hop };
}
