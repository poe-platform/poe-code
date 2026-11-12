import type { MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function shiftAudioPhase(
  channels: readonly (Float32Array | Float64Array)[], sampleRate: number, filter: string,
  format: string, frames: readonly { start: number; end: number; pts: number; pos?: number | undefined }[],
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { sample: number; action: string; expression: string }[] = []
): Promise<Float64Array[]> {
  const frequencyShift = filter.split("=", 1)[0] === "afreqshift";
  const name = frequencyShift ? "afreqshift" : "aphaseshift";
  let enable: string | undefined;
  const options = { shift: 0, level: 1, order: 8 };
  const names = Object.keys(options) as (keyof typeof options)[];
  const argument = filter.includes("=") ? filter.slice(filter.indexOf("=") + 1) : "";
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? names[index] : option.slice(0, separator).trim() as keyof typeof options | "enable";
    if (key === "enable") {
      enable = option.slice(separator + 1).trim();
      parseFilterExpression(enable, `${name} enable`, { n: 0, t: 0, pos: NaN, w: 0, h: 0 });
      continue;
    }
    if (!key || !Object.hasOwn(options, key)) throw new Error(`${name}: unsupported option ${key}`);
    const value = (separator < 0 ? option : option.slice(separator + 1)).trim();
    const number = parseFilterExpression(value, name, { PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2 });
    const min = key === "shift" ? (frequencyShift ? -2147483647 : -1) : key === "order" ? 1 : 0;
    const max = key === "shift" && frequencyShift ? 2147483647 : key === "order" ? 16 : 1;
    if (frequencyShift && (number < min || number > max)) throw new RangeError(`${name}: invalid ${key}`);
    if (!value || !Number.isFinite(number) || number < min || number > max) {
      throw new Error(`${name}: invalid ${key}`);
    }
    options[key] = number;
    if (key === "order") options.order = number % 1 === 0.5 ? Math.round(number / 2) * 2 : Math.round(number);
  }

  const length = channels[0]?.length ?? 0;
  // Keep every stage history when runtime order changes, as native FFmpeg does.
  const capacity = 16 * 2;
  signal?.throwIfAborted();
  budget.checkCpu();
  budget.allocateMemory((length * channels.length + capacity * (channels.length * 4 + 1)) * 8);
  const round = format === "dblp" ? (value: number) => value : Math.fround;
  const coefficients = new Float64Array(capacity);
  // Elliptic all-pass design with a 40 Hz transition, split into even/odd paths.
  const k = Math.tan((1 - 80 / sampleRate) * Math.PI / 4) ** 2;
  const root = (1 - k * k) ** 0.25;
  const e = 0.5 * (1 - root) / (1 + root);
  const e4 = e ** 4;
  const q = e * (1 + e4 * (2 + e4 * (15 + 150 * e4)));
  function updateCoefficients(order: number) {
    const stages = order * 2;
    for (let stage = 0; stage < stages; stage++) {
      const angle = (stage + 1) * Math.PI / (stages * 2 + 1);
      let numerator = 0, denominator = 0.5;
      for (let i = 0; i < 64; i++) {
        const term = q ** (i * (i + 1)) * Math.sin((2 * i + 1) * angle) * (i % 2 ? -1 : 1);
        numerator += term;
        if (Math.abs(term) <= 1e-100) break;
      }
      for (let i = 1; i < 64; i++) {
        const term = q ** (i * i) * Math.cos(2 * i * angle) * (i % 2 ? -1 : 1);
        denominator += term;
        if (Math.abs(term) <= 1e-100) break;
      }
      const w2 = (numerator * q ** 0.25 / denominator) ** 2;
      const x = Math.sqrt((1 - w2 * k) * (1 - w2 / k)) / (1 + w2);
      coefficients[Math.floor(stage / 2) + (stage % 2) * order] = round((1 - x) / (1 + x));
    }
  }
  const step = round(1 / sampleRate);
  const output: Float64Array[] = [];
  let work = 0;
  for (const channel of channels) {
    let order = options.order;
    let stages = order * 2;
    updateCoefficients(order);
    let level = round(options.level), shift = round(options.shift), nextCommand = 0;
    const angle = round(options.shift * Math.PI);
    let cosine = round(Math.cos(angle)), sine = round(Math.sin(angle));
    const samples = new Float64Array(length);
    const previousInput = new Float64Array(capacity), olderInput = new Float64Array(capacity);
    const previousOutput = new Float64Array(capacity), olderOutput = new Float64Array(capacity);
    let position = 0;
    for (const [n, timestamp] of frames.entries()) {
      const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, `${name} enable`, {
        n, t: timestamp.pts / sampleRate, pos: timestamp.pos ?? NaN, w: 0, h: 0
      })) >= 0.5;
      for (let frame = timestamp.start; frame < timestamp.end; frame++) {
        if (++work % 1024 === 0) {
          await yieldTurn(signal);
          signal?.throwIfAborted();
          budget.checkCpu();
        }
        // Generic timeline bypass freezes the all-pass history and oscillator.
        if (!enabled) {
          samples[frame] = round(channel[frame]!);
          continue;
        }
        while (nextCommand < commands.length && commands[nextCommand]!.sample <= frame) {
          const command = commands[nextCommand++]!;
          try {
            const value = parseFilterExpression(command.expression, name, {});
            if (!Number.isFinite(value)) continue;
            if (command.action === "order" && value >= 1 && value <= 16) {
              const nextOrder = value % 1 === 0.5 ? Math.round(value / 2) * 2 : Math.round(value);
              if (nextOrder !== order) {
                order = nextOrder;
                stages = order * 2;
                updateCoefficients(order);
              }
            }
            if (command.action === "level" && value >= 0 && value <= 1) level = round(value);
            if (command.action === "shift" && Math.abs(value) <= (frequencyShift ? 2147483647 : 1)) {
              shift = round(value);
              const angle = round(value * Math.PI);
              cosine = round(Math.cos(angle));
              sine = round(Math.sin(angle));
            }
          } catch { /* Native ignores rejected runtime commands and keeps the previous setting. */ }
        }
        let inPhase = 0;
        let value = round(channel[frame]!);
        for (let stage = 0; stage < stages; stage++) {
          if (++work % 1024 === 0) {
            await yieldTurn(signal);
            signal?.throwIfAborted();
            budget.checkCpu();
          }
          if (stage === order) {
            inPhase = value;
            value = round(channel[frame]!);
          }
          const next = round(round(coefficients[stage]! * round(value + olderOutput[stage]!)) - olderInput[stage]!);
          olderInput[stage] = previousInput[stage]!;
          previousInput[stage] = value;
          olderOutput[stage] = previousOutput[stage]!;
          previousOutput[stage] = next;
          value = next;
        }
        if (frequencyShift) {
          const phase = round(2 * Math.PI * (round(round(shift * position) * step) % 1));
          cosine = round(Math.cos(phase));
          sine = round(Math.sin(phase));
        }
        // The quadrature path has an extra one-sample delay.
        samples[frame] = round(round(round(inPhase * cosine) - round(olderOutput[stages - 1]! * sine)) * level);
        position++;
      }
    }
    output.push(samples);
  }
  return output;
}
