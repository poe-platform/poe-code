import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function tremoloAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; expression: string }[] = []
): Promise<Float64Array[]> {
  let frequency = 5;
  let depth = 0.5;
  let enable: string | undefined;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let optionPosition = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["f", "d"][optionPosition] : option.slice(0, separator).trim();
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, "tremolo enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 }, undefined, new Float64Array(10), []);
      continue;
    }
    if (key !== "f" && key !== "d") throw new Error(`tremolo: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const min = key === "f" ? 0.1 : 0;
    const max = key === "f" ? 20000 : 1;
    const number = parseFilterExpression(value, "tremolo", {
      E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2,
      min, max, default: key === "f" ? 5 : 0.5, none: 0, all: -1
    }, undefined, new Float64Array(10));
    if (number < min || number > max) {
      throw new RangeError(`tremolo: invalid ${key}`);
    }
    if (key === "f") frequency = number;
    else depth = number;
  }
  // Native FFmpeg rounds sampleRate / frequency + 0.5 to nearest, ties to even.
  const size = sampleRate / frequency + 0.5;
  const rounded = Math.round(size);
  const period = size === rounded - 0.5 && rounded % 2 !== 0 ? rounded - 1 : rounded;
  const offset = 1 - depth / 2;
  const length = channels[0]?.length ?? 0;
  const envelopeLength = Math.min(period, length);
  budget.allocateMemory((length * channels.length + envelopeLength) * 8);
  const envelope = new Float64Array(envelopeLength);
  const output = channels.map(() => new Float64Array(length));
  let work = 0;
  // Native generic timeline bypass freezes the oscillator while disabled.
  let position = 0;
  // Validation must not consume the first draw of the per-filter random sequence.
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let commandIndex = 0;
  for (const [n, timestamp] of frames.entries()) {
    while (commandIndex < commands.length && commands[commandIndex]!.sample <= timestamp.start) {
      const command = commands[commandIndex++]!;
      try {
        parseFilterExpression(command.expression, "tremolo enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2 });
        enable = command.expression;
      } catch { /* Native asendcmd retains the previous expression after a rejected command. */ }
    }
    let enabled = true;
    if (enable !== undefined) {
      const variables = {
        n, t: timestamp.pts / sampleRate,
        pos: timestamp.pos !== undefined && timestamp.pos >= 0 ? timestamp.pos : NaN,
        w: 0, h: 0, E: Math.E, PI: Math.PI, PHI: (1 + Math.sqrt(5)) / 2
      };
      // FFmpeg evaluates on frame consumption and again before filter_frame.
      parseFilterExpression(enable, "tremolo enable", variables, undefined, registers, randomStates);
      enabled = Math.abs(parseFilterExpression(enable, "tremolo enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    for (let frame = timestamp.start; frame < timestamp.end; frame++) {
      let gain = 1;
      if (enabled) {
        const index = position % period;
        if (position < period) {
          const phase = (frequency * index / sampleRate + 0.25) % 1;
          envelope[index] = tremoloSine(2 * Math.PI * phase) * (1 - Math.abs(offset)) + offset;
        }
        gain = envelope[index]!;
      }
      for (let c = 0; c < channels.length; c++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        output[c]![frame] = channels[c]![frame]! * gain;
      }
      if (enabled) position++;
    }
  }
  return output;
}

// The oscillator only supplies angles in [0, 2π). Compensated Taylor terms
// avoid Math.sin's one-ULP errors in double PCM; each table entry is computed once.
function tremoloSine(angle: number): number {
  const quadrant = Math.round(angle / (Math.PI / 2));
  // Split π/2 so subtraction retains the low bits near quadrant boundaries.
  const reduced = add([angle - quadrant * 1.5707963267341256, 0], [-quadrant * 6.077100506506192e-11, 0]);
  const square = multiply(reduced, reduced);
  square[0] = -square[0];
  square[1] = -square[1];
  let term: [number, number] = quadrant % 2 ? [1, 0] : reduced;
  let sum = term;
  // |reduced| <= π/4; terms through degree 19 leave less than 4e-21 error.
  for (let n = quadrant % 2 ? 2 : 3; n <= 19; n += 2) {
    const product = multiply(term, square);
    const divisor = n * (n - 1);
    const high = product[0] / divisor;
    const remainder = add(product, multiply([-high, 0], [divisor, 0]));
    term = add([high, 0], [(remainder[0] + remainder[1]) / divisor, 0]);
    sum = add(sum, term);
  }
  return (quadrant === 2 || quadrant === 3 ? -1 : 1) * (sum[0] + sum[1]);
}

function multiply(a: [number, number], b: [number, number]): [number, number] {
  const product = a[0] * b[0];
  // Dekker's split separates each double into non-overlapping 26/27-bit parts.
  const splitA = 134217729 * a[0];
  const highA = splitA - (splitA - a[0]);
  const lowA = a[0] - highA;
  const splitB = 134217729 * b[0];
  const highB = splitB - (splitB - b[0]);
  const lowB = b[0] - highB;
  const error = ((highA * highB - product) + highA * lowB + lowA * highB) + lowA * lowB
    + a[0] * b[1] + a[1] * b[0];
  return [product, error];
}

function add(a: [number, number], b: [number, number]): [number, number] {
  const sum = a[0] + b[0];
  const part = sum - a[0];
  const error = (a[0] - (sum - part)) + (b[0] - part) + a[1] + b[1];
  const high = sum + error;
  return [high, error - (high - sum)];
}
