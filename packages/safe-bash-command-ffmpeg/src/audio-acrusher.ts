import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterBoolean } from "./filter-boolean.js";
import { parseFilterExpression } from "./filter-expression.js";

export async function crushAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  let enable: string | undefined;
  const defaults = { level_in: 1, level_out: 1, bits: 8, mix: 0.5, mode: 0, dc: 1, aa: 0.5,
    samples: 1, lfo: 0, lforange: 20, lforate: 0.3 };
  const options = { ...defaults };
  const ranges = { level_in: [0.015625, 64], level_out: [0.015625, 64], bits: [1, 64],
    mix: [0, 1], mode: [0, 1], dc: [0.25, 4], aa: [0, 1],
    samples: [1, 250], lfo: [0, 1], lforange: [1, 250], lforate: [0.01, 200] };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  let position = 0;
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[position] : option.slice(0, separator).trim() as keyof typeof options | "enable";
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "acrusher enable", {
        n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
      }, undefined, new Float64Array(10), []);
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`acrusher: unsupported option ${option}`);
    if (key === "lfo") {
      options.lfo = parseFilterBoolean(option.slice(separator + 1).trim(), "acrusher: invalid lfo") ? 1 : 0;
      continue;
    }
    const [min, max] = ranges[key];
    const value = parseFilterExpression(option.slice(separator + 1).trim(), "acrusher", {
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2, min: min!, max: max!, default: defaults[key],
      ...(key === "mode" ? { lin: 0, log: 1 } : {})
    });
    if (!Number.isFinite(value) || value < min! || value > max!) throw new RangeError(`acrusher: invalid ${key}`);
    options[key] = key === "mode" ? (value > 0.5 ? 1 : 0) : value;
  }

  const coefficient = 2 ** options.bits - 1;
  const scale = Math.sqrt(coefficient / 2);
  const plateau = (1 - options.aa) / 2;
  const inverseDc = 1 / options.dc;
  const radius = options.lforange / 2;
  let minimum = Math.max(options.samples - radius, 1);
  let maximum = Math.min(options.samples + radius, 250);
  // Shift the modulation window inward at either sample-reduction limit.
  const under = options.samples - radius - minimum;
  const over = options.samples + radius - maximum;
  maximum -= under;
  minimum -= over;
  const span = maximum - minimum;
  const phaseStep = options.lforate * (1 / sampleRate);
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  let work = 0;
  budget.allocateMemory(channels.length * 5 * 8);
  const states = channels.map(() => ({ phase: 0, held: 0, elapsed: 0, target: 0, real: 0 }));
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  for (const [n, frame] of frames.entries()) {
    let enabled = true;
    if (enable !== undefined) {
      const variables = {
        n, t: frame.pts / sampleRate, pos: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN,
        w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
      };
      // FFmpeg evaluates on frame consumption and again before filter_frame.
      parseFilterExpression(enable, "acrusher enable", variables, undefined, registers, randomStates);
      enabled = Math.abs(parseFilterExpression(enable, "acrusher enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    for (const [c, channel] of channels.entries()) {
      let { phase, held, elapsed, target, real } = states[c]!;
      for (let i = frame.start; i < frame.end; i++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const source = channel[i]!;
        if (!enabled) {
          output[c]![i] = source;
          continue;
        }
        const samples = options.lfo
          ? minimum + span * (Math.sin((phase * 360) * Math.PI / 180) * 0.5 + 0.5)
          : options.samples;
        const rounded = Math.round(samples);
        if (++elapsed >= rounded) {
          target += samples;
          real += rounded;
          if (target + samples >= real + 1) {
            held = source * options.level_in;
            target = real = 0;
          }
          elapsed = 0;
        }
        if (options.lfo) phase = (phase + phaseStep) % 1;
        let sample = options.mix * held + source * (1 - options.mix) * options.level_in;
        sample *= sample > 0 ? options.dc : inverseDc;
        const y = options.mode === 1 ? scale * Math.log(Math.abs(sample)) + scale * scale : sample * coefficient;
        // FFmpeg rounds a float coordinate with ties away from zero.
        const coordinate = Math.fround(y);
        const k = Math.sign(coordinate) * Math.floor(Math.abs(coordinate) + 0.5);
        let crushed = options.mode === 1 ? Math.exp(k / scale - scale) : k / coefficient;
        if (options.mode === 1 && sample === 0) {
          crushed = 0;
        } else {
          if (y < k - plateau || y > k + plateau) {
            const direction = y > k ? 1 : -1;
            const adjacent = options.mode === 1 ? Math.exp((k + direction) / scale - scale) : (k + direction) / coefficient;
            const blend = 0.5 * (Math.sin(Math.PI * (Math.abs(y - k) - plateau) / options.aa - Math.PI / 2) + 1);
            crushed += (adjacent - crushed) * blend;
          }
          if (options.mode === 1) crushed *= Math.sign(sample);
        }
        crushed += (sample - crushed) * options.mix;
        crushed *= crushed > 0 ? inverseDc : options.dc;
        output[c]![i] = crushed * options.level_out;
      }
      Object.assign(states[c]!, { phase, held, elapsed, target, real });
    }
  }
  return output;
}
