/*
 * Recursive bilateral algorithm adapted from FFmpeg's vf_bilateral.c.
 * Copyright (c) 2017 Ming Yang
 * Copyright (c) 2019 Paul B Mahol
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import { parseFilterExpression } from "./filter-expression.js";

export async function bilateral(
  frames: MediaVideoFrame[], argument: string, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame[]> {
  const options = { sigmaS: 0.1, sigmaR: 0.1, planes: 1 };
  let enable: string | undefined;
  let position = 0;
  if (argument.endsWith(":")) argument = argument.slice(0, -1);
  for (const option of argument ? argument.split(":") : []) {
    const separator = option.indexOf("=");
    const key = separator < 0 ? ["sigmaS", "sigmaR", "planes"][position++] : option.slice(0, separator).trim();
    if (separator >= 0) position = position === 0 ? 1 : 0;
    const text = (separator < 0 ? option : option.slice(separator + 1)).trim();
    if (key === "enable") { enable = text; continue; }
    if (key !== "sigmaS" && key !== "sigmaR" && key !== "planes") throw new Error(`bilateral: unsupported option ${key}`);
    const max = key === "sigmaS" ? 512 : key === "sigmaR" ? 1 : 15;
    const value = parseFilterExpression(text, "bilateral", {
      min: 0, max, default: key === "planes" ? 1 : 0.1,
      PI: Math.PI, E: Math.E, PHI: (1 + Math.sqrt(5)) / 2
    });
    if (!text || !Number.isFinite(value) || value < 0 || value > max) throw new RangeError(`bilateral: ${key} must be from 0 to ${max}`);
    const lower = Math.floor(value);
    options[key] = key === "planes" ? (value - lower === 0.5 ? lower + lower % 2 : Math.round(value)) : Math.fround(value);
  }
  const f = Math.fround;
  const alpha = f(Math.exp(f(-f(Math.sqrt(2)) / f(options.sigmaS))));
  const inverseAlpha = f(1 - alpha);
  const output: MediaVideoFrame[] = [];
  const registers = new Float64Array(10);
  let work = 0;
  for (const [n, frame] of frames.entries()) {
    await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
    let enabled = true;
    if (enable !== undefined) {
      const variables = { n, t: frame.ptsSeconds, w: frame.width, h: frame.height, pos: frame.offset ?? NaN, NAN: NaN, INF: Infinity };
      parseFilterExpression(enable, "bilateral enable", variables, undefined, registers);
      enabled = Math.abs(parseFilterExpression(enable, "bilateral enable", variables, undefined, registers)) >= 0.5;
    }
    const packedAlpha = pixelFormat === "rgba" || pixelFormat === "bgra";
    if ((!enabled || !options.planes) && !packedAlpha) { output.push(frame); continue; }
    const source = frame.native;
    const native = source?.rgba === frame.data && source.width === frame.width && source.height === frame.height ? source : undefined;
    if (native && ![0, 4, 5, 8, 12, 13, 14, 29, 30, 34, 35, 49, 62, 68, 104, 105].includes(native.format)) {
      throw new Error("bilateral: unsupported native pixel format");
    }
    const gray = native && [8, 29, 30].includes(native.format);
    const packed = !native || [34, 35, 104, 105].includes(native.format);
    const channels = native && [34, 35].includes(native.format) ? 3 : 4;
    const depth = native && [29, 30, 34, 35, 49, 104, 105].includes(native.format) ? 16 : native && [62, 68].includes(native.format) ? 10 : 8;
    const sampleBytes = depth > 8 ? 2 : 1;
    const littleEndian = !native || ![29, 34, 104].includes(native.format);
    const hsub = native && [0, 4, 12, 13, 62].includes(native.format) ? 2 : 1;
    const vsub = native && [0, 12, 62].includes(native.format) ? 2 : 1;
    const input = native?.pixels ?? frame.data;
    budget.allocateMemory(input.length + (native ? frame.data.length : 0));
    const pixels = new Uint8Array(input.length);
    const scratchBytes = (frame.width * frame.height * 4 + 2 ** depth) * Float32Array.BYTES_PER_ELEMENT;
    budget.allocateMemory(scratchBytes);
    try {
      for (let start = 0; start < input.length; start += 65536) {
        await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
        pixels.set(input.subarray(start, start + 65536), start);
      }
      if (packedAlpha && !native) {
        // FFmpeg converts packed alpha through 16 bits before filtering GBR(A).
        for (let i = 3; i < pixels.length; i += 4) {
          if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          pixels[i] = Math.min(255, Math.round(input[i]! * 257 / 256));
        }
      }
      const inputView = new DataView(input.buffer, input.byteOffset, input.byteLength);
      const outputView = new DataView(pixels.buffer);
      const count = frame.width * frame.height;
      const horizontal = new Float32Array(count);
      const horizontalWeight = new Float32Array(count);
      const vertical = new Float32Array(count);
      const verticalWeight = new Float32Array(count);
      const range = new Float32Array(2 ** depth);
      const inverseRange = f(1 / f(f(options.sigmaR) * (range.length - 1)));
      for (let i = 0; i < range.length; i++) {
        if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
        range[i] = f(alpha * f(Math.exp(f(-i * inverseRange))));
      }
      let offset = 0;
      for (let plane = 0; plane < (gray ? 1 : packed ? channels : 3); plane++) {
        const width = Math.ceil(frame.width / (!packed && plane > 0 ? hsub : 1));
        const height = Math.ceil(frame.height / (!packed && plane > 0 ? vsub : 1));
        // RGB filters negotiate G, B, R, A plane order.
        const start = packed ? [1, 2, 0, 3][plane]! * sampleBytes : offset;
        const stride = (packed ? channels : 1) * sampleBytes;
        offset += width * height * sampleBytes;
        if (!enabled || !(options.planes & (1 << plane))) continue;
        const read = (i: number) => {
          const index = start + i * stride;
          if (sampleBytes === 2) return inputView.getUint16(index, littleEndian);
          const value = input[index]!;
          return packedAlpha && !native && plane === 3 ? Math.min(255, Math.round(value * 257 / 256)) : value;
        };
        for (let y = 0; y < height; y++) {
          const first = y * width, last = first + width - 1;
          let previous = read(first), weight = 1;
          horizontal[first] = previous;
          horizontalWeight[first] = weight;
          for (let i = first + 1; i <= last; i++) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const a = range[Math.abs(read(i) - read(i - 1))]!;
            horizontal[i] = previous = f(f(inverseAlpha * read(i)) + f(a * previous));
            horizontalWeight[i] = weight = f(inverseAlpha + f(a * weight));
          }
          previous = read(last); weight = 1;
          horizontal[last] = horizontal[last]! + previous;
          horizontalWeight[last] = horizontalWeight[last]! + weight;
          for (let i = last - 1; i >= first; i--) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const a = range[Math.abs(read(i) - read(i + 1))]!;
            previous = f(f(inverseAlpha * read(i)) + f(a * previous));
            weight = f(inverseAlpha + f(a * weight));
            horizontal[i] = horizontal[i]! + previous;
            horizontalWeight[i] = horizontalWeight[i]! + weight;
          }
        }
        for (let x = 0; x < width; x++) {
          const last = (height - 1) * width + x;
          vertical[x] = horizontal[x]!;
          verticalWeight[x] = horizontalWeight[x]!;
          for (let i = x + width; i <= last; i += width) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            const a = range[Math.abs(read(i) - read(i - width))]!;
            vertical[i] = f(inverseAlpha * horizontal[i]!) + f(a * vertical[i - width]!);
            verticalWeight[i] = f(inverseAlpha * horizontalWeight[i]!) + f(a * verticalWeight[i - width]!);
          }
          let previous = horizontal[last]!, weight = horizontalWeight[last]!;
          for (let i = last; i >= x; i -= width) {
            if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            if (i !== last) {
              const a = range[Math.abs(read(i) - read(i + width))]!;
              previous = f(f(inverseAlpha * horizontal[i]!) + f(a * previous));
              weight = f(f(inverseAlpha * horizontalWeight[i]!) + f(a * weight));
            }
            const value = f(f(vertical[i]! + previous) / f(verticalWeight[i]! + weight));
            const lower = Math.floor(value);
            const rounded = value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
            if (sampleBytes === 2) outputView.setUint16(start + i * stride, rounded, littleEndian);
            else pixels[start + i * stride] = rounded;
          }
        }
      }
      if (native) {
        const blurred = { ...native, pixels };
        const data = scaleVideoPicture({ ...frame, native: blurred }, frame.width, frame.height)!;
        output.push({ ...frame, data, native: { ...blurred, rgba: data } });
      } else {
        const blurred = { ...frame, data: pixels };
        delete blurred.native;
        output.push(blurred);
      }
    } finally {
      budget.releaseMemory(scratchBytes);
    }
  }
  return output;
}
