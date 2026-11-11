import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function emphasizeAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const names = ["level_in", "level_out", "mode", "type"];
  const defaults = [1, 1, 0, 4];
  const values = [...defaults];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const options = argument ? argument.split(":") : [];
  if (options.at(-1) === "") options.pop();
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
    const key = names.indexOf(name!);
    if (key < 0) throw new Error(`aemphasis: unsupported option ${name}`);
    const constants: Record<string, number> = key === 2 ? { reproduction: 0, production: 1 }
      : key === 3 ? { col: 0, emi: 1, bsi: 2, riaa: 3, cd: 4, "50fm": 5, "75fm": 6, "50kf": 7, "75kf": 8 } : {};
    const maximum = [64, 64, 1, 8][key]!;
    const value = Object.hasOwn(constants, raw) ? constants[raw]! : parseFilterExpression(raw, "aemphasis", {
      ...constants, min: 0, max: maximum, default: defaults[key]!
    });
    if (!Number.isFinite(value) || value < 0 || value > maximum) {
      throw new RangeError(`aemphasis: invalid ${name}`);
    }
    // Native integer options round exact halves to even.
    const lower = Math.floor(value);
    values[key] = key < 2 ? value : value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
  }
  const [initialLevelIn, initialLevelOut, mode, type] = values;
  if (mode !== 0) throw new Error("aemphasis: unsupported mode (only reproduction is supported)");
  if (type !== 3 && type !== 4) throw new Error("aemphasis: unsupported type (only cd and riaa are supported)");

  // Bilinear transform of the CD (50/15 microsecond) or RIAA
  // (3180/318/75 microsecond) reproduction curve.
  const i = 1 / (type === 4 ? 0.000050 : 0.003180);
  const j = 1 / (type === 4 ? 0.000015 : 0.000318);
  const k = 1 / (type === 4 ? 0.0000001 : 0.000075);
  const t = 1 / sampleRate;
  const g = 1 / (4 + 2 * i * t + 2 * k * t + i * k * t * t);
  let a0 = (2 * t + j * t * t) * g;
  let a1 = 2 * j * t * t * g;
  let a2 = (-2 * t + j * t * t) * g;
  const b1 = (-8 + 2 * i * k * t * t) * g;
  const b2 = (4 - 2 * i * t - 2 * k * t + i * k * t * t) * g;
  // Normalize the emphasis stage to unity gain at 1 kHz.
  const zr = Math.cos(1000 * 2 * Math.PI / sampleRate);
  const zi = -Math.sin(1000 * 2 * Math.PI / sampleRate);
  const gain = Math.hypot(1 + b1 * zr + b2 * (zr * zr - zi * zi), b1 * zi + 2 * b2 * zr * zi)
    / Math.hypot(a0 + a1 * zr + a2 * (zr * zr - zi * zi), a1 * zi + 2 * a2 * zr * zi);
  a0 *= gain;
  a1 *= gain;
  a2 *= gain;

  // Native reproduction first applies a low-pass stage at 0.45 * rate,
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
  for (const [c, channel] of channels.entries()) {
    let low1 = 0, low2 = 0, emphasis1 = 0, emphasis2 = 0;
    let levelIn = initialLevelIn!, levelOut = initialLevelOut!;
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
          const value = parseFilterExpression(command.expression, "aemphasis", {});
          if (!Number.isFinite(value) || value < 0 || value > 64) continue;
          if (command.action === "level_in") levelIn = value;
          else if (command.action === "level_out") levelOut = value;
        } catch { /* Native retains the current gain after a rejected command. */ }
      }
      const low = channel[sample]! * levelIn! - low1 * lowB1 - low2 * lowB2;
      const input = low * lowA0 + low1 * lowA1 + low2 * lowA0;
      low2 = low1;
      low1 = low;
      const emphasis = input - emphasis1 * b1 - emphasis2 * b2;
      output[c]![sample] = (emphasis * a0 + emphasis1 * a1 + emphasis2 * a2) * levelOut!;
      emphasis2 = emphasis1;
      emphasis1 = emphasis;
    }
  }
  return output;
}
