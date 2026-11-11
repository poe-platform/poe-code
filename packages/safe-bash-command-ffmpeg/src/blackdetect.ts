import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

type BlackFrame = MediaVideoFrame & { filterMetadata?: Record<string, string> };

export async function blackdetect(
  frames: BlackFrame[], argument: string, budget: MediaBudgetTracker,
  diagnostics: { timescale: number; pixelFormat: string | undefined; logLevel: number; write: (text: string) => Promise<void> },
  signal?: AbortSignal
): Promise<BlackFrame[]> {
  const options = { d: 2, pic_th: 0.98, pix_th: 0.1 };
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const [index, part] of (argument ? argument.split(":") : []).entries()) {
    const separator = part.indexOf("=");
    const name = separator < 0 ? ["d", "pic_th", "pix_th"][index] : part.slice(0, separator).trim();
    const key = name === "black_min_duration" ? "d" : name === "picture_black_ratio_th" ? "pic_th"
      : name === "pixel_black_th" ? "pix_th" : name;
    if (key !== "d" && key !== "pic_th" && key !== "pix_th" && key !== "threads") throw new Error(`blackdetect: unsupported option ${name}`);
    const maximum = key === "d" ? Number.MAX_VALUE : key === "threads" ? 2147483647 : 1;
    const value = parseFilterExpression(separator < 0 ? part : part.slice(separator + 1), "blackdetect", {
      default: key === "d" ? 2 : key === "pic_th" ? 0.98 : key === "threads" ? 0 : 0.1,
      min: 0, max: maximum, PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!Number.isFinite(value) || value < 0 || value > maximum) throw new Error(`blackdetect: invalid ${key}`);
    // Thread scheduling does not change software frame analysis.
    if (key !== "threads") options[key] = value;
  }

  const minimum = Math.trunc(options.d * diagnostics.timescale);
  const timestamp = (pts: number) => String(Number((pts / diagnostics.timescale).toPrecision(6)));
  let start: number | undefined;
  const report = async (end: number) => {
    if (start !== undefined && end - start >= minimum && diagnostics.logLevel >= 32) {
      await diagnostics.write(`black_start:${timestamp(start)} black_end:${timestamp(end)} black_duration:${timestamp(end - start)}\n`);
    }
  };
  const output: BlackFrame[] = [];
  for (const frame of frames) {
    const source = frame.native;
    const native = source && source.rgba === frame.data && source.width === frame.width && source.height === frame.height &&
      [0, 4, 5, 12, 13, 14, 29, 49, 68].includes(source.format) ? source : undefined;
    const depth = native?.format === 68 ? 10 : native && [29, 49].includes(native.format) ? 16 : 8;
    const full = native ? native.fullRange || [12, 13, 14].includes(native.format)
      : diagnostics.pixelFormat === "gray" || diagnostics.pixelFormat === "gray8";
    const threshold = Math.trunc(full ? options.pix_th * (2 ** depth - 1)
      : (16 + options.pix_th * 219) * 2 ** (depth - 8));
    const view = native && depth > 8 ? new DataView(native.pixels.buffer, native.pixels.byteOffset, native.pixels.byteLength) : undefined;
    const size = frame.width * frame.height;
    let black = 0;
    for (let i = 0; i < size; i++) {
      if (i % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const luma = native ? view ? view.getUint16(i * 2, native.format !== 29) : native.pixels[i]!
        : diagnostics.pixelFormat === "gray" || diagnostics.pixelFormat === "gray8" ? frame.data[i * 4]!
        : (8414 * frame.data[i * 4]! + 16519 * frame.data[i * 4 + 1]! + 3208 * frame.data[i * 4 + 2]! + (16 << 15) + 16640) >> 15;
      if (luma <= threshold) black++;
    }
    const pts = Math.round(frame.ptsSeconds * diagnostics.timescale);
    let key: string | undefined;
    if (black / size >= options.pic_th) {
      if (start === undefined) { start = pts; key = "lavfi.black_start"; }
    } else if (start !== undefined) {
      await report(pts);
      start = undefined;
      key = "lavfi.black_end";
    }
    budget.allocateMemory(key ? 128 : 8);
    output.push(key ? { ...frame, filterMetadata: { ...frame.filterMetadata, [key]: timestamp(pts) } } : frame);
  }
  // Native EOF reporting ends at the last frame's PTS and adds no end tag.
  const last = frames.at(-1);
  if (last) await report(Math.round(last.ptsSeconds * diagnostics.timescale));
  return output;
}
