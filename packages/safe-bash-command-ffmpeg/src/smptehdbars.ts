/*
 * Copyright (c) 2007 Nicolas George <nicolas.george@normalesup.org>
 * Copyright (c) 2011 Stefano Sabatini
 * Copyright (c) 2012 Paul B Mahol
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

import { scaleVideoPicture, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";

// FFmpeg's SMPTE RP 219 pattern, drawn directly in limited-range BT.709 YUV420P.
export function* renderSmpteHdBars(
  width: number, height: number, ptsSeconds: number, durationSeconds: number, budget: MediaBudgetTracker
): Generator<void, MediaVideoFrame> {
  const chromaWidth = Math.ceil(width / 2);
  const chromaHeight = Math.ceil(height / 2);
  const lumaSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  budget.allocateMemory(lumaSize * 5 + chromaSize * 2);
  const pixels = new Uint8Array(lumaSize + chromaSize * 2);
  const align = (value: number) => Math.ceil(Math.floor(value) / 2) * 2;
  function* bar(color: readonly number[], x: number, y: number, w: number, h: number): Generator<void> {
    x = Math.min(x, width - 1);
    y = Math.min(y, height - 1);
    w = Math.max(0, Math.min(w, width - x));
    h = Math.max(0, Math.min(h, height - y));
    for (let plane = 0; plane < 3; plane++) {
      const divisor = plane === 0 ? 1 : 2;
      const stride = plane === 0 ? width : chromaWidth;
      const offset = plane === 0 ? 0 : lumaSize + (plane - 1) * chromaSize;
      const left = Math.floor(x / divisor);
      const top = Math.floor(y / divisor);
      for (let row = 0; row < Math.ceil(h / divisor); row++) {
        if (row % 16 === 0) yield;
        const start = offset + (top + row) * stride + left;
        pixels.fill(color[plane]!, start, start + Math.ceil(w / divisor));
      }
    }
  }

  const margin = align(width / 8);
  const barWidth = align(Math.floor((width + 3) / 4) * 3 / 7);
  const topHeight = align(height * 7 / 12);
  const bandHeight = align(height / 12);
  const right = margin + 7 * barWidth;
  const gray40 = [104, 128, 128];
  const gray15 = [49, 128, 128];
  const black = [16, 128, 128];
  const rainbow = [
    [180, 128, 128], [168, 44, 136], [145, 147, 44], [133, 63, 52],
    [63, 193, 204], [51, 109, 212], [28, 212, 120]
  ];
  yield* bar(gray40, 0, 0, margin, topHeight);
  for (let i = 0; i < rainbow.length; i++) {
    yield* bar(rainbow[i]!, margin + i * barWidth, 0, barWidth, topHeight);
  }
  yield* bar(gray40, right, 0, width - right, topHeight);

  yield* bar([188, 154, 16], 0, topHeight, margin, bandHeight);
  yield* bar([57, 156, 97], margin, topHeight, barWidth, bandHeight);
  yield* bar(rainbow[0]!, margin + barWidth, topHeight, 6 * barWidth, bandHeight);
  yield* bar([32, 240, 118], right, topHeight, width - right, bandHeight);

  const rampY = topHeight + bandHeight;
  yield* bar([219, 16, 138], 0, rampY, margin, bandHeight);
  yield* bar([44, 171, 147], margin, rampY, barWidth, bandHeight);
  for (let i = 0; i < 6 * barWidth; i += 2) {
    yield* bar([Math.floor(i * 255 / (6 * barWidth)), 128, 128],
      margin + barWidth + i, rampY, 2, bandHeight);
  }
  yield* bar([63, 102, 240], right, rampY, width - right, bandHeight);

  const bottomY = rampY + bandHeight;
  const bottomHeight = height - bottomY;
  yield* bar(gray15, 0, bottomY, margin, bottomHeight);
  let x = margin;
  for (const [w, color] of [
    [align(barWidth * 3 / 2), black], [align(barWidth * 2), [235, 128, 128]],
    [align(barWidth * 5 / 6), black], [align(barWidth / 3), [12, 128, 128]],
    [align(barWidth / 3), black], [align(barWidth / 3), [20, 128, 128]],
    [align(barWidth / 3), black], [align(barWidth / 3), [25, 128, 128]]
  ] as const) {
    yield* bar(color, x, bottomY, w, bottomHeight);
    x += w;
  }
  yield* bar(black, x, bottomY, right - x, bottomHeight);
  yield* bar(gray15, right, bottomY, width - right, bottomHeight);

  const native = { rgba: pixels, pixels, width, height, format: 0, colorspace: 1, fullRange: 0 };
  const data = scaleVideoPicture({ data: pixels, width, height, native }, width, height)!;
  return { width, height, data, native: { ...native, rgba: data }, ptsSeconds, durationSeconds, keyframe: true };
}
