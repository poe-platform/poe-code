import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function lagfun(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal,
  commands: readonly { time: number; action: string; expression: string }[] = []
): Promise<MediaVideoFrame[]> {
  let decay = Math.fround(0.95);
  let planes = 15;
  let enable: string | undefined;
  const update = (key: string | undefined, expression: string): void => {
    if (key !== "decay" && key !== "planes") throw new Error(`lagfun: unsupported option ${key}`);
    if (key === "planes") {
      const flags = expression.trim();
      let mask = flags.startsWith("+") || flags.startsWith("-") ? planes : 0;
      let offset = 0;
      do {
        const remove = flags[offset] === "-";
        if (remove || flags[offset] === "+") offset++;
        const start = offset;
        if (flags[offset] === "+" || flags[offset] === "-") offset++;
        while (offset < flags.length && flags[offset] !== "+" && flags[offset] !== "-") offset++;
        const bits = parseFilterExpression(flags.slice(start, offset), "lagfun", {
          all: -1, none: 0, default: 15, min: 0, max: 15
        });
        if (!Number.isInteger(bits) || bits < -2147483648 || bits > 4294967295) {
          throw new RangeError("lagfun: invalid planes");
        }
        mask = remove ? mask & ~bits : mask | bits;
      } while (offset < flags.length);
      planes = mask;
    } else {
      const value = parseFilterExpression(expression, "lagfun", {
        min: 0, max: 1, default: 0.95, none: 0
      }, undefined, new Float64Array(10), []);
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw new RangeError("lagfun: invalid decay");
      }
      decay = Math.fround(value);
    }
  };
  let position = 0;
  const parts = argument ? argument.split(":") : [];
  if (parts.at(-1) === "") parts.pop();
  for (const part of parts) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["decay", "planes"][position++] : part.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    if (key === "enable") { enable = part.slice(separator + 1).trim(); continue; }
    update(key, separator < 0 ? part : part.slice(separator + 1));
  }

  const output: MediaVideoFrame[] = [];
  const history: Float32Array[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  let nextCommand = 0;
  for (const [n, frame] of frames.entries()) {
    signal?.throwIfAborted();
    budget.checkCpu();
    while (nextCommand < commands.length && commands[nextCommand]!.time <= frame.ptsSeconds) {
      if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      const command = commands[nextCommand++]!;
      try {
        update(command.action, command.expression);
      } catch {
        // Rejected runtime commands retain the active setting and frame history.
      }
    }
    const retained = frame.native;
    const native = retained?.rgba === frame.data && retained.width === frame.width &&
      retained.height === frame.height ? retained : undefined;
    const gray = native ? [8, 29, 30].includes(native.format) : pixelFormat === "gray" || pixelFormat === "gray8";
    const planar = native && [0, 4, 5, 12, 13, 14, 79].includes(native.format) ? native : undefined;
    if (!gray && !planar && !["rgb24", "bgr24", "gbrp"].includes(pixelFormat ?? "")) {
      throw new Error("lagfun: only 8-bit or 16-bit grayscale, 8-bit planar YUV and RGB input is supported");
    }
    let enabled = true;
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN };
      // FFmpeg evaluates the timeline twice per frame, retaining expression registers.
      parseFilterExpression(enable, "lagfun enable", variables, undefined, registers);
      enabled = Math.abs(parseFilterExpression(enable, "lagfun enable", variables, undefined, registers)) >= 0.5;
    }
    const planeCount = gray ? 1 : planar?.format === 79 ? 4 : 3;
    if (!(planes & ((1 << planeCount) - 1))) {
      output.push(frame);
      continue;
    }
    if (output.length && (frame.width !== output[0]!.width || frame.height !== output[0]!.height)) {
      throw new Error("lagfun: frames must have matching dimensions");
    }
    const length = frame.width * frame.height;
    const source = planar ?? (gray ? native : undefined);
    const sampleBytes = gray && native && [29, 30].includes(native.format) ? 2 : 1;
    const littleEndian = native?.format === 30;
    const byteLength = source?.pixels.length ?? (gray ? length : frame.data.length);
    budget.allocateMemory(byteLength + (source || gray ? frame.data.length : 0));
    const pixels = source ? new Uint8Array(source.pixels) : gray ? new Uint8Array(length) : new Uint8Array(frame.data);
    const view = new DataView(pixels.buffer);
    let offset = 0;
    for (let plane = 0; plane < planeCount; plane++) {
      const chroma = planar && (plane === 1 || plane === 2);
      const width = chroma && [0, 4, 12, 13].includes(planar.format) ? Math.ceil(frame.width / 2) : frame.width;
      const height = chroma && [0, 12].includes(planar.format) ? Math.ceil(frame.height / 2) : frame.height;
      const size = width * height;
      if (planes & (1 << plane)) {
        if (!history[plane]) {
          budget.allocateMemory(size * 4);
          history[plane] = new Float32Array(size);
        }
        const previous = history[plane]!;
        for (let index = 0; index < size; index++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          // Packed RGB negotiates to planar GBR; retain the existing RGBA storage.
          const position = source || gray ? offset + index * sampleBytes : index * 4 + [1, 2, 0][plane]!;
          const sample = sampleBytes === 2 ? view.getUint16(position, littleEndian)
            : gray && !source ? frame.data[index * 4]! : pixels[position]!;
          // Retain float history; FFmpeg rounds only the emitted sample, with ties to even.
          const value = Math.max(sample, Math.fround(previous[index]! * decay));
          previous[index] = value;
          const rounded = value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value);
          if (sampleBytes === 2) view.setUint16(position, rounded, littleEndian);
          else pixels[position] = rounded;
        }
      }
      offset += size * sampleBytes;
    }
    if (source || gray) {
      const filtered = source ? { ...source, pixels } : {
        pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 8, colorspace: 5, fullRange: 1
      };
      const data = scaleVideoPicture({ ...frame, native: filtered }, frame.width, frame.height)!;
      output.push({ ...frame, data, native: { ...filtered, rgba: data } });
    } else {
      const filtered = { ...frame, data: pixels };
      delete filtered.native;
      output.push(filtered);
    }
  }
  for (const plane of history) if (plane) budget.releaseMemory(plane.byteLength);
  return output;
}
