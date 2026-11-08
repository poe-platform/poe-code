/*
 * Copyright (c) 2000 John Walker
 * Copyright (c) 2016 Paul B Mahol
 *
 * This file is part of FFmpeg.
 *
 * FFmpeg is free software; you can redistribute it and/or
 * modify it under the terms of the GNU Lesser General Public
 * License as published by the Free Software Foundation; either
 * version 2.1 of the License, or (at your option) any later version.
 *
 * FFmpeg is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public
 * License along with FFmpeg; if not, write to the Free Software
 * Foundation, Inc., 51 Franklin Street, Fifth Floor, Boston, MA 02110-1301 USA
 */

import { type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
import spectral from "./ciescope-spectral.json" with { type: "json" };

// Rec.709/D65 matrices, computed with FFmpeg's single-precision matrix inversion.
const rgbToXyz = [
  [0.41241079568862915, 0.35758456587791443, 0.180453822016716],
  [0.21264931559562683, 0.71516913175582886, 0.072181522846221924],
  [0.019331756979227066, 0.11919480562210083, 0.95039010047912598]
];
const xyzToRgb = [
  [3.2408130168914795, -1.5373086929321289, -0.49858668446540833],
  [-0.96924310922622681, 1.8759665489196777, 0.041555043309926987],
  [0.055638346821069717, -0.20400737226009369, 1.0571296215057373]
];
const f = Math.fround;
function transform(matrix: number[][], x: number, y: number, z: number): number[] {
  return matrix.map(row => f(f(f(row[0]! * x) + f(row[1]! * y)) + f(row[2]! * z)));
}

export async function ciescopeFrame(
  frame: MediaVideoFrame, size: number, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  budget.recordFrame(size, size);
  budget.allocateMemory(size * size * 16);
  const pixels = new Uint16Array(size * size * 4);
  const edge = size - 1;
  const put = (x: number, y: number, value: number) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    pixels.fill(value, (y * size + x) * 4, (y * size + x) * 4 + 4);
  };
  // FFmpeg's antialiased spectral-locus outline also determines the filled area.
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
    const scale = dx + dy === 0 ? 1 : Math.trunc(0xffffff / (dx + dy));
    dx *= scale; dy *= scale;
    let err = dx - dy;
    for (;;) {
      put(x0, y0, 65535 - (Math.abs(err - dx + dy) >> 8));
      const e2 = err, x2 = x0;
      if (2 * e2 >= -dx) {
        if (x0 === x1) break;
        if (e2 + dy < 0xff0000) put(x0, y0 + sy, 65535 - (Math.abs(e2 + dy) >> 8));
        err -= dy; x0 += sx;
      }
      if (2 * e2 <= dy) {
        if (y0 === y1) break;
        if (dx - e2 < 0xff0000) put(x2 + sx, y0, 65535 - (Math.abs(dx - e2) >> 8));
        err += dx; y0 += sy;
      }
    }
  };
  const points = spectral.map(([x, y, z]) => {
    const sum = f(f(f(x!) + f(y!)) + f(z!));
    return [Math.trunc(f(f(f(x!) / sum) * edge)), Math.trunc(f(edge - f(f(f(y!) / sum) * edge)))] as const;
  });
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!;
    line(a[0], a[1], b[0], b[1]);
  }
  const toe = f(0.018);
  const toeScale = (1.099 * Math.pow(toe, 0.45) - 0.099) / toe;
  for (let y = 0; y < size; y++) {
    if (y % 8 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    let left = 0, right = edge;
    while (left < size && pixels[(y * size + left) * 4] === 0) left++;
    while (right >= left && pixels[(y * size + right) * 4] === 0) right--;
    for (let x = left; x <= right; x++) {
      const cx = f(x / edge), cy = f(1 - f(y / edge)), cz = f(1 - f(cx + cy));
      let rgb = transform(xyzToRgb, cx, cy, cz);
      const white = -Math.min(0, ...rgb);
      const max = white > 0 ? 49151 : 65535;
      if (white > 0) rgb = rgb.map(c => f(c + white));
      const peak = Math.max(...rgb);
      for (let channel = 0; channel < 3; channel++) {
        let c = peak > 0 ? f(rgb[channel]! / peak) : rgb[channel]!;
        c = f(c < toe ? c * toeScale : 1.099 * Math.pow(c, 0.45) - 0.099);
        pixels[(y * size + x) * 4 + channel] = Math.trunc(f(max * c));
      }
      pixels[(y * size + x) * 4 + 3] = 65535;
    }
  }
  // Accumulate separately from the background: occupied bins replace its colors.
  const counts = new Uint32Array(size * size);
  for (let p = 0; p < frame.width * frame.height; p++) {
    if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    const rgb = [0, 1, 2].map(c => f(f(frame.data[p * 4 + c]! + f(0.01)) * f(1 / 255)));
    const [x, y, z] = transform(rgbToXyz, rgb[0]!, rgb[1]!, rgb[2]!);
    const scale = f(1 / f(f(x! + y!) + z!));
    const wx = Math.trunc(f(edge * f(x! * scale))), wy = Math.trunc(f(edge - f(edge * f(y! * scale))));
    if (wx >= 0 && wy >= 0 && wx < size && wy < size) {
      const pos = wy * size + wx;
      counts[pos] = Math.min(65535, counts[pos]! + 65);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let p = 0; p < size * size; p++) {
    if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    for (let c = 0; c < 4; c++) {
      const value = counts[p] ? (c === 3 ? 65535 : counts[p]!) : pixels[p * 4 + c]!;
      data[p * 4 + c] = value >> 8;
    }
  }
  const { native: ignoredNative, ...rest } = frame;
  return { ...rest, width: size, height: size, data };
}
