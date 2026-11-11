import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function compensateAudioDelay(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  commands: readonly { sample: number; action: string; expression: string }[],
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<Float64Array[]> {
  const names = ["mm", "cm", "m", "dry", "wet", "temp"];
  const defaults = [0, 0, 0, 0, 1, 20];
  const values = [...defaults];
  let enable: string | undefined;
  const registers = new Float64Array(10);
  const argument = filter.slice("compensationdelay=".length);
  const options = argument.split(":");
  if (options.at(-1) === "") options.pop();
  let optionPosition = 0;
  for (const option of options) {
    const separator = option.indexOf("=");
    const name = separator < 0 ? names[optionPosition] : option.slice(0, separator).trim();
    // Native restarts shorthand after named options, skipping the first slot
    // when it was just visited. The named key does not select the next slot.
    if (separator < 0) optionPosition++;
    else optionPosition = optionPosition === 0 ? 1 : 0;
    const raw = (separator < 0 ? option : option.slice(separator + 1)).trim();
    setOption(name!, raw);
  }
  function setOption(name: string, raw: string): void {
    if (name === "enable") {
      // Validation must not advance or corrupt the active expression's state.
      parseFilterExpression(raw, "compensationdelay enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0, PI: Math.PI, E: Math.E }, undefined, new Float64Array(10));
      enable = raw;
      registers.fill(0);
      return;
    }
    const key = names.indexOf(name);
    if (key < 0) throw new Error("compensationdelay: invalid option");
    const min = key === 5 ? -50 : 0;
    const max = [10, 100, 100, 1, 1, 50][key]!;
    const value = parseFilterExpression(raw, "compensationdelay", { min, max, default: defaults[key]! });
    if (value < min || value > max) {
      throw new Error("compensationdelay: invalid option");
    }
    values[key] = value;
    if (key < 3 || key === 5) {
      // Native integer options use nearest-even rounding after range validation.
      const lower = Math.floor(value);
      values[key] = value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
    }
  }
  const length = channels[0]?.length ?? 0;
  budget.allocateMemory(length * channels.length * Float64Array.BYTES_PER_ELEMENT);
  const output = channels.map(() => new Float64Array(length));
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      try {
        setOption(command.action, command.expression);
      } catch { /* Failed runtime commands leave the current option unchanged. */ }
    }
    // Recompute whole-sample delay after distance or temperature updates.
    const speed = 1.85325 * (643.95 * Math.sqrt((values[5]! + 273.15) / 273.15)) * 100000 / 3600;
    const delay = Math.trunc((values[2]! * 100 + values[1]! + values[0]! * 0.1) * (1 / speed) * sampleRate);
    let enabled = true;
    if (enable !== undefined) {
      const variables = {
        n, t: frame.pts / sampleRate, pos: frame.pos !== undefined && frame.pos >= 0 ? frame.pos : NaN,
        w: 0, h: 0, PI: Math.PI, E: Math.E
      };
      // FFmpeg evaluates on frame consumption and again before filter_frame.
      parseFilterExpression(enable, "compensationdelay enable", variables, undefined, registers);
      enabled = Math.abs(parseFilterExpression(enable, "compensationdelay enable", variables, undefined, registers)) >= 0.5;
    }
    for (let i = frame.start; i < frame.end; i++) {
      if (i % 1024 === 0) { budget.checkCpu(); await yieldTurn(signal); signal?.throwIfAborted(); }
      for (const [c, channel] of channels.entries()) {
        const sample = channel[i]!;
        output[c]![i] = enabled ? values[3]! * sample + values[4]! * (i < delay ? 0 : channel[i - delay]!) : sample;
        // Native keeps consuming input history while bypassed.
      }
    }
  }
  return output;
}
