import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
/*
 * oscilloscope-font.json contains a CGA ROM glyph subset from FFmpeg's
 * libavutil/xga_font_data.c, licensed under LGPL-2.1-or-later:
 *
 * FFmpeg is free software; you can redistribute it and/or modify it under
 * the terms of the GNU Lesser General Public License as published by the
 * Free Software Foundation; either version 2.1 of the License, or (at your
 * option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public
 * License for more details: https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html
 */
import glyphs from "./oscilloscope-font.json" with { type: "json" };

// Default RGB oscilloscope: centered horizontal sampling, 80% width,
// 30% height, and an 80%-opaque background near the bottom of each frame.
export async function oscilloscope(
  frame: MediaVideoFrame, frameIndex: number, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const { width, height } = frame;
  const traceWidth = Math.trunc(Math.fround(Math.fround(0.8) * width));
  const traceHeight = Math.trunc(Math.fround(Math.fround(0.3) * height));
  const ox = Math.trunc((width - traceWidth) * 0.5);
  const oy = Math.trunc(Math.fround((height - traceHeight) * Math.fround(0.9)));
  const size = Math.trunc(Math.fround(Math.trunc(Math.hypot(width, height)) * Math.fround(0.8)));
  const cx = Math.trunc((width - 1) * 0.5), cy = Math.trunc((height - 1) * 0.5);
  const start = Math.max(0, Math.trunc(cx - size / 2));
  const end = Math.min(width - 1, Math.trunc(cx + size / 2));
  const count = end - start + 1;
  budget.allocateMemory(frame.data.byteLength + count * 3);
  const data = new Uint8Array(frame.data);
  const samples = new Uint8Array(count * 3);
  const checkpoint = async () => { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); };
  for (let i = 0; i < count; i++) {
    if (i % 4096 === 0) await checkpoint();
    const offset = (cy * width + start + i) * 4;
    for (let c = 0; c < 3; c++) {
      samples[i * 3 + c] = data[offset + c]!;
      data[offset + c] = 255 * ((i + 2 + frameIndex) & 1);
    }
  }
  for (let y = oy; y < Math.min(height, oy + traceHeight + 20); y++) {
    await checkpoint();
    for (let x = ox; x < ox + traceWidth; x++) for (let c = 0; c < 3; c++) {
      const offset = (y * width + x) * 4 + c;
      // FFmpeg drawutils uses 24-bit fixed-point alpha, truncating the result.
      data[offset] = Math.floor(data[offset]! * (0x1010101 - (0x10203 * 204 + 2)) / 0x1000000);
    }
  }
  const pixel = (x: number, y: number, color: readonly number[]) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    data.set(color, (y * width + x) * 4);
  };
  const gray = [128, 128, 128];
  if (height >= 10) {
    for (let x = 0; x < traceWidth; x++) {
      if (x % 4096 === 0) await checkpoint();
      if (x < traceWidth - 1) pixel(ox + x, oy, gray);
      for (let i = 1; i < 5; i++) pixel(ox + x, oy + Math.trunc(i * (traceHeight - 1) / 4), gray);
    }
    for (let y = 0; y < traceHeight; y++) {
      if (y % 4096 === 0) await checkpoint();
      for (let i = 0; i < 10; i++) pixel(ox + Math.trunc(i * (traceWidth - 1) / 10), oy + y, gray);
      pixel(ox + traceWidth - 1, oy + y, gray);
    }
  }
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
  let work = 0;
  for (let i = 1; i < count; i++) for (let c = 0; c < 3; c++) {
    let x = ox + Math.trunc(i * traceWidth / count);
    let y = oy + traceHeight - Math.trunc(samples[i * 3 + c]! * traceHeight / 256);
    const px = ox + Math.trunc((i - 1) * traceWidth / count);
    const py = oy + traceHeight - Math.trunc(samples[(i - 1) * 3 + c]! * traceHeight / 256);
    const dx = Math.abs(px - x), dy = Math.abs(py - y);
    const sx = x < px ? 1 : -1, sy = y < py ? 1 : -1;
    let error = Math.trunc((dx > dy ? dx : -dy) / 2);
    for (;;) {
      if (++work % 4096 === 0) await checkpoint();
      pixel(x, y, colors[c]!);
      if (x === px && y === py) break;
      const previous = error;
      if (previous > -dx) { error -= dy; x += sx; }
      if (previous < dy) { error += dx; y += sy; }
    }
  }
  if (traceHeight > 10 && traceWidth > 840) {
    for (let c = 0; c < 3; c++) {
      let sum = 0, min = 255, max = 0;
      for (let i = 0; i < count; i++) {
        if (i % 4096 === 0) await checkpoint();
        const value = samples[i * 3 + c]!;
        sum = Math.fround(sum + value);
        min = Math.min(min, value); max = Math.max(max, value);
      }
      const average = Math.fround(sum / count);
      // printf's nearest-even rounding at the one-decimal boundary.
      const scaled = average * 10;
      const rounded = scaled % 1 === 0.5 ? 2 * Math.round(scaled / 2) : Math.round(scaled);
      const text = `${"RGB"[c]} avg:${(rounded / 10).toFixed(1)} min:${min} max:${max}`;
      for (const [i, char] of [...text].entries()) {
        const glyph = glyphs[char as keyof typeof glyphs];
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          if (glyph[y]! & (128 >> x)) pixel(ox + 2 + c * 280 + i * 8 + x, oy + traceHeight + 4 + y, [255, 255, 255]);
        }
      }
    }
  }
  const { native: ignoredNative, ...rest } = frame;
  return { ...rest, data };
}
