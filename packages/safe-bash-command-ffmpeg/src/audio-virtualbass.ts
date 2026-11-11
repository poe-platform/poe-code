import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";
import { validateWeaveGenericOption } from "./weave-generic-option.js";

export async function virtualBassAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number,
  filter: string, budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; expression: string }[] = []
): Promise<(Float32Array | Float64Array)[]> {
  const options = { cutoff: 250, strength: 3 };
  const ranges = { cutoff: [100, 500], strength: [0.5, 3] };
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  let position = 0;
  for (const option of argument ? argument.split(":") : []) {
    if (!option) continue;
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["cutoff", "strength"][position] : option.slice(0, separator).trim();
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") {
      // Native advertises an internal timeline but always synthesizes the LFE.
      parseFilterExpression(value, "virtualbass enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0 });
    } else if (key === "threads" || key === "thread_type" || key === "extra_hw_frames") {
      validateWeaveGenericOption(key, value, "virtualbass");
    } else {
      if (key !== "cutoff" && key !== "strength") throw new Error(`virtualbass: unsupported option ${key}`);
      const [min, max] = ranges[key];
      const number = parseFilterExpression(value, "virtualbass", { min: min!, max: max!, default: key === "cutoff" ? 250 : 3 });
      if (Number.isNaN(number)) throw new Error(`virtualbass: invalid ${key}`);
      if (number < min! || number > max!) throw new RangeError(`virtualbass: invalid ${key}`);
      options[key] = number;
    }
  }
  if (channels.length !== 2) throw new Error("virtualbass: stereo input required");
  signal?.throwIfAborted();
  budget.checkCpu();
  const length = channels[0]!.length;
  budget.allocateMemory(length * 8);
  const lfe = new Float64Array(length);
  const g = Math.tan(Math.PI * options.cutoff / sampleRate);
  const a0 = 1 / (1 + g * (g + 1 / 0.707));
  const a1 = g * a0;
  const a2 = g * a1;
  let b0 = 0, b1 = 0;
  let strength = Math.PI / options.strength;
  let nextCommand = 0;
  for (let i = 0; i < length; i++) {
    if (i % 1024 === 0) {
      budget.checkCpu();
      await yieldTurn(signal);
      signal?.throwIfAborted();
    }
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= i) {
      const command = commands[nextCommand++]!;
      try {
        const value = parseFilterExpression(command.expression, "virtualbass", { min: 0.5, max: 3, default: 3 });
        if (value >= 0.5 && value <= 3) strength = Math.PI / value;
      } catch { /* Native continues after rejected runtime commands. */ }
    }
    const center = (channels[0]![i]! + channels[1]![i]!) * 0.5;
    const v3 = center - b1;
    const v1 = a0 * b0 + a1 * v3;
    const v2 = b1 + a1 * b0 + a2 * v3;
    b0 = 2 * v1 - b0;
    b1 = 2 * v2 - b1;
    const x = 0.9 * v2;
    const shaped = 2.5 * Math.atan(x) + 2.5 * Math.sqrt(1 - x * x) - 2.5;
    lfe[i] = Math.sin((shaped < 0 ? Math.sin(shaped) : shaped) * strength);
  }
  return [channels[0]!, channels[1]!, lfe];
}
