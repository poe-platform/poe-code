import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function softClipAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number }[],
  format: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const types = ["hard", "tanh", "atan", "cubic", "exp", "alg", "quintic", "sin", "erf"];
  let type = "tanh";
  let enable: string | undefined;
  const options = { threshold: 1, output: 1, param: 1, oversample: 1 };
  function setOption(key: string | undefined, value: string): void {
    if (key === "enable") {
      parseFilterExpression(value, "asoftclip enable", { n: 0, t: 0 });
      enable = value;
    } else if (key === "type") {
      const number = parseFilterExpression(value, "asoftclip", {
        ...Object.fromEntries(types.map((name, index) => [name, index - 1])),
        default: 0, min: -1, max: types.length - 2
      }, undefined, new Float64Array(10));
      if (!Number.isFinite(number) || number < -1 || number > types.length - 2) throw new RangeError("asoftclip: invalid type");
      // FFmpeg's integer options round exact halves to the nearest even integer.
      const lower = Math.floor(number);
      const index = number - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(number);
      type = types[index + 1]!;
    } else if (key === "oversample") {
      const number = parseFilterExpression(value, "asoftclip", {});
      if (!Number.isFinite(number) || number < 1 || number > 64) throw new RangeError("asoftclip: invalid oversample");
      // Native integer options validate the range before rounding ties to even.
      options.oversample = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "threshold" || key === "output" || key === "param") {
      const number = parseFilterExpression(value, "asoftclip", {});
      const min = key === "param" ? 0.01 : 0.000001;
      const max = key === "param" ? 3 : key === "output" ? 16 : 1;
      if (!value || !Number.isFinite(number) || number < min || number > max) {
        throw new RangeError(`asoftclip: invalid ${key}`);
      }
      options[key] = number;
    } else {
      throw new Error(`asoftclip: unsupported option ${key}`);
    }
  }
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let positional = 0;
  for (const option of (argument ? argument.split(":") : [])) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["type", "threshold", "output", "param", "oversample"][positional++] : option.slice(0, separator).trim();
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "asoftclip");
      continue;
    }
    setOption(key, value);
  }
  function clip(sample: number): number {
    let clipped: number;
    switch (type) {
      case "hard": clipped = Math.max(-1, Math.min(1, sample)); break;
      // FFmpeg rounds atanf's input and result before the double-precision scale.
      case "atan": clipped = 2 / Math.PI * round(Math.atan(round(sample * param))); break;
      case "cubic": clipped = Math.abs(sample) >= 1.5 ? Math.sign(sample) : sample - 0.1481 * sample ** 3; break;
      // Match expf and the float arithmetic before PCM encoding.
      case "exp": clipped = round(2 / round(1 + round(Math.exp(round(-2 * sample))))) - 1; break;
      case "alg": clipped = sample / round(Math.sqrt(round(param + round(sample * sample)))); break;
      case "quintic": clipped = Math.abs(sample) >= 1.25 ? Math.sign(sample) : sample - 0.08192 * sample ** 5; break;
      case "sin": clipped = Math.abs(sample) >= Math.PI / 2 ? Math.sign(sample) : Math.sin(sample); break;
      case "erf": {
        const x = Math.abs(sample);
        // erf(6) rounds to 1. The positive series avoids cancellation below it.
        if (x >= 6) {
          clipped = Math.sign(sample);
          break;
        }
        let term = x;
        let sum = x;
        for (let n = 1; n < 128; n++) {
          term *= 2 * x * x / (2 * n + 1);
          const next = sum + term;
          if (next === sum) break;
          sum = next;
        }
        clipped = Math.sign(sample) * (2 / Math.sqrt(Math.PI) * Math.exp(-x * x) * sum);
        break;
      }
      default: clipped = format === "dblp" ? Math.tanh(sample * param) : tanhFloat(round(sample * param));
    }
    return round(round(clipped) * gain);
  }
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  // Zero insertion and two low-pass passes match FFmpeg's oversampling.
  // The cutoff is the original Nyquist frequency, so the rate cancels out.
  const round = format === "dblp" ? (value: number) => value : Math.fround;
  budget.allocateMemory(channels.length * 64 * 4 * 8);
  // Native keeps separate up/down histories for every oversampling factor.
  const history = channels.map(() => new Float64Array(64 * 4));
  let gain = 1, param = 1;
  let work = 0;
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      try {
        setOption(command.action, command.expression);
      } catch { /* Native asendcmd continues after a rejected command. */ }
    }
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "asoftclip enable", {
      n, t: frame.pts / sampleRate
    })) >= 0.5;
    const angle = Math.PI / options.oversample;
    const cosine = Math.cos(angle);
    const alpha = Math.sin(angle) / 1.6;
    const a0 = 1 + alpha;
    const feedback1 = -2 * cosine / a0;
    const feedback2 = (1 - alpha) / a0;
    const feed0 = (1 - cosine) / 2 / a0;
    const feed1 = (1 - cosine) / a0;
    const normalization = (1 + feedback1 + feedback2) / (feed0 + feed1 + feed0);
    const a1 = round(feedback1), a2 = round(feedback2);
    const b0 = round(feed0 * normalization), b1 = round(feed1 * normalization);
    const threshold = round(options.threshold);
    gain = round(options.output * threshold);
    const factor = round(1 / threshold);
    param = round(options.param);
    for (const [c, channel] of channels.entries()) {
      const state = history[c]!;
      const offset = (options.oversample - 1) * 4;
      let up0 = state[offset]!, up1 = state[offset + 1]!;
      let down0 = state[offset + 2]!, down1 = state[offset + 3]!;
      for (let i = frame.start; i < frame.end; i++) {
        for (let phase = 0; phase < (enabled ? options.oversample : 1); phase++) {
          if (work++ % 4096 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          if (!enabled) {
            output[c]![i] = channel[i]!;
            continue;
          }
          if (options.oversample === 1) {
            output[c]![i] = clip(round(round(channel[i]!) * factor));
            continue;
          }
          const sample = phase === 0 ? round(channel[i]!) : 0;
          const interpolated = round(round(sample * b0) + up0);
          up0 = round(round(round(b1 * sample) + up1) - round(a1 * interpolated));
          up1 = round(round(b0 * sample) - round(a2 * interpolated));
          const clipped = clip(round(interpolated * factor));
          const filtered = round(round(clipped * b0) + down0);
          down0 = round(round(round(b1 * clipped) + down1) - round(a1 * filtered));
          down1 = round(round(b0 * clipped) - round(a2 * filtered));
          // Stream the oversampled values without allocating a factor-sized buffer.
          if (phase === 0) output[c]![i] = round(filtered * (options.oversample * 0.5));
        }
      }
      state[offset] = up0;
      state[offset + 1] = up1;
      state[offset + 2] = down0;
      state[offset + 3] = down1;
    }
  }
  return output;
}

// Float tanh/expm1 arithmetic from Sun fdlibm, as used by native FFmpeg's libm.
// Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
// Developed at SunPro, a Sun Microsystems, Inc. business.
// Permission to use, copy, modify, and distribute this software is freely
// granted, provided that this notice is preserved.
function tanhFloat(value: number): number {
  const round = Math.fround;
  const magnitude = Math.abs(value);
  if (magnitude < 2 ** -55) return value;
  if (magnitude >= 22) return Math.sign(value);
  let x = magnitude < 1 ? -2 * magnitude : 2 * magnitude;
  let exponent = 0, correction = 0;
  if (Math.abs(x) > round(Math.LN2 / 2)) {
    exponent = Math.abs(x) < round(1.5 * Math.LN2)
      ? Math.sign(x) : Math.trunc(round(round(round(1.4426950216) * x) + Math.sign(x) * 0.5));
    const high = round(x - round(exponent * round(0.69313812256)));
    const low = round(exponent * round(9.0580006145e-6));
    x = round(high - low);
    correction = round(round(high - x) - low);
  }
  let exponential: number;
  if (exponent === 0 && Math.abs(x) < 2 ** -25) {
    exponential = x;
  } else {
    const half = round(0.5 * x);
    const square = round(x * half);
    let polynomial = round(round(4.0082177293e-6) + round(square * round(-2.0109921195e-7)));
    polynomial = round(round(-7.9365076090e-5) + round(square * polynomial));
    polynomial = round(round(1.5873016091e-3) + round(square * polynomial));
    polynomial = round(round(-3.3333335072e-2) + round(square * polynomial));
    const rational = round(1 + round(square * polynomial));
    const denominator = round(3 - round(rational * half));
    let error = round(square * round(round(rational - denominator) / round(6 - round(x * denominator))));
    if (exponent === 0) {
      exponential = round(x - round(round(x * error) - square));
    } else {
      error = round(round(round(x * round(error - correction)) - correction) - square);
      if (exponent === -1) exponential = round(round(0.5 * round(x - error)) - 0.5);
      else if (exponent === 1) exponential = x < -0.25
        ? round(-2 * round(error - round(x + 0.5))) : round(1 + round(2 * round(x - error)));
      else if (exponent <= -2 || exponent > 56) exponential = round(round(round(1 - round(error - x)) * 2 ** exponent) - 1);
      else if (exponent < 23) exponential = round(round(round(1 - 2 ** -exponent) - round(error - x)) * 2 ** exponent);
      else exponential = round(round(round(x - round(error + 2 ** -exponent)) + 1) * 2 ** exponent);
    }
  }
  return Math.sign(value) * (magnitude < 1
    ? round(-exponential / round(exponential + 2))
    : round(1 - round(2 / round(exponential + 2))));
}
