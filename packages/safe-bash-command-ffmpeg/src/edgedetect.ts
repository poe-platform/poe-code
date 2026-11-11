import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function edgedetect(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<{ frames: MediaVideoFrame[]; pixelFormat: string }> {
  const options = { high: 50 / 255, low: 20 / 255, mode: 0, planes: 7 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const part of argument ? argument.split(":") : []) {
    const separator = part.indexOf("=");
    const key = separator < 0 ? ["high", "low", "mode", "planes"][position] : part.slice(0, separator).trim();
    position = separator < 0 ? position + 1 : position === 0 ? 1 : 0;
    const text = (separator < 0 ? part : part.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "high" && key !== "low" && key !== "mode" && key !== "planes") {
      throw new Error(`edgedetect: unsupported option ${key ?? part}`);
    }
    if (key === "planes") {
      let cursor = 0;
      do {
        const operation = text[cursor] === "+" || text[cursor] === "-" ? text[cursor++] : "=";
        const start = cursor;
        while (cursor < text.length && text[cursor] !== "+" && text[cursor] !== "-") cursor++;
        const bits = parseFilterExpression(text.slice(start, cursor), "edgedetect planes", {
          y: 1, u: 2, v: 4, r: 4, g: 1, b: 2, none: 0, all: -1
        });
        if (!Number.isInteger(bits) || bits < -2147483648 || bits > 4294967295) throw new Error("edgedetect: invalid planes");
        options.planes = operation === "+" ? options.planes | bits : operation === "-" ? options.planes & ~bits : bits;
      } while (cursor < text.length);
      continue;
    }
    const max = key === "mode" ? 2 : 1;
    const value = parseFilterExpression(text, "edgedetect", {
      min: 0, max, default: options[key],
      ...(key === "mode" ? { wires: 0, colormix: 1, canny: 2 } : {})
    });
    if (!text || !Number.isFinite(value) || value < 0 || value > max) {
      throw new Error(`edgedetect: invalid ${key}`);
    }
    options[key] = key === "mode" ? (value % 1 === 0.5 ? 2 * Math.round(value / 2) : Math.round(value)) : value;
  }
  const gray = options.mode === 0 || pixelFormat === "gray" || pixelFormat === "gray8";
  const yuv = options.mode === 2 && ["yuv420p", "yuv422p", "yuv444p"].includes(pixelFormat ?? "");
  const outputFormat = gray ? "gray" : yuv ? pixelFormat! : "gbrp";
  if (pixelFormat && !["gray", "gray8", "rgb24", "bgr24", "rgba", "bgra", "gbrp", "gbrap", "yuv420p", "yuv422p", "yuv444p"].includes(pixelFormat)) {
    throw new Error("edgedetect: unsupported pixel format");
  }
  const low = Math.round(options.low * 255), high = Math.round(options.high * 255);
  const output: MediaVideoFrame[] = [];
  // Integer Gaussian kernel, sigma 1.4, with a two-pixel unfiltered border.
  const kernel = [[2, 4, 5, 4, 2], [4, 9, 12, 9, 4], [5, 12, 15, 12, 5], [4, 9, 12, 9, 4], [2, 4, 5, 4, 2]];
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    const { width, height, native, ...rest } = frame;
    const source = native?.rgba === frame.data && native.width === width && native.height === height ? native : undefined;
    const planar = source && [0, 4, 5, 12, 13, 14].includes(source.format) ? source : undefined;
    if (yuv && !planar) throw new Error("edgedetect: requires retained planar YUV samples");
    const enabled = enable === undefined || Math.abs(parseFilterExpression(enable, "edgedetect enable", {
      n, t: frame.ptsSeconds, w: width, h: height, pos: frame.offset ?? NaN
    })) >= 0.5;
    const count = width * height;
    budget.allocateMemory(count * 4 + (yuv ? planar!.pixels.length : gray ? count : 0));
    let data = yuv ? frame.data : new Uint8Array(count * 4);
    const pixels = yuv ? new Uint8Array(planar!.pixels) : gray ? new Uint8Array(count) : undefined;
    // Reuse one plane's workspace, releasing it once this frame is rendered.
    const scratchBytes = count * 6;
    budget.allocateMemory(scratchBytes);
    try {
      const input = new Uint8Array(count);
      const blurred = new Uint8Array(count);
      const gradients = new Uint16Array(count);
      const directions = new Uint8Array(count);
      const maxima = new Uint8Array(count);
      let planeOffset = 0;
      for (let plane = 0; plane < (gray ? 1 : 3); plane++) {
        const pw = Math.ceil(width / (yuv && plane > 0 && pixelFormat !== "yuv444p" ? 2 : 1));
        const ph = Math.ceil(height / (yuv && plane > 0 && pixelFormat === "yuv420p" ? 2 : 1));
        const size = pw * ph;
        const channel = [1, 2, 0][plane]!;
        for (let i = 0; i < size; i++) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          input[i] = yuv ? planar!.pixels[planeOffset + i]!
            : gray ? planar ? Math.max(0, Math.min(255, Math.round((planar.pixels[i]! - 16) * 255 / 219)))
              : Math.round(0.299 * frame.data[4 * i]! + 0.587 * frame.data[4 * i + 1]! + 0.114 * frame.data[4 * i + 2]!)
            : frame.data[4 * i + channel]!;
          blurred[i] = input[i]!;
          gradients[i] = maxima[i] = 0;
        }
        const filter = enabled && (options.planes & (1 << plane));
        if (filter) {
          for (let y = 2; y < ph - 2; y++) {
            for (let x = 2; x < pw - 2; x++) {
              if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              let sum = 0;
              for (let ky = 0; ky < 5; ky++) {
                for (let kx = 0; kx < 5; kx++) sum += kernel[ky]![kx]! * input[(y + ky - 2) * pw + x + kx - 2]!;
              }
              blurred[y * pw + x] = Math.floor(sum / 159);
            }
          }
          for (let y = 1; y < ph - 1; y++) {
            for (let x = 1; x < pw - 1; x++) {
              if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              const i = y * pw + x;
              let gx = blurred[i - pw + 1]! + 2 * blurred[i + 1]! + blurred[i + pw + 1]!
                - blurred[i - pw - 1]! - 2 * blurred[i - 1]! - blurred[i + pw - 1]!;
              let gy = blurred[i + pw - 1]! + 2 * blurred[i + pw]! + blurred[i + pw + 1]!
                - blurred[i - pw - 1]! - 2 * blurred[i - pw]! - blurred[i - pw + 1]!;
              gradients[i] = Math.abs(gx) + Math.abs(gy);
              if (gx < 0) { gx = -gx; gy = -gy; }
              gy *= 65536;
              // Direction is quantized to horizontal, vertical, or either diagonal.
              directions[i] = gy > -27146 * gx && gy < 27146 * gx ? 0
                : gy > -158218 * gx && gy < -27146 * gx ? 1
                : gy > 27146 * gx && gy < 158218 * gx ? 2 : 3;
            }
          }
          for (let y = 1; y < ph - 1; y++) {
            for (let x = 1; x < pw - 1; x++) {
              if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              const i = y * pw + x;
              const delta = directions[i] === 0 ? 1 : directions[i] === 1 ? pw - 1 : directions[i] === 2 ? pw + 1 : pw;
              const gradient = gradients[i]!;
              if (gradient > gradients[i - delta]! && gradient > gradients[i + delta]!) maxima[i] = Math.min(255, gradient);
            }
          }
        }
        for (let y = 0; y < ph; y++) {
          for (let x = 0; x < pw; x++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const i = y * pw + x;
            let value = input[i]!;
            if (filter) {
              const edge = maxima[i]!;
              let keep = edge > high;
              if (!keep && edge > low && x > 0 && x < pw - 1 && y > 0 && y < ph - 1) {
                // Only immediate strong neighbors promote weak edges; no recursive flood fill.
                for (let dy = -1; dy <= 1; dy++) {
                  for (let dx = -1; dx <= 1; dx++) keep ||= maxima[i + dy * pw + dx]! > high;
                }
              }
              value = keep ? edge : 0;
              if (options.mode === 1) value = (value + input[i]!) >> 1;
            }
            if (pixels) pixels[planeOffset + i] = value;
            if (gray) data[4 * i] = data[4 * i + 1] = data[4 * i + 2] = value;
            else if (!yuv) data[4 * i + channel] = value;
            if (!yuv) data[4 * i + 3] = 255;
          }
        }
        planeOffset += size;
      }
      if (pixels) {
        const filtered = { ...(yuv ? planar! : { format: 8, fullRange: 1, colorspace: 5 }), width, height, pixels, rgba: data };
        if (yuv) data = scaleVideoPicture({ ...frame, native: filtered }, width, height)!;
        output.push({ ...rest, width, height, data, native: { ...filtered, rgba: data } });
      } else output.push({ ...rest, width, height, data });
    } finally {
      budget.releaseMemory(scratchBytes);
    }
  }
  return { frames: output, pixelFormat: outputFormat };
}
