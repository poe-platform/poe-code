import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function emphasizeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const names = ["level_in", "level_out", "mode", "type"];
  const defaults = [1, 1, 0, 4];
  const values = [...defaults];
  function parseOption(key: number, raw: string): number {
    const constants: Record<string, number> = key === 2 ? { reproduction: 0, production: 1 }
      : key === 3 ? { col: 0, emi: 1, bsi: 2, riaa: 3, cd: 4, "50fm": 5, "75fm": 6, "50kf": 7, "75kf": 8 } : {};
    const maximum = [64, 64, 1, 8][key]!;
    const value = Object.hasOwn(constants, raw) ? constants[raw]! : parseFilterExpression(raw, "aemphasis", {
      ...constants, min: 0, max: maximum, default: defaults[key]!, none: 0, all: -1,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    }, undefined, new Float64Array(10));
    if (!Number.isFinite(value) || value < 0 || value > maximum) {
      throw new RangeError(`aemphasis: invalid ${names[key]}`);
    }
    // Native integer options round exact halves to even.
    const lower = Math.floor(value);
    return key < 2 ? value : value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
  let enable: string | undefined;
  let position = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const name = separator < 0 ? names[position] : option.slice(0, separator).trim();
    // FFmpeg 7 restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (name === "threads" || name === "thread_type" || name === "extra_hw_frames") {
      const minimum = name === "extra_hw_frames" ? -1 : 0;
      const value = parseFilterExpression(raw, "aemphasis", name === "thread_type" ? { slice: 1 } : {
        min: minimum, max: 2147483647, default: minimum
      });
      if (name === "thread_type"
        ? !Number.isInteger(value) || value < -2147483648 || value > 4294967295
        : !Number.isFinite(value) || value < minimum || value > 2147483647) {
        throw new RangeError(`aemphasis: invalid ${name}`);
      }
      // Scheduling and hardware frame reservations do not change software PCM.
      continue;
    }
    if (name === "enable") {
      enable = raw;
      try {
        parseFilterExpression(enable, "aemphasis enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0, NAN: NaN, nan: NaN, INF: Infinity, inf: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 }, undefined, new Float64Array(10), []);
      } catch { throw new Error("aemphasis: invalid enable expression"); }
      continue;
    }
    const key = names.indexOf(name!);
    if (key < 0) throw new Error(`aemphasis: unsupported option ${name}`);
    values[key] = parseOption(key, raw);
  }
  const [initialLevelIn, initialLevelOut, initialMode, initialType] = values;
  const initialCoefficients = emphasisCoefficients(sampleRate, initialMode!, initialType!);

  // Native non-KF filtering first applies a low-pass stage at 0.45 * rate,
  // capped at 21 kHz, with Q = 0.707.
  const omega = 2 * Math.PI * Math.min(0.45 * sampleRate, 21000) / sampleRate;
  const alpha = Math.sin(omega) / (2 * 0.707);
  const inverse = 1 / (1 + alpha);
  const lowA0 = inverse * (1 - Math.cos(omega)) * 0.5;
  const lowA1 = 2 * lowA0;
  const lowB1 = -2 * Math.cos(omega) * inverse;
  const lowB2 = (1 - alpha) * inverse;

  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  budget.allocateMemory(frames.length);
  const enabled = new Uint8Array(frames.length);
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let nextEnableCommand = 0;
  for (const [n, frame] of frames.entries()) {
    if (n % 1024 === 0) { budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted(); }
    const variables = { n, t: frame.pts / sampleRate,
      pos: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN, w: 0, h: 0, NAN: NaN, nan: NaN, INF: Infinity, inf: Infinity, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 };
    while (nextEnableCommand < commands.length && commands[nextEnableCommand]!.sample <= frame.start) {
      const command = commands[nextEnableCommand++]!;
      if (command.action !== "enable") continue;
      try {
        parseFilterExpression(command.expression, "aemphasis enable", variables, undefined, new Float64Array(10), []);
        enable = command.expression;
        registers.fill(0);
        randomStates.length = 0;
      } catch { /* Native retains the current timeline after a rejected command. */ }
    }
    if (enable === undefined) { enabled[n] = 1; continue; }
    // Native evaluates the timeline on consumption and before filter_frame.
    parseFilterExpression(enable, "aemphasis enable", variables, undefined, registers, randomStates);
    enabled[n] = Number(Math.abs(parseFilterExpression(enable, "aemphasis enable", variables, undefined, registers, randomStates)) >= 0.5);
  }
  for (const [c, channel] of channels.entries()) {
    let frameIndex = 0;
    let low1 = 0, low2 = 0, emphasis1 = 0, emphasis2 = 0;
    let levelIn = initialLevelIn!, levelOut = initialLevelOut!;
    let mode = initialMode!, type = initialType!;
    let { useLowPass, a0, a1, a2, b1, b2 } = initialCoefficients;
    let commandIndex = 0;
    for (let sample = 0; sample < channel.length; sample++) {
      if (sample % 4096 === 0) {
        budget.checkCpu();
        await yieldTurn(signal);
        signal?.throwIfAborted();
      }
      while (commandIndex < commands.length && commands[commandIndex]!.sample <= sample) {
        const command = commands[commandIndex++]!;
        try {
          const key = names.indexOf(command.action);
          if (key < 0) continue;
          const value = parseOption(key, command.expression);
          if (key === 0) levelIn = value;
          else if (key === 1) levelOut = value;
          else {
            if (key === 2) mode = value;
            else type = value;
            // Reconfigure at the addressed frame while retaining each stage's history.
            ({ useLowPass, a0, a1, a2, b1, b2 } = emphasisCoefficients(sampleRate, mode, type));
          }
        } catch { /* Native retains the current settings after a rejected command. */ }
      }
      while (frameIndex < frames.length && sample >= frames[frameIndex]!.end) frameIndex++;
      if (!enabled[frameIndex]) {
        output[c]![sample] = channel[sample]!;
        continue;
      }
      let input = channel[sample]! * levelIn!;
      if (useLowPass) {
        const low = input - low1 * lowB1 - low2 * lowB2;
        input = low * lowA0 + low1 * lowA1 + low2 * lowA0;
        low2 = low1;
        low1 = low;
      }
      const emphasis = input - emphasis1 * b1 - emphasis2 * b2;
      output[c]![sample] = (emphasis * a0 + emphasis1 * a1 + emphasis2 * a2) * levelOut!;
      emphasis2 = emphasis1;
      emphasis1 = emphasis;
    }
  }
  return output;
}

function emphasisCoefficients(sampleRate: number, mode: number, type: number) {
  const useLowPass = type < 7;
  let a0, a1, a2, b1, b2;
  if (!useLowPass) {
    // FM-KF uses a high shelf without the low-pass or 1 kHz normalization.
    const tau = type === 7 ? 0.000050 : 0.000075;
    const frequency = 1 / (2 * Math.PI * tau);
    const nyquist = sampleRate * 0.5;
    const gain = Math.sqrt(1 + nyquist * nyquist / (frequency * frequency));
    const corner = Math.sqrt((gain - 1) * frequency * frequency);
    const q = Math.pow(sampleRate / (type === 7 ? 4750 : 3269) + 19.5, -0.25);
    const amplitude = Math.sqrt(mode === 0 ? 1 / gain : gain);
    const omega = corner * 2 * Math.PI / sampleRate;
    const alpha = Math.sin(omega) / (2 * q);
    const cosine = Math.cos(omega);
    const term = 2 * Math.sqrt(amplitude) * alpha;
    const inverse = 1 / (amplitude + 1 - (amplitude - 1) * cosine + term);
    a0 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine + term) * inverse;
    a1 = -2 * amplitude * (amplitude - 1 + (amplitude + 1) * cosine) * inverse;
    a2 = amplitude * (amplitude + 1 + (amplitude - 1) * cosine - term) * inverse;
    b1 = 2 * (amplitude - 1 - (amplitude + 1) * cosine) * inverse;
    b2 = (amplitude + 1 - (amplitude - 1) * cosine - term) * inverse;
  } else {
    // Analog corner frequencies in radians/second, in native type order:
    // Columbia, EMI, BSI, RIAA, CD, 50us FM, 75us FM.
    const [i, j, k] = ([
      [100 * 2 * Math.PI, 500 * 2 * Math.PI, 1590 * 2 * Math.PI],
      [70 * 2 * Math.PI, 500 * 2 * Math.PI, 2500 * 2 * Math.PI],
      [50 * 2 * Math.PI, 353 * 2 * Math.PI, 3180 * 2 * Math.PI],
      [1 / 0.003180, 1 / 0.000318, 1 / 0.000075],
      [1 / 0.000050, 1 / 0.000015, 1 / 0.0000001],
      [1 / 0.000050, 1 / (0.000050 / 20), 1 / (0.000050 / 50)],
      [1 / 0.000075, 1 / (0.000075 / 20), 1 / (0.000075 / 50)]
    ] as const)[type]!;
    const t = 1 / sampleRate;
    if (mode === 0) {
      const g = 1 / (4 + 2 * i * t + 2 * k * t + i * k * t * t);
      a0 = (2 * t + j * t * t) * g;
      a1 = 2 * j * t * t * g;
      a2 = (-2 * t + j * t * t) * g;
      b1 = (-8 + 2 * i * k * t * t) * g;
      b2 = (4 - 2 * i * t - 2 * k * t + i * k * t * t) * g;
    } else {
      const g = 1 / (2 * t + j * t * t);
      a0 = (4 + 2 * i * t + 2 * k * t + i * k * t * t) * g;
      a1 = (-8 + 2 * i * k * t * t) * g;
      a2 = (4 - 2 * i * t - 2 * k * t + i * k * t * t) * g;
      b1 = 2 * j * t * t * g;
      b2 = (-2 * t + j * t * t) * g;
    }
    // Normalize the emphasis stage to unity gain at 1 kHz.
    const zr = Math.cos(1000 * 2 * Math.PI / sampleRate);
    const zi = -Math.sin(1000 * 2 * Math.PI / sampleRate);
    // Preserve native division order: its reciprocal rounds separately.
    const gain = 1 / (Math.hypot(a0 + a1 * zr + a2 * (zr * zr - zi * zi), a1 * zi + 2 * a2 * zr * zi)
      / Math.hypot(1 + b1 * zr + b2 * (zr * zr - zi * zi), b1 * zi + 2 * b2 * zr * zi));
    a0 *= gain;
    a1 *= gain;
    a2 *= gain;
  }

  return { useLowPass, a0, a1, a2, b1, b2 };
}
