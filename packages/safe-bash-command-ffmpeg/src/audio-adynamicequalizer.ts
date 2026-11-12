import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function listenDynamicEqualizer(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal, sampleFormat = "s16",
  frames: readonly { start: number; end: number; pts: number }[] = [{ start: 0, end: channels[0]?.length ?? 0, pts: 0 }]
): Promise<(Float32Array | Float64Array)[]> {
  const options = {
    threshold: 0, dfrequency: 1000, dqfactor: 1, tfrequency: 1000, tqfactor: 1,
    attack: 20, release: 200, ratio: 1, makeup: 0, range: 50
  };
  const ranges = {
    threshold: [0, 100], dfrequency: [2, 1000000], dqfactor: [0.001, 1000],
    tfrequency: [2, 1000000], tqfactor: [0.001, 1000], attack: [0.01, 2000],
    release: [0.01, 2000], ratio: [0, 30], makeup: [0, 1000], range: [1, 2000]
  };
  const names = [...Object.keys(ranges), "mode"];
  let positionalIndex = 0;
  let mode = 0;
  let enable: string | undefined;
  let listenOnlyOption: string | undefined;
  let precision = 0;
  let tftype = 0;
  let dftype = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[positionalIndex++] : option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "adynamicequalizer enable", { n: 0, t: 0 });
    } else if (key === "dftype") {
      const number = parseFilterExpression(value, "adynamicequalizer", { bandpass: 0, lowpass: 1, highpass: 2, peak: 3 });
      if (!Number.isFinite(number) || number < 0 || number > 3) {
        throw new Error("adynamicequalizer: invalid dftype");
      }
      dftype = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "mode") {
      const number = parseFilterExpression(value, "adynamicequalizer", {
        listen: -1, cutbelow: 0, cutabove: 1, boostbelow: 2, boostabove: 3
      });
      if (!Number.isFinite(number) || number < -1 || number > 3) {
        throw new Error("adynamicequalizer: invalid mode");
      }
      mode = Math.abs(number % 1) === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "precision") {
      const number = parseFilterExpression(value, "adynamicequalizer", { auto: 0, float: 1, double: 2 });
      if (!Number.isFinite(number) || number < 0 || number > 2) {
        throw new Error("adynamicequalizer: invalid precision");
      }
      precision = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
    } else if (key === "tftype" || key === "auto") {
      const constants = key === "tftype"
        ? { bell: 0, lowshelf: 1, highshelf: 2 }
        : { disabled: 1, off: 2, on: 3, adaptive: 4 };
      const number = parseFilterExpression(value, "adynamicequalizer", constants);
      if (!Number.isFinite(number) || number < (key === "tftype" ? 0 : 1) || number > (key === "tftype" ? 2 : 4)) {
        throw new Error(`adynamicequalizer: invalid ${key}`);
      }
      if (key === "tftype") tftype = number % 1 === 0.5 ? 2 * Math.round(number / 2) : Math.round(number);
      else listenOnlyOption = key;
    } else if (key && Object.hasOwn(ranges, key)) {
      const number = parseFilterExpression(value, "adynamicequalizer", {});
      const [min, max] = ranges[key as keyof typeof ranges];
      if (!value || !Number.isFinite(number) || number < min! || number > max!) {
        throw new Error(`adynamicequalizer: invalid ${key}`);
      }
      options[key as keyof typeof options] = number;
    } else {
      throw new Error(`adynamicequalizer: unsupported option ${key}`);
    }
  }
  if (mode !== -1 && listenOnlyOption) {
    throw new Error(`adynamicequalizer: unsupported option ${listenOnlyOption} outside listen mode`);
  }

  // Native auto precision keeps double/64-bit input; other formats use float.
  const double = precision === 2 || (precision === 0 && ["dbl", "dblp", "s64", "s64p"].includes(sampleFormat));
  const SampleArray = double ? Float64Array : Float32Array;
  // Round each operation only when processing with float coefficients and state.
  const f = double ? (value: number) => value : Math.fround;
  const frequency = f(Math.min(options.dfrequency, sampleRate * 0.5));
  const g = f(Math.tan(f(Math.PI * frequency / sampleRate)));
  const k = f(1 / f(options.dqfactor));
  const a0 = f(1 / f(1 + f(g * f(g + k))));
  const a1 = f(g * a0);
  const a2 = f(g * a1);
  // Native highpass omits the direct input; peak mixes it with -k*band - 2*low.
  const inputMix = dftype === 3 ? 1 : 0;
  const bandMix = dftype === 0 ? k : dftype === 1 ? 0 : -k;
  const lowMix = dftype === 0 ? 0 : dftype === 1 ? 1 : dftype === 2 ? -1 : -2;
  const targetG = f(Math.tan(f(Math.PI * f(Math.min(options.tfrequency, sampleRate * 0.5)) / sampleRate)));
  const attack = 1 - Math.exp(-1 / (options.attack * 0.001 * sampleRate));
  const release = 1 - Math.exp(-1 / (options.release * 0.001 * sampleRate));
  const gainAttack = f(attack * 0.25);
  const gainRelease = f(release * 0.25);
  const detectAttack = f(attack);
  const detectRelease = f(release);
  const threshold = f(20 * f(Math.log10(f(options.threshold))));
  const ratio = f(options.ratio);
  const makeup = f(options.makeup);
  const range = f(options.range);
  const inverseTargetQ = f(1 / f(options.tqfactor));
  const power = mode === 0 || mode === 1 ? -1 : 1;
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * SampleArray.BYTES_PER_ELEMENT, 0));
  const output = channels.map(channel => new SampleArray(channel.length));
  let work = 0;
  for (const [c, channel] of channels.entries()) {
    let state0 = 0;
    let state1 = 0;
    let targetState0 = 0;
    let targetState1 = 0;
    let detect = 0;
    let gain = 0;
    let targetA0 = 0;
    let targetA1 = 0;
    let targetA2 = 0;
    let targetInputMix = 1;
    let targetBandMix = 0;
    let targetLowMix = 0;
    for (const [n, frame] of frames.entries()) {
      const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "adynamicequalizer enable", {
        n, t: frame.pts / sampleRate
      })) >= 0.5;
      // Native keeps detector history running while its output is bypassed.
      for (let i = frame.start; i < frame.end; i++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const delta = f(f(channel[i]!) - state1);
        const band = f(f(a0 * state0) + f(a1 * delta));
        const low = f(f(state1 + f(a1 * state0)) + f(a2 * delta));
        state0 = f(f(2 * band) - state0);
        state1 = f(f(2 * low) - state1);
        const listen = f(f(f(inputMix * f(channel[i]!)) + f(bandMix * band)) + f(lowMix * low));
        if (mode === -1) {
          output[c]![i] = enabled ? listen : channel[i]!;
          continue;
        }
        const amplitude = Math.abs(listen);
        const detectCoef = amplitude > detect ? detectAttack : detectRelease;
        detect = f(f(detectCoef * amplitude) + f(f(1 - detectCoef) * detect));
        const level = f(20 * f(Math.log10(detect)));
        const difference = f(mode === 0 || mode === 2 ? threshold - level : level - threshold);
        let wantedGain = 1;
        if (difference > 0) {
          const gainDb = f(Math.min(range, Math.max(0, f(makeup + f(difference * ratio)))) * power);
          wantedGain = f(2 ** f(Math.log2(10) * f(gainDb / 20)));
        }
        const gainCoef = wantedGain > gain ? gainAttack : gainRelease;
        const nextGain = f(f(gainCoef * wantedGain) + f(f(1 - gainCoef) * gain));
        if (nextGain !== gain || i === 0) {
          gain = nextGain;
          const targetK = tftype === 0 ? f(inverseTargetQ / gain) : inverseTargetQ;
          const targetFrequency = tftype === 0 ? targetG : tftype === 1
            ? f(targetG / f(Math.sqrt(gain))) : f(targetG * f(Math.sqrt(gain)));
          targetA0 = f(1 / f(1 + f(targetFrequency * f(targetFrequency + targetK))));
          targetA1 = f(targetFrequency * targetA0);
          targetA2 = f(targetFrequency * targetA1);
          if (tftype === 0) {
            targetBandMix = f(targetK * f(f(gain * gain) - 1));
          } else if (tftype === 1) {
            targetBandMix = f(targetK * f(gain - 1));
            targetLowMix = f(f(gain * gain) - 1);
          } else {
            targetInputMix = f(gain * gain);
            targetBandMix = f(f(targetK * f(1 - gain)) * gain);
            targetLowMix = f(1 - f(gain * gain));
          }
        }
        const sample = f(channel[i]!);
        const targetDelta = f(sample - targetState1);
        const targetBand = f(f(targetA0 * targetState0) + f(targetA1 * targetDelta));
        const targetLow = f(f(targetState1 + f(targetA1 * targetState0)) + f(targetA2 * targetDelta));
        targetState0 = f(f(2 * targetBand) - targetState0);
        targetState1 = f(f(2 * targetLow) - targetState1);
        output[c]![i] = enabled
          ? f(f(f(targetInputMix * sample) + f(targetBandMix * targetBand)) + f(targetLowMix * targetLow))
          : channel[i]!;
      }
    }
  }
  return output;
}
