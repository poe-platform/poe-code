/*
 * Copyright (c) 2014 Clément Bœsch
 *
 * This file is part of FFmpeg.
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Adapted from FFmpeg n7.0.2 libavfilter/vf_hqx.c (ISC license above).
// HQX was originally designed by Maxim Stephin.
import { yieldTurn } from "safe-bash-contracts/yield";

function rgb2yuv(c: number): number {
  const g = (c >>> 8) & 255;
  const bg = (c & 255) - g;
  const rg = ((c >>> 16) & 255) - g;
  const start = Math.max(-bg, -rg, 0);
  // Match FFmpeg's table construction, including truncation before adding g.
  const y = Math.trunc((299 * rg + 1000 * start + 114 * bg) / 1000) + g - start;
  const u = Math.trunc((-169 * rg + 500 * bg) / 1000) + 128;
  const v = Math.trunc((500 * rg - 81 * bg) / 1000) + 128;
  return (y << 16) + (u << 8) + v;
}

function yuvDiff(a: number, b: number): boolean {
  return Math.abs((a & 0xff0000) - (b & 0xff0000)) > (48 << 16) ||
    Math.abs((a & 0xff00) - (b & 0xff00)) > (7 << 8) ||
    Math.abs((a & 255) - (b & 255)) > 6;
}

function different(a: number, b: number): boolean {
  return yuvDiff(rgb2yuv(a), rgb2yuv(b));
}

function interp2(c1: number, w1: number, c2: number, w2: number, s: number): number {
  return (((((c1 & 0xff00ff00) >>> 8) * w1 + ((c2 & 0xff00ff00) >>> 8) * w2) << (8 - s)) & 0xff00ff00) |
    ((((c1 & 0x00ff00ff) * w1 + (c2 & 0x00ff00ff) * w2) >>> s) & 0x00ff00ff);
}

function interp3(c1: number, w1: number, c2: number, w2: number, c3: number, w3: number, s: number): number {
  return (((((c1 & 0xff00ff00) >>> 8) * w1 + ((c2 & 0xff00ff00) >>> 8) * w2 +
    ((c3 & 0xff00ff00) >>> 8) * w3) << (8 - s)) & 0xff00ff00) |
    ((((c1 & 0x00ff00ff) * w1 + (c2 & 0x00ff00ff) * w2 + (c3 & 0x00ff00ff) * w3) >>> s) & 0x00ff00ff);
}

// The center pixel has no bit in the eight-bit neighborhood pattern.
function shuffle(k: number, p: readonly number[], rotate: boolean): number {
  let result = 0;
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    const source = i > 4 ? i - 1 : i;
    const target = p[i]! > 4 ? p[i]! - 1 : p[i]!;
    result |= ((k >>> (rotate ? 7 - source : source)) & 1) << target;
  }
  return result;
}

function hq2(k: number, w: Uint32Array, p: readonly number[]): number {
  const pattern = shuffle(k, p, false);
  const P = (mask: number, expected: number) => (pattern & mask) === expected;
  const w0 = w[p[0]!]!, w1 = w[p[1]!]!, w3 = w[p[3]!]!,
    w4 = w[p[4]!]!, w5 = w[p[5]!]!, w7 = w[p[7]!]!;


  if ((P(0xbf,0x37) || P(0xdb,0x13)) && different(w1, w5))
    return interp2(w4, 3, w3, 1, 2);
  if ((P(0xdb,0x49) || P(0xef,0x6d)) && different(w7, w3))
    return interp2(w4, 3, w1, 1, 2);
  if ((P(0x0b,0x0b) || P(0xfe,0x4a) || P(0xfe,0x1a)) && different(w3, w1))
    return w4;
  if ((P(0x6f,0x2a) || P(0x5b,0x0a) || P(0xbf,0x3a) || P(0xdf,0x5a) ||
       P(0x9f,0x8a) || P(0xcf,0x8a) || P(0xef,0x4e) || P(0x3f,0x0e) ||
       P(0xfb,0x5a) || P(0xbb,0x8a) || P(0x7f,0x5a) || P(0xaf,0x8a) ||
       P(0xeb,0x8a)) && different(w3, w1))
    return interp2(w4, 3, w0, 1, 2);
  if (P(0x0b,0x08))
    return interp3(w4, 2, w0, 1, w1, 1, 2);
  if (P(0x0b,0x02))
    return interp3(w4, 2, w0, 1, w3, 1, 2);
  if (P(0x2f,0x2f))
    return interp3(w4, 14, w3, 1, w1, 1, 4);
  if (P(0xbf,0x37) || P(0xdb,0x13))
    return interp3(w4, 5, w1, 2, w3, 1, 3);
  if (P(0xdb,0x49) || P(0xef,0x6d))
    return interp3(w4, 5, w3, 2, w1, 1, 3);
  if (P(0x1b,0x03) || P(0x4f,0x43) || P(0x8b,0x83) || P(0x6b,0x43))
    return interp2(w4, 3, w3, 1, 2);
  if (P(0x4b,0x09) || P(0x8b,0x89) || P(0x1f,0x19) || P(0x3b,0x19))
    return interp2(w4, 3, w1, 1, 2);
  if (P(0x7e,0x2a) || P(0xef,0xab) || P(0xbf,0x8f) || P(0x7e,0x0e))
    return interp3(w4, 2, w3, 3, w1, 3, 3);
  if (P(0xfb,0x6a) || P(0x6f,0x6e) || P(0x3f,0x3e) || P(0xfb,0xfa) ||
      P(0xdf,0xde) || P(0xdf,0x1e))
    return interp2(w4, 3, w0, 1, 2);
  if (P(0x0a,0x00) || P(0x4f,0x4b) || P(0x9f,0x1b) || P(0x2f,0x0b) ||
      P(0xbe,0x0a) || P(0xee,0x0a) || P(0x7e,0x0a) || P(0xeb,0x4b) ||
      P(0x3b,0x1b))
    return interp3(w4, 2, w3, 1, w1, 1, 2);
  return interp3(w4, 6, w3, 1, w1, 1, 3);
}

function hq3(dst: Uint32Array, offset: number, stride: number, k: number, w: Uint32Array,
  pos00: number, pos01: number, p: readonly number[], rotate: boolean): void {
  const pattern = shuffle(k, p, rotate);
  const P = (mask: number, expected: number) => (pattern & mask) === expected;
  const w0 = w[p[0]!]!, w1 = w[p[1]!]!, w3 = w[p[3]!]!,
    w4 = w[p[4]!]!, w5 = w[p[5]!]!, w7 = w[p[7]!]!;

  if ((P(0xdb,0x49) || P(0xef,0x6d)) && different(w7, w3))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w1, 1, 2);
  else if ((P(0xbf,0x37) || P(0xdb,0x13)) && different(w1, w5))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w3, 1, 2);
  else if ((P(0x0b,0x0b) || P(0xfe,0x4a) || P(0xfe,0x1a)) && different(w3, w1))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = w4;
  else if ((P(0x6f,0x2a) || P(0x5b,0x0a) || P(0xbf,0x3a) || P(0xdf,0x5a) ||
            P(0x9f,0x8a) || P(0xcf,0x8a) || P(0xef,0x4e) || P(0x3f,0x0e) ||
            P(0xfb,0x5a) || P(0xbb,0x8a) || P(0x7f,0x5a) || P(0xaf,0x8a) ||
            P(0xeb,0x8a)) && different(w3, w1))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w0, 1, 2);
  else if (P(0x4b,0x09) || P(0x8b,0x89) || P(0x1f,0x19) || P(0x3b,0x19))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w1, 1, 2);
  else if (P(0x1b,0x03) || P(0x4f,0x43) || P(0x8b,0x83) || P(0x6b,0x43))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w3, 1, 2);
  else if (P(0x7e,0x2a) || P(0xef,0xab) || P(0xbf,0x8f) || P(0x7e,0x0e))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w3, 1, w1, 1, 1);
  else if (P(0x4f,0x4b) || P(0x9f,0x1b) || P(0x2f,0x0b) || P(0xbe,0x0a) ||
           P(0xee,0x0a) || P(0x7e,0x0a) || P(0xeb,0x4b) || P(0x3b,0x1b))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp3(w4, 2, w3, 7, w1, 7, 4);
  else if (P(0x0b,0x08) || P(0xf9,0x68) || P(0xf3,0x62) || P(0x6d,0x6c) ||
           P(0x67,0x66) || P(0x3d,0x3c) || P(0x37,0x36) || P(0xf9,0xf8) ||
           P(0xdd,0xdc) || P(0xf3,0xf2) || P(0xd7,0xd6) || P(0xdd,0x1c) ||
           P(0xd7,0x16) || P(0x0b,0x02))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w0, 1, 2);
  else
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp3(w4, 2, w3, 1, w1, 1, 2);

  if ((P(0xfe,0xde) || P(0x9e,0x16) || P(0xda,0x12) || P(0x17,0x16) ||
       P(0x5b,0x12) || P(0xbb,0x12)) && different(w1, w5))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = w4;
  else if ((P(0x0f,0x0b) || P(0x5e,0x0a) || P(0xfb,0x7b) || P(0x3b,0x0b) ||
            P(0xbe,0x0a) || P(0x7a,0x0a)) && different(w3, w1))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = w4;
  else if (P(0xbf,0x8f) || P(0x7e,0x0e) || P(0xbf,0x37) || P(0xdb,0x13))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w1, 3, w4, 1, 2);
  else if (P(0x02,0x00) || P(0x7c,0x28) || P(0xed,0xa9) || P(0xf5,0xb4) ||
           P(0xd9,0x90))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 3, w1, 1, 2);
  else if (P(0x4f,0x4b) || P(0xfb,0x7b) || P(0xfe,0x7e) || P(0x9f,0x1b) ||
           P(0x2f,0x0b) || P(0xbe,0x0a) || P(0x7e,0x0a) || P(0xfb,0x4b) ||
           P(0xfb,0xdb) || P(0xfe,0xde) || P(0xfe,0x56) || P(0x57,0x56) ||
           P(0x97,0x16) || P(0x3f,0x1e) || P(0xdb,0x12) || P(0xbb,0x12))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 7, w1, 1, 3);
  else
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = w4;
}

function hq4(dst: Uint32Array, offset: number, stride: number, k: number, w: Uint32Array,
  pos00: number, pos01: number, pos10: number, pos11: number, p: readonly number[]): void {
  const pattern = shuffle(k, p, false);
  const P = (mask: number, expected: number) => (pattern & mask) === expected;
  const w0 = w[p[0]!]!, w1 = w[p[1]!]!, w3 = w[p[3]!]!,
    w4 = w[p[4]!]!, w5 = w[p[5]!]!, w7 = w[p[7]!]!;

  const cond00 = (P(0xbf,0x37) || P(0xdb,0x13)) && different(w1, w5);
  const cond01 = (P(0xdb,0x49) || P(0xef,0x6d)) && different(w7, w3);
  const cond02 = (P(0x6f,0x2a) || P(0x5b,0x0a) || P(0xbf,0x3a) ||
                      P(0xdf,0x5a) || P(0x9f,0x8a) || P(0xcf,0x8a) ||
                      P(0xef,0x4e) || P(0x3f,0x0e) || P(0xfb,0x5a) ||
                      P(0xbb,0x8a) || P(0x7f,0x5a) || P(0xaf,0x8a) ||
                      P(0xeb,0x8a)) && different(w3, w1);
  const cond03 = P(0xdb,0x49) || P(0xef,0x6d);
  const cond04 = P(0xbf,0x37) || P(0xdb,0x13);
  const cond05 = P(0x1b,0x03) || P(0x4f,0x43) || P(0x8b,0x83) ||
                     P(0x6b,0x43);
  const cond06 = P(0x4b,0x09) || P(0x8b,0x89) || P(0x1f,0x19) ||
                     P(0x3b,0x19);
  const cond07 = P(0x0b,0x08) || P(0xf9,0x68) || P(0xf3,0x62) ||
                     P(0x6d,0x6c) || P(0x67,0x66) || P(0x3d,0x3c) ||
                     P(0x37,0x36) || P(0xf9,0xf8) || P(0xdd,0xdc) ||
                     P(0xf3,0xf2) || P(0xd7,0xd6) || P(0xdd,0x1c) ||
                     P(0xd7,0x16) || P(0x0b,0x02);
  const cond08 = (P(0x0f,0x0b) || P(0x2b,0x0b) || P(0xfe,0x4a) ||
                      P(0xfe,0x1a)) && different(w3, w1);
  const cond09 = P(0x2f,0x2f);
  const cond10 = P(0x0a,0x00);
  const cond11 = P(0x0b,0x09);
  const cond12 = P(0x7e,0x2a) || P(0xef,0xab);
  const cond13 = P(0xbf,0x8f) || P(0x7e,0x0e);
  const cond14 = P(0x4f,0x4b) || P(0x9f,0x1b) || P(0x2f,0x0b) ||
                     P(0xbe,0x0a) || P(0xee,0x0a) || P(0x7e,0x0a) ||
                     P(0xeb,0x4b) || P(0x3b,0x1b);
  const cond15 = P(0x0b,0x03);

  if (cond00)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w3, 3, 3);
  else if (cond01)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w1, 3, 3);
  else if ((P(0x0b,0x0b) || P(0xfe,0x4a) || P(0xfe,0x1a)) && different(w3, w1))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = w4;
  else if (cond02)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w0, 3, 3);
  else if (cond03)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w3, 1, 2);
  else if (cond04)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 3, w1, 1, 2);
  else if (cond05)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w3, 3, 3);
  else if (cond06)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w1, 3, 3);
  else if (P(0x0f,0x0b) || P(0x5e,0x0a) || P(0x2b,0x0b) || P(0xbe,0x0a) ||
           P(0x7a,0x0a) || P(0xee,0x0a))
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w1, 1, w3, 1, 1);
  else if (cond07)
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp2(w4, 5, w0, 3, 3);
  else
    dst[offset + stride * (pos00 >> 1) + (pos00 & 1)] = interp3(w4, 2, w1, 1, w3, 1, 2);

  if (cond00)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 7, w3, 1, 3);
  else if (cond08)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = w4;
  else if (cond02)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 3, w0, 1, 2);
  else if (cond09)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = w4;
  else if (cond10)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp3(w4, 5, w1, 2, w3, 1, 3);
  else if (P(0x0b,0x08))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp3(w4, 5, w1, 2, w0, 1, 3);
  else if (cond11)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 5, w1, 3, 3);
  else if (cond04)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w1, 3, w4, 1, 2);
  else if (cond12)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp3(w1, 2, w4, 1, w3, 1, 2);
  else if (cond13)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w1, 5, w3, 3, 3);
  else if (cond05)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 7, w3, 1, 3);
  else if (P(0xf3,0x62) || P(0x67,0x66) || P(0x37,0x36) || P(0xf3,0xf2) ||
           P(0xd7,0xd6) || P(0xd7,0x16) || P(0x0b,0x02))
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 3, w0, 1, 2);
  else if (cond14)
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w1, 1, w4, 1, 1);
  else
    dst[offset + stride * (pos01 >> 1) + (pos01 & 1)] = interp2(w4, 3, w1, 1, 2);

  if (cond01)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 7, w1, 1, 3);
  else if (cond08)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = w4;
  else if (cond02)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 3, w0, 1, 2);
  else if (cond09)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = w4;
  else if (cond10)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp3(w4, 5, w3, 2, w1, 1, 3);
  else if (P(0x0b,0x02))
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp3(w4, 5, w3, 2, w0, 1, 3);
  else if (cond15)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 5, w3, 3, 3);
  else if (cond03)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w3, 3, w4, 1, 2);
  else if (cond13)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp3(w3, 2, w4, 1, w1, 1, 2);
  else if (cond12)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w3, 5, w1, 3, 3);
  else if (cond06)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 7, w1, 1, 3);
  else if (P(0x0b,0x08) || P(0xf9,0x68) || P(0x6d,0x6c) || P(0x3d,0x3c) ||
           P(0xf9,0xf8) || P(0xdd,0xdc) || P(0xdd,0x1c))
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 3, w0, 1, 2);
  else if (cond14)
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w3, 1, w4, 1, 1);
  else
    dst[offset + stride * (pos10 >> 1) + (pos10 & 1)] = interp2(w4, 3, w3, 1, 2);

  if ((P(0x7f,0x2b) || P(0xef,0xab) || P(0xbf,0x8f) || P(0x7f,0x0f)) &&
       different(w3, w1))
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = w4;
  else if (cond02)
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = interp2(w4, 7, w0, 1, 3);
  else if (cond15)
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = interp2(w4, 7, w3, 1, 3);
  else if (cond11)
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = interp2(w4, 7, w1, 1, 3);
  else if (P(0x0a,0x00) || P(0x7e,0x2a) || P(0xef,0xab) || P(0xbf,0x8f) ||
           P(0x7e,0x0e))
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = interp3(w4, 6, w3, 1, w1, 1, 3);
  else if (cond07)
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = interp2(w4, 7, w0, 1, 3);
  else
    dst[offset + stride * (pos11 >> 1) + (pos11 & 1)] = w4;
}

const identity = [0, 1, 2, 3, 4, 5, 6, 7, 8];
const mirrorX = [2, 1, 0, 5, 4, 3, 8, 7, 6];
const mirrorY = [6, 7, 8, 3, 4, 5, 0, 1, 2];
const mirrorBoth = [8, 7, 6, 5, 4, 3, 2, 1, 0];
const rotateRight = [2, 5, 8, 1, 4, 7, 0, 3, 6];
const rotateLeft = [6, 3, 0, 7, 4, 1, 8, 5, 2];

export async function hqxFrame(
  data: Uint8Array, width: number, height: number, factor: 2 | 3 | 4, signal?: AbortSignal
): Promise<Uint8Array> {
  const output = new Uint8Array(width * height * factor * factor * 4);
  const target = new Uint32Array(output.buffer);
  const stride = width * factor;
  const w = new Uint32Array(9);
  let work = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const i = (Math.min(height - 1, Math.max(0, y + dy)) * width + Math.min(width - 1, Math.max(0, x + dx))) * 4;
          w[(dy + 1) * 3 + dx + 1] = (data[i + 3]! << 24) | (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
        }
      }
      let pattern = 0;
      const center = rgb2yuv(w[4]!);
      for (let i = 0; i < 9; i++) {
        if (i !== 4 && yuvDiff(center, rgb2yuv(w[i]!))) pattern |= 1 << (i > 4 ? i - 1 : i);
      }
      const offset = y * factor * stride + x * factor;
      if (factor === 2) {
        target[offset] = hq2(pattern, w, identity);
        target[offset + 1] = hq2(pattern, w, mirrorX);
        target[offset + stride] = hq2(pattern, w, mirrorY);
        target[offset + stride + 1] = hq2(pattern, w, mirrorBoth);
      } else if (factor === 3) {
        hq3(target, offset, stride, pattern, w, 0, 1, identity, false);
        hq3(target, offset + 1, stride, pattern, w, 1, 3, rotateRight, true);
        hq3(target, offset + stride, stride, pattern, w, 2, 0, rotateLeft, true);
        hq3(target, offset + stride + 1, stride, pattern, w, 3, 2, mirrorBoth, false);
        target[offset + stride + 1] = w[4]!;
      } else {
        hq4(target, offset, stride, pattern, w, 0, 1, 2, 3, identity);
        hq4(target, offset + 2, stride, pattern, w, 1, 0, 3, 2, mirrorX);
        hq4(target, offset + 2 * stride, stride, pattern, w, 2, 3, 0, 1, mirrorY);
        hq4(target, offset + 2 * stride + 2, stride, pattern, w, 3, 2, 1, 0, mirrorBoth);
      }
    }
  }
  // Convert packed ARGB values back to RGBA bytes without assuming endianness.
  for (let i = 0; i < target.length; i++) {
    if (++work % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
    const c = target[i]!;
    output[i * 4] = (c >>> 16) & 255;
    output[i * 4 + 1] = (c >>> 8) & 255;
    output[i * 4 + 2] = c & 255;
    output[i * 4 + 3] = c >>> 24;
  }
  return output;
}
