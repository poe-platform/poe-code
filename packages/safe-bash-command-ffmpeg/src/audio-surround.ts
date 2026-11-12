import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { dialogueSpectrum, inverseRealSpectrum } from "./audio-dialogue-fft.js";
import { phaseAngle } from "./audio-float-phase.js";
import { transform } from "./audio-fft.js";
import { parseFilterExpression } from "./filter-expression.js";
import { parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function surroundAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ channels: Float32Array[]; frameSize: number }> {
  let size = 4096, lfe = true;
  let windowOverlap = 0.5;
  let lfeLow = 128, lfeHigh = 256;
  let outputChannels = 6;
  const outputLevels = { fl_out: 1, fr_out: 1, fc_out: 1, lfe_out: 1, bl_out: 1, br_out: 1 };
  const spread = {
    flx: 0.5, frx: 0.5, fcx: 0.5, blx: 0.5, brx: 0.5, slx: 0.5, srx: 0.5, bcx: 0.5,
    fly: 0.5, fry: 0.5, fcy: 0.5, bly: 0.5, bry: 0.5, sly: 0.5, sry: 0.5, bcy: 0.5,
    allx: -1, ally: -1
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["chl_out", "chl_in", "level_in", "level_out", "lfe", "lfe_low", "lfe_high"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "chl_out") {
      const layout = parseAudioChannelLayout(value).join("+");
      if (layout !== "FL+FR" && layout !== "FL+FR+FC+LFE+BL+BR") throw new Error("surround: supported output layouts are stereo and 5.1");
      outputChannels = layout === "FL+FR" ? 2 : 6;
    } else if (key === "chl_in") {
      if (parseAudioChannelLayout(value).join("+") !== "FL+FR") throw new Error("surround: supported input layout is stereo");
    } else if (key === "level_in" || key === "level_out") {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 10, default: 1 });
      if (!Number.isFinite(number) || number < 0 || number > 10) {
        throw new RangeError(`surround: ${key} must be between 0 and 10`);
      }
      // FFmpeg 7.0.2 overwrites these global levels with per-channel defaults.
    } else if (key !== undefined && Object.hasOwn(outputLevels, key)) {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 10, default: 1 });
      if (!Number.isFinite(number) || number < 0 || number > 10) {
        throw new RangeError(`surround: ${key} must be between 0 and 10`);
      }
      outputLevels[key as keyof typeof outputLevels] = Math.fround(number);
    } else if (key !== undefined && Object.hasOwn(spread, key)) {
      const global = key === "allx" || key === "ally";
      const min = global ? -1 : 0.06;
      const number = parseFilterExpression(value, "surround", { min, max: 15, default: global ? -1 : 0.5 });
      if (!Number.isFinite(number) || number < min || number > 15) {
        throw new RangeError(`surround: ${key} must be between ${min} and 15`);
      }
      spread[key as keyof typeof spread] = Math.fround(number);
    } else if (key === "win_size" || key === "lfe_low" || key === "lfe_high") {
      const min = key === "win_size" ? 1024 : 0;
      const max = key === "win_size" ? 65536 : key === "lfe_low" ? 256 : 512;
      const number = parseFilterExpression(value, "surround", {
        min, max, default: key === "win_size" ? 4096 : key === "lfe_low" ? 128 : 256
      });
      if (!Number.isFinite(number) || number < min || number > max) {
        throw new RangeError(`surround: ${key} must be between ${min} and ${max}`);
      }
      // Integer AVOptions validate the range before rounding, with ties to even.
      const rounded = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
      if (key === "win_size") size = rounded;
      else if (key === "lfe_low") lfeLow = rounded;
      else lfeHigh = rounded;
    } else if (key === "lfe") {
      const boolean = value.toLowerCase();
      if (["1", "true", "yes", "on", "y", "enabled"].includes(boolean)) lfe = true;
      else if (["0", "false", "no", "off", "n", "disabled"].includes(boolean)) lfe = false;
      else throw new Error("surround: invalid lfe");
    } else throw new Error(`surround: unsupported option ${key}`);
  }
  if (lfeLow >= lfeHigh) throw new Error(`surround: low cutoff ${lfeLow} must be less than high cutoff ${lfeHigh}`);
  if (size % 4 !== 0) throw new Error("surround: unsupported transform size");
  if (channels.length !== 2) throw new Error("surround: stereo input required");
  // Global spreads override speaker options regardless of argument order.
  // LFE has zero exponents by default and only global options change them.
  const spreadX = [spread.flx, spread.frx, spread.fcx, 0, spread.blx, spread.brx]
    .map(value => spread.allx >= 0 ? spread.allx : value);
  const spreadY = [spread.fly, spread.fry, spread.fcy, 0, spread.bly, spread.bry]
    .map(value => spread.ally >= 0 ? spread.ally : value);
  // One selects the Hann window's recommended overlap.
  if (windowOverlap === 1) windowOverlap = 0.5;
  const length = channels[0]!.length;
  const hop = Math.max(1, Math.trunc(size * (1 - windowOverlap)));
  const scratchLength = (size & (size - 1)) === 0 ? 0 : 4 * 2 ** Math.ceil(Math.log2(2 * size - 1));
  // Output and overlap planes for each channel, two complex input transforms,
  // one complex inverse workspace, the window, and float FFT cosine tables.
  const cosineLength = scratchLength ? 0 : size / 4 + 1;
  budget.allocateMemory(length * outputChannels * 4 + size * (outputChannels * 4 + 6 * 8 + 4) + scratchLength * 8 + cosineLength * 4);
  const cosine = Float32Array.from({ length: cosineLength }, (_, i) => i === size / 4 ? 0 : Math.cos(2 * Math.PI * i / size));
  const scratch = scratchLength ? new Float64Array(scratchLength) : undefined;
  const output = Array.from({ length: outputChannels }, () => new Float32Array(length));
  const overlap = Array.from({ length: outputChannels }, () => new Float32Array(size));
  const real = channels.map(() => new Float64Array(size));
  const imaginary = channels.map(() => new Float64Array(size));
  const outReal = new Float64Array(size), outImaginary = new Float64Array(size);
  // FFmpeg uses float spectra and a square-root Hann window.
  const f = Math.fround, pi = f(Math.PI), halfPi = f(Math.PI / 2);
  const window = Float32Array.from({ length: size }, (_, i) => Math.sqrt(f(0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)))) / size));
  let max = 0;
  // Reuse the inverse workspace to sum shifted windows in native float order.
  for (let shift = 0; shift < size; shift += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    for (let i = 0; i < size; i++) {
      const index = (i + shift) % size;
      outReal[index] = f(outReal[index]! + window[i]!);
    }
  }
  for (let i = 0; i < size; i++) max = Math.max(max, outReal[i]!);
  const gain = f(1 / f(max * f(Math.sqrt(size))));
  const gains = Object.values(outputLevels).map(level => f(level * gain));
  const low = f(lfeLow * size / sampleRate), high = f(lfeHigh * size / sampleRate);
  for (let start = 0; start < length; start += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < size; i++) real[c]![i] = f(f(channels[c]![start - (size - hop) + i] ?? 0) * window[i]!);
      imaginary[c]!.fill(0);
      if (scratch) transform(real[c]!, imaginary[c]!, false, scratch);
      else dialogueSpectrum(real[c]!, imaginary[c]!, cosine);
    }
    for (let c = 0; c < outputChannels; c++) {
      for (let n = 0; n <= size / 2; n++) {
        const lr = f(real[0]![n]!), li = f(imaginary[0]![n]!);
        const rr = f(real[1]![n]!), ri = f(imaginary[1]![n]!);
        const lm = f(Math.hypot(lr, li)), rm = f(Math.hypot(rr, ri));
        const lp = phaseAngle(li, lr), rp = phaseAngle(ri, rr);
        const centerPhase = phaseAngle(f(li + ri), f(lr + rr));
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
        const horizontal = c === 2 || c === 3 ? f(1 - Math.abs(x)) : f(0.5 * f((c === 0 || c === 4 ? x : -x) + 1));
        const vertical = c === 3 ? f(1 - Math.abs(y)) : c < 3 ? front : f(1 - front);
        const factor = f(f(Math.pow(horizontal, spreadX[c]!)) * f(Math.pow(vertical, spreadY[c]!)));
        const lowpass = !lfe || n >= high ? 0 : n < low ? 1
          : f(0.5 * f(1 + f(Math.cos(f(f(pi * f(low - n)) / f(low - high))))));
        const magnitude = f((c === 3 ? f(lowpass * center) : c === 2 ? center : f(Math.hypot(lm, rm))) * factor);
        const phaseOut = c === 2 || c === 3 ? centerPhase : c === 0 || c === 4 ? lp : rp;
        outReal[n] = f(magnitude * f(Math.cos(phaseOut)));
        outImaginary[n] = n === 0 || n === size / 2 ? 0 : f(magnitude * f(Math.sin(phaseOut)));
        if (n > 0 && n < size / 2) {
          outReal[size - n] = outReal[n]!;
          outImaginary[size - n] = -outImaginary[n]!;
        }
      }
      if (scratch) transform(outReal, outImaginary, true, scratch);
      else inverseRealSpectrum(outReal, outImaginary, cosine);
      const buffer = overlap[c]!;
      buffer.copyWithin(0, hop); buffer.fill(0, size - hop);
      for (let i = 0; i < size; i++) buffer[i] = f(buffer[i]! + f(f(f(outReal[i]!) * window[i]!) * gains[c]!));
      output[c]!.set(buffer.subarray(0, Math.min(hop, length - start)), start);
    }
  }
  return { channels: output, frameSize: hop };
}
