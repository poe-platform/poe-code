import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { dialogueSpectrum, inverseRealSpectrum } from "./audio-dialogue-fft.js";
import { soundfieldTangent } from "./audio-float-tangent.js";
import { phaseAngle } from "./audio-float-phase.js";
import { transform } from "./audio-fft.js";
import { parseFilterExpression } from "./filter-expression.js";
import { audioSpeakerMasks, parseAudioChannelLayout } from "./audio-channel-layout.js";

export async function surroundAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<{ channels: Float32Array[]; frameSize: number; channelMask: number }> {
  let size = 4096, lfe = true;
  let windowFunction = "hann";
  let smooth = 0;
  let lfeMode = 0;
  let windowOverlap = 0.5;
  let lfeLow = 128, lfeHigh = 256;
  let focus = 0, angle = 90;
  let outputLayout = parseAudioChannelLayout("5.1");
  const inputLevels = [1, 1];
  const outputLevels = { fl_out: 1, fr_out: 1, fc_out: 1, lfe_out: 1, bl_out: 1, br_out: 1, sl_out: 1, sr_out: 1 };
  const spread = {
    flx: 0.5, frx: 0.5, fcx: 0.5, blx: 0.5, brx: 0.5, slx: 0.5, srx: 0.5, bcx: 0.5,
    fly: 0.5, fry: 0.5, fcy: 0.5, bly: 0.5, bry: 0.5, sly: 0.5, sry: 0.5, bcy: 0.5,
    allx: -1, ally: -1
  };
  const setOption = (key: string | undefined, value: string) => {
    if (key === "chl_out") {
      const layout = parseAudioChannelLayout(value);
      if (!["FL+FR", "FL+FR+BL+BR", "FL+FR+FC+LFE+BL+BR", "FL+FR+FC+LFE+SL+SR", "FL+FR+FC+LFE+BL+BR+SL+SR"].includes(layout.join("+"))) {
        throw new Error("surround: supported output layouts are stereo, quad, 5.1, 5.1(side), and 7.1");
      }
      outputLayout = layout;
    } else if (key === "chl_in") {
      if (parseAudioChannelLayout(value).join("+") !== "FL+FR") throw new Error("surround: supported input layout is stereo");
    } else if (key === "level_in" || key === "level_out") {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 10, default: 1 });
      if (!Number.isFinite(number) || number < 0 || number > 10) {
        throw new RangeError(`surround: ${key} must be between 0 and 10`);
      }
      // FFmpeg 7.0.2 overwrites these global levels with per-channel defaults.
    } else if (key === "fl_in" || key === "fr_in" || (key !== undefined && Object.hasOwn(outputLevels, key))) {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 10, default: 1 });
      if (!Number.isFinite(number) || number < 0 || number > 10) {
        throw new RangeError(`surround: ${key} must be between 0 and 10`);
      }
      if (key === "fl_in" || key === "fr_in") inputLevels[key === "fl_in" ? 0 : 1] = Math.fround(number);
      else outputLevels[key as keyof typeof outputLevels] = Math.fround(number);
    } else if (key === "focus") {
      const number = parseFilterExpression(value, "surround", { min: -1, max: 1, default: 0 });
      if (!Number.isFinite(number) || number < -1 || number > 1) {
        throw new RangeError("surround: focus must be between -1 and 1");
      }
      focus = Math.fround(number);
    } else if (key !== undefined && Object.hasOwn(spread, key)) {
      const global = key === "allx" || key === "ally";
      const min = global ? -1 : 0.06;
      const number = parseFilterExpression(value, "surround", { min, max: 15, default: global ? -1 : 0.5 });
      if (!Number.isFinite(number) || number < min || number > 15) {
        throw new RangeError(`surround: ${key} must be between ${min} and 15`);
      }
      spread[key as keyof typeof spread] = Math.fround(number);
    } else if (key === "angle") {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 360, default: 90 });
      if (!Number.isFinite(number) || number < 0 || number > 360) {
        throw new RangeError("surround: angle must be between 0 and 360");
      }
      angle = Math.fround(number);
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
    } else if (key === "lfe_mode") {
      const number = parseFilterExpression(value, "surround", { add: 0, sub: 1, min: 0, max: 1, default: 0 });
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new RangeError("surround: lfe_mode must be between 0 and 1");
      }
      lfeMode = number === 0.5 ? 0 : Math.round(number);
    } else if (key === "smooth") {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 1, default: 0 });
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new RangeError("surround: smooth must be between 0 and 1");
      }
      smooth = Math.fround(number);
    } else if (key === "win_func") {
      if (value === "rect" || value === "0") windowFunction = "rect";
      else if (value === "hann" || value === "hanning" || value === "1") windowFunction = "hann";
      else if (value === "hamming" || value === "2") windowFunction = "hamming";
      else throw new Error(`surround: unsupported option ${key}`);
    } else if (key === "overlap") {
      const number = parseFilterExpression(value, "surround", { min: 0, max: 1, default: 0.5 });
      if (!Number.isFinite(number) || number < 0 || number > 1) {
        throw new RangeError("surround: overlap must be between 0 and 1");
      }
      windowOverlap = Math.fround(number);
    } else if (key === "lfe") {
      const boolean = value.toLowerCase();
      if (["1", "true", "yes", "on", "y", "enabled"].includes(boolean)) lfe = true;
      else if (["0", "false", "no", "off", "n", "disabled"].includes(boolean)) lfe = false;
      else throw new Error("surround: invalid lfe");
    } else throw new Error(`surround: unsupported option ${key}`);
  };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["chl_out", "chl_in", "level_in", "level_out", "lfe", "lfe_low", "lfe_high"][index] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    setOption(key, value);
  }
  if (lfeLow >= lfeHigh) throw new Error(`surround: low cutoff ${lfeLow} must be less than high cutoff ${lfeHigh}`);
  if (size % 4 !== 0) throw new Error("surround: unsupported transform size");
  if (channels.length !== 2) throw new Error("surround: stereo input required");
  // Global spreads override speaker options regardless of argument order.
  // LFE has zero exponents by default and only global options change them.
  const outputChannels = outputLayout.length;
  const channelMask = outputLayout.reduce((mask, speaker) => mask + audioSpeakerMasks[speaker]!, 0);
  const hasLfe = outputLayout.includes("LFE");
  const spreadX = outputLayout.map(speaker => spread.allx >= 0 ? spread.allx
    : speaker === "LFE" ? 0 : spread[`${speaker.toLowerCase()}x` as keyof typeof spread]);
  const spreadY = outputLayout.map(speaker => spread.ally >= 0 ? spread.ally
    : speaker === "LFE" ? 0 : spread[`${speaker.toLowerCase()}y` as keyof typeof spread]);
  // One selects the window's recommended overlap.
  if (windowOverlap === 1) windowOverlap = windowFunction === "rect" ? 0 : 0.5;
  const length = channels[0]!.length;
  const hop = Math.max(1, Math.trunc(size * (1 - windowOverlap)));
  const scratchLength = (size & (size - 1)) === 0 ? 0 : 4 * 2 ** Math.ceil(Math.log2(2 * size - 1));
  // Output and overlap planes for each channel, two complex input transforms,
  // one complex inverse workspace, the window, and float FFT cosine tables.
  const cosineLength = scratchLength ? 0 : size / 4 + 1;
  budget.allocateMemory(length * outputChannels * 4 + size * (outputChannels * 4 + 6 * 8 + 4) + scratchLength * 8 + cosineLength * 4);
  // Only intermediate strengths need history; both endpoints use current factors.
  const smoothingLength = smooth > 0 && smooth < 1 ? size / 2 + 1 : 0;
  budget.allocateMemory(outputChannels * smoothingLength * 4);
  const smoothedFactors = Array.from({ length: outputChannels }, () => new Float32Array(smoothingLength));
  const cosine = Float32Array.from({ length: cosineLength }, (_, i) => i === size / 4 ? 0 : Math.cos(2 * Math.PI * i / size));
  const scratch = scratchLength ? new Float64Array(scratchLength) : undefined;
  const output = Array.from({ length: outputChannels }, () => new Float32Array(length));
  const overlap = Array.from({ length: outputChannels }, () => new Float32Array(size));
  const real = channels.map(() => new Float64Array(size));
  const imaginary = channels.map(() => new Float64Array(size));
  const outReal = new Float64Array(size), outImaginary = new Float64Array(size);
  // FFmpeg uses float spectra and square-root window weights.
  const f = Math.fround, pi = f(Math.PI), halfPi = f(Math.PI / 2);
  const reference = f(f(angle * pi) / 180);
  // Radius of the square soundfield boundary (FFmpeg r_distance).
  const radius = (a: number): number => {
    const tangent = soundfieldTangent(a), inverse = f(1 / tangent);
    return Math.min(f(Math.sqrt(f(1 + f(tangent * tangent)))), f(Math.sqrt(f(1 + f(inverse * inverse)))));
  };
  const window = Float32Array.from({ length: size }, (_, i) => {
    const angle = 2 * Math.PI * i / (size - 1);
    const weight = windowFunction === "rect" ? 1
      : windowFunction === "hamming" ? 0.54 - 0.46 * Math.cos(angle)
      : 0.5 * (1 - Math.cos(angle));
    return Math.sqrt(f(weight) / size);
  });
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
  const speakers = outputLayout.map(speaker => `${speaker.toLowerCase()}_out` as keyof typeof outputLevels);
  let nextCommand = 0;
  const low = f(lfeLow * size / sampleRate), high = f(lfeHigh * size / sampleRate);
  for (let start = 0; start < length; start += hop) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    // Commands arrive while input frames fill this hop, before its transform.
    // Changing coefficients leaves the overlap from earlier windows intact.
    while (nextCommand < commands.length && commands[nextCommand]!.sample < Math.min(start + hop, length)) {
      const { action, expression } = commands[nextCommand++]!;
      if (action !== "lfe" && !Object.hasOwn(outputLevels, action)) continue;
      try {
        setOption(action, expression.trim());
      } catch { /* Native keeps the previous value after a rejected command. */ }
    }
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < size; i++) real[c]![i] = f(f(f(channels[c]![start - (size - hop) + i] ?? 0) * window[i]!) * inputLevels[c]!);
      imaginary[c]!.fill(0);
      if (scratch) transform(real[c]!, imaginary[c]!, false, scratch);
      else dialogueSpectrum(real[c]!, imaginary[c]!, cosine);
    }
    for (let c = 0; c < outputChannels; c++) {
      const speaker = outputLayout[c]!;
      const centerSpeaker = speaker === "FC" || speaker === "LFE";
      const leftSpeaker = speaker === "FL" || speaker === "BL" || speaker === "SL";
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
        let x = Math.max(-1, Math.min(1, f(difference + f(difference * widening))));
        const balanceCosine = f(Math.cos(f(f(difference * halfPi) + pi)));
        const phaseCosine = f(Math.cos(f(halfPi - f(phase / pi))));
        let y = Math.max(-1, Math.min(1, f(f(f(balanceCosine * phaseCosine) * f(Math.LN10)) + 1)));
        if (angle !== 90) {
          let a = phaseAngle(x, y);
          let r = f(f(Math.hypot(x, y)) / radius(a));
          a = Math.abs(a) <= f(Math.PI / 4) ? f(a * f(reference / halfPi))
            : f(pi + f(f(f(f(f(-2 * pi) + reference) * f(pi - Math.abs(a))) * Math.sign(a)) / f(3 * halfPi)));
          r = f(r * radius(a));
          x = Math.max(-1, Math.min(1, f(f(Math.sin(a)) * r)));
          y = Math.max(-1, Math.min(1, f(f(Math.cos(a)) * r)));
        }
        if (focus !== 0) {
          const angle = phaseAngle(x, y);
          const tangent = soundfieldTangent(angle), reciprocal = f(1 / tangent);
          const radius = Math.min(f(Math.sqrt(f(1 + f(tangent * tangent)))),
            f(Math.sqrt(f(1 + f(reciprocal * reciprocal)))));
          let distance = Math.max(0, Math.min(1, f(f(Math.hypot(x, y)) / radius)));
          distance = focus > 0
            ? f(1 - f(Math.pow(f(1 - distance), f(1 + f(focus * 20)))))
            : f(Math.pow(distance, f(1 - f(focus * 20))));
          distance = f(distance * radius);
          x = Math.max(-1, Math.min(1, f(f(Math.sin(angle)) * distance)));
          y = Math.max(-1, Math.min(1, f(f(Math.cos(angle)) * distance)));
        }
        const front = f(f(y + 1) * 0.5);
        const horizontal = centerSpeaker ? f(1 - Math.abs(x)) : f(0.5 * f((leftSpeaker ? x : -x) + 1));
        const vertical = speaker === "LFE" || speaker === "SL" || speaker === "SR" ? f(1 - Math.abs(y))
          : speaker === "BL" || speaker === "BR" ? f(1 - front) : front;
        let factor = f(f(Math.pow(horizontal, spreadX[c]!)) * f(Math.pow(vertical, spreadY[c]!)));
        if (smoothingLength) {
          const history = smoothedFactors[c]!;
          factor = f(f(smooth * factor) + f(f(1 - smooth) * history[n]!));
          history[n] = factor;
        }
        const lowpass = !lfe || !hasLfe || n >= high ? 0 : n < low ? 1
          : f(0.5 * f(1 + f(Math.cos(f(f(pi * f(low - n)) / f(low - high))))));
        const bass = f(lowpass * center);
        const total = f(Math.hypot(lm, rm));
        // Subtract bass before distributing energy to front/rear speakers; center is unchanged.
        const magnitude = f((speaker === "LFE" ? bass : speaker === "FC" ? center : lfeMode ? f(total - bass) : total) * factor);
        const phaseOut = centerSpeaker ? centerPhase : leftSpeaker ? lp : rp;
        outReal[n] = f(magnitude * f(Math.cos(phaseOut)));
        outImaginary[n] = n === 0 || n === size / 2 ? 0 : f(magnitude * f(Math.sin(phaseOut)));
        if (n > 0 && n < size / 2) {
          outReal[size - n] = outReal[n]!;
          outImaginary[size - n] = -outImaginary[n]!;
        }
      }
      if (scratch) transform(outReal, outImaginary, true, scratch);
      else inverseRealSpectrum(outReal, outImaginary, cosine);
      const level = f(outputLevels[speakers[c]!] * gain);
      const buffer = overlap[c]!;
      buffer.copyWithin(0, hop); buffer.fill(0, size - hop);
      for (let i = 0; i < size; i++) buffer[i] = f(buffer[i]! + f(f(f(outReal[i]!) * window[i]!) * level));
      output[c]!.set(buffer.subarray(0, Math.min(hop, length - start)), start);
    }
  }
  return { channels: output, frameSize: hop, channelMask };
}
