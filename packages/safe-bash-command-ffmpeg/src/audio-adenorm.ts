import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function adenormAudio(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  let enable: string | undefined;
  let level = -351;
  let type = "dc";
  let positionalIndex = 0;
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  const parts = argument ? argument.split(":") : [];
  if (argument.endsWith(":")) parts.pop();
  for (const option of parts) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["level", "type"][positionalIndex++] : option.slice(0, separator).trim();
    const value = option.slice(separator + 1).trim();
    if (key === "enable") {
      enable = value;
      parseFilterExpression(enable, "adenorm enable", { n: 0, t: 0, pos: NaN, w: 0, h: 0 }, undefined, new Float64Array(10), []);
    } else if (key === "level") {
      level = parseFilterExpression(value, "adenorm", {});
      if (!value || !Number.isFinite(level) || level < -451 || level > -90) {
        throw new RangeError("adenorm: invalid level");
      }
    } else if (key === "type") {
      type = ({ "0": "dc", "1": "ac", "2": "square", "3": "pulse" } as Record<string, string>)[value] ?? value;
      if (!["dc", "ac", "square", "pulse"].includes(type)) throw new Error(`adenorm: unsupported type ${value}`);
    } else {
      throw new Error(`adenorm: unsupported option ${key}`);
    }
  }
  let amplitude = 10 ** (level / 20);
  budget.allocateMemory(channels.reduce((sum, channel) => sum + channel.length * 8, 0));
  const output = channels.map(channel => new Float64Array(channel.length));
  budget.allocateMemory(80);
  const registers = new Float64Array(10);
  const randomStates: BigUint64Array[] = [];
  let work = 0;
  let processed = 0;
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame.start) {
      const command = commands[nextCommand++]!;
      if (command.action === "type") {
        const value = ({ "0": "dc", "1": "ac", "2": "square", "3": "pulse" } as Record<string, string>)[command.expression] ?? command.expression;
        if (["dc", "ac", "square", "pulse"].includes(value)) type = value;
      } else if (command.action === "level") {
        try {
          const value = parseFilterExpression(command.expression, "adenorm", {});
          if (Number.isFinite(value) && value >= -451 && value <= -90) amplitude = 10 ** (value / 20);
        } catch { /* Rejected runtime commands leave the current setting unchanged. */ }
      }
    }
    let enabled = true;
    if (enable !== undefined) {
      const variables = { n, t: frame.pts / sampleRate, pos: frame.pos ?? NaN, w: 0, h: 0 };
      // Generic timelines evaluate on consumption and again before filter_frame.
      parseFilterExpression(enable, "adenorm enable", variables, undefined, registers, randomStates);
      enabled = Math.abs(parseFilterExpression(enable, "adenorm enable", variables, undefined, registers, randomStates)) >= 0.5;
    }
    for (const [c, channel] of channels.entries()) {
      for (let i = frame.start; i < frame.end; i++) {
        if (work++ % 4096 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        const position = processed + i - frame.start;
        let noise = amplitude;
        if (type === "ac" && position % 2) noise = -amplitude;
        else if (type === "square" && Math.floor(position / 256) % 2) noise = -amplitude;
        else if (type === "pulse" && position % 256) noise = 0;
        output[c]![i] = enabled ? channel[i]! + noise : channel[i]!;
      }
    }
    if (enabled) processed += frame.end - frame.start;
  }
  return output;
}
