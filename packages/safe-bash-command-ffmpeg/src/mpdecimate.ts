import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function mpdecimate<T extends MediaVideoFrame>(
  frames: T[], argument: string, budget: MediaBudgetTracker,
  diagnostics: { timescale: number; logLevel: number; write: (text: string) => Promise<void> }, signal?: AbortSignal
): Promise<T[]> {
  const options = { max: 0, keep: 0, hi: 768, lo: 320, frac: Math.fround(0.33) };
  const defaults = { ...options };
  let position = 0;
  const fields = argument ? argument.split(":") : [];
  if (fields.at(-1) === "") fields.pop();
  for (const field of fields) {
    const separator = field.indexOf("=");
    const key = separator < 0 ? ["max", "keep", "hi", "lo", "frac"][position] : field.slice(0, separator).trim();
    // AVOption shorthand restarts after named fields, skipping the first slot
    // only when it was just visited, regardless of the named key.
    if (separator < 0) position++;
    else position = position === 0 ? 1 : 0;
    if (key !== "max" && key !== "keep" && key !== "hi" && key !== "lo" && key !== "frac") {
      throw new Error(`mpdecimate: unsupported option ${key}`);
    }
    const min = key === "keep" || key === "frac" ? 0 : -2147483648;
    const max = key === "frac" ? 1 : 2147483647;
    const value = parseFilterExpression((separator < 0 ? field : field.slice(separator + 1)).trim(), "mpdecimate", {
      default: defaults[key], min, max, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!Number.isFinite(value) || value < min || value > max) throw new RangeError(`mpdecimate: ${key} must be from ${min} to ${max}`);
    const lower = Math.floor(value);
    options[key] = key === "frac" ? Math.fround(value)
      : value - lower === 0.5 ? lower + Math.abs(lower % 2) : Math.round(value);
  }

  const retained: T[] = [];
  let dropCount = 0, keepCount = 0, work = 0;
  for (const frame of frames) {
    if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    const reference = retained.at(-1);
    let changed = !reference || frame.width !== reference.width || frame.height !== reference.height;
    if (reference && !changed) {
      if (options.keep > 0 && keepCount >= 0 && keepCount < options.keep) {
        keepCount++;
        changed = true;
      } else if (options.max > 0 && dropCount >= options.max || options.max < 0 && dropCount - 1 > options.max) {
        changed = true;
      } else {
        const source = frame.native, previous = reference.native;
        const native = source && previous && source.rgba === frame.data && previous.rgba === reference.data &&
          source.width === frame.width && source.height === frame.height &&
          previous.width === frame.width && previous.height === frame.height && source.format === previous.format &&
          [0, 4, 5, 8, 12, 13, 14].includes(source.format) ? source : undefined;
        const pixels = native ? native.pixels : frame.data;
        const before = native ? previous!.pixels : reference.data;
        let planeOffset = 0;
        for (let plane = 0; plane < (native?.format === 8 ? 1 : 3) && !changed; plane++) {
          const width = native && plane && [0, 4, 12, 13].includes(native.format) ? Math.ceil(frame.width / 2) : frame.width;
          const height = native && plane && [0, 12].includes(native.format) ? Math.ceil(frame.height / 2) : frame.height;
          const lowBlockLimit = Math.trunc(Math.fround(Math.floor(width / 16) * Math.floor(height / 16) * options.frac));
          let lowBlocks = 0;
          // Compare overlapping 8x8 blocks against the last retained frame.
          for (let y = 0; y + 8 <= height && !changed; y += 4) {
            for (let x = 8; x + 8 <= width && !changed; x += 4) {
              if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              let difference = 0;
              for (let row = y; row < y + 8; row++) {
                for (let column = x; column < x + 8; column++) {
                  const offset = native ? planeOffset + row * width + column : (row * width + column) * 4 + plane;
                  difference += Math.abs(pixels[offset]! - before[offset]!);
                }
              }
              changed = difference > options.hi || (difference > options.lo && ++lowBlocks > lowBlockLimit);
            }
          }
          planeOffset += width * height;
        }
      }
    }
    if (changed) {
      retained.push(frame);
      dropCount = Math.min(-1, dropCount - 1);
      if (keepCount < 0) keepCount = 0;
    } else {
      dropCount = Math.max(1, dropCount + 1);
      keepCount = -1;
    }
    if (diagnostics.logLevel >= 48) {
      await diagnostics.write(`[mpdecimate] ${changed ? "keep" : "drop"} pts:${Math.round(frame.ptsSeconds * diagnostics.timescale)} pts_time:${Number(frame.ptsSeconds.toPrecision(6))} drop_count:${dropCount} keep_count:${keepCount}\n`);
    }
  }
  return retained;
}
