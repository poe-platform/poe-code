import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function lutyuv(
  frames: MediaVideoFrame[], argument: string, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const expressions = ["clipval", "clipval", "clipval", "clipval"];
  let sawNamed = false;
  for (const [index, option] of (argument ? argument.split(":") : []).entries()) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["c0", "c1", "c2", "c3"][index] : option.slice(0, separator);
    const component = [["c0", "y", "r"], ["c1", "u", "g"], ["c2", "v", "b"], ["c3", "a"]]
      .findIndex(aliases => aliases.includes(key ?? ""));
    if (component < 0 || separator < 0 && sawNamed) throw new Error("lutyuv: unknown option");
    sawNamed ||= separator >= 0;
    expressions[component] = separator < 0 ? option : option.slice(separator + 1);
  }
  budget.allocateMemory(1024);
  try {
    const tables = new Uint8Array(1024);
    const output: MediaVideoFrame[] = [];
    let width = -1, height = -1, format = -1;
    for (const frame of frames) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      const source = frame.native;
      if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height ||
          ![0, 4, 5, 12, 13, 14, 33, 79].includes(source.format)) {
        throw new Error("lutyuv: requires 8-bit planar YUV input");
      }
      const alpha = source.format === 33 || source.format === 79;
      if (frame.width !== width || frame.height !== height || source.format !== format) {
        width = frame.width; height = frame.height; format = source.format;
        const limited = ![12, 13, 14].includes(format);
        for (let plane = 0; plane < (alpha ? 4 : 3); plane++) {
          await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
          const minval = limited && plane !== 3 ? 16 : 0;
          const maxval = limited && plane !== 3 ? (plane === 0 ? 235 : 240) : 255;
          for (let val = 0; val < 256; val++) {
            const result = parseFilterExpression(expressions[plane]!, "lutyuv", {
              val, minval, maxval, w: width, h: height,
              negval: Math.max(minval, Math.min(maxval, minval + maxval - val)),
              clipval: Math.max(minval, Math.min(maxval, val))
            });
            if (Number.isNaN(result)) throw new Error("lutyuv: expression evaluates to NaN");
            tables[plane * 256 + val] = Math.max(0, Math.min(255, Math.trunc(result)));
          }
        }
      }
      const lumaSize = width * height;
      const chromaSize = Math.ceil(width / ([0, 4, 12, 13, 33].includes(format) ? 2 : 1)) *
        Math.ceil(height / ([0, 12, 33].includes(format) ? 2 : 1));
      budget.allocateMemory(source.pixels.length + frame.data.length);
      const pixels = new Uint8Array(source.pixels.length);
      let offset = 0;
      for (let plane = 0; plane < (alpha ? 4 : 3); plane++) {
        const end = offset + (plane === 1 || plane === 2 ? chromaSize : lumaSize);
        for (; offset < end; offset++) {
          if (offset % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          pixels[offset] = tables[plane * 256 + source.pixels[offset]!]!;
        }
      }
      const native = { ...source, pixels };
      const data = scaleVideoPicture({ ...frame, native }, width, height)!;
      output.push({ ...frame, data, native: { ...native, rgba: data } });
    }
    return output;
  } finally {
    budget.releaseMemory(1024);
  }
}
