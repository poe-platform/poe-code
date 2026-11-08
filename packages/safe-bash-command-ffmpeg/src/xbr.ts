/*
 * This file is part of FFmpeg.
 *
 * Copyright (c) 2011, 2012 Hyllian/Jararaca <sergiogdb@gmail.com>
 * Copyright (c) 2014 Arwa Arif <arwaarif1994@gmail.com>
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

// TypeScript adaptation of FFmpeg's vf_xbr.c (n7.0.2).
import { yieldTurn } from "safe-bash-contracts/yield";

function yuv(color: number): number {
  const g = (color >>> 8) & 255;
  const rg = (color >>> 16) - g;
  const bg = (color & 255) - g;
  const start = Math.max(-bg, -rg, 0);
  const y = Math.trunc((299 * rg + 1000 * start + 114 * bg) / 1000) + g - start;
  const u = Math.trunc((-169 * rg + 500 * bg) / 1000) + 128;
  const v = Math.trunc((500 * rg - 81 * bg) / 1000) + 128;
  return (y << 16) + (u << 8) + v;
}

function diff(a: number, b: number): number {
  const x = yuv(a), y = yuv(b);
  return Math.abs((x >>> 16) - (y >>> 16)) +
    Math.abs(((x >>> 8) & 255) - ((y >>> 8) & 255)) + Math.abs((x & 255) - (y & 255));
}
const equal = (a: number, b: number) => diff(a, b) < 155;

function blend(a: number, b: number, weight: number): number {
  // FFmpeg's half blend truncates both operands before adding.
  if (weight === 4) return ((a & 0xfefefe) >>> 1) + ((b & 0xfefefe) >>> 1);
  return (0xff00ff & ((a & 0xff00ff) + (((b & 0xff00ff) - (a & 0xff00ff)) * weight >> 3))) |
    (0xff00 & ((a & 0xff00) + (((b & 0xff00) - (a & 0xff00)) * weight >> 3)));
}

export async function xbrFrame(
  data: Uint8Array, width: number, height: number, factor: 2 | 3 | 4, signal?: AbortSignal
): Promise<Uint8Array> {
  const output = new Uint8Array(width * height * factor * factor * 4);
  const block = new Uint32Array(factor * factor);
  const indices = new Uint8Array(factor * factor);
  let work = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (++work % 256 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
      const pixel = (dx: number, dy: number, rotation: number): number => {
        for (let r = 0; r < rotation; r++) [dx, dy] = [dy, -dx];
        const offset = (Math.max(0, Math.min(height - 1, y + dy)) * width +
          Math.max(0, Math.min(width - 1, x + dx))) * 4;
        return (data[offset]! << 16) | (data[offset + 1]! << 8) | data[offset + 2]!;
      };
      const pe = pixel(0, 0, 0);
      block.fill(pe);
      for (let rotation = 0; rotation < 4; rotation++) {
        const pi = pixel(1, 1, rotation), ph = pixel(0, 1, rotation), pf = pixel(1, 0, rotation);
        if (pe === ph || pe === pf) continue;
        const pg = pixel(-1, 1, rotation), pc = pixel(1, -1, rotation);
        const pd = pixel(-1, 0, rotation), pb = pixel(0, -1, rotation);
        const f4 = pixel(2, 0, rotation), i4 = pixel(2, 1, rotation);
        const h5 = pixel(0, 2, rotation), i5 = pixel(1, 2, rotation);
        const e = diff(pe, pc) + diff(pe, pg) + diff(pi, h5) + diff(pi, f4) + 4 * diff(ph, pf);
        const i = diff(ph, pd) + diff(ph, i5) + diff(pf, i4) + diff(pf, pb) + 4 * diff(pe, pi);
        if (e > i) continue;
        for (let n = 0; n < indices.length; n++) {
          let dx = n % factor, dy = Math.floor(n / factor);
          for (let r = 0; r < rotation; r++) [dx, dy] = [dy, factor - 1 - dx];
          indices[n] = dy * factor + dx;
        }
        const px = diff(pe, pf) <= diff(pe, ph) ? pf : ph;
        const set = (n: number, value: number) => { block[indices[n]!] = value; };
        const get = (n: number) => block[indices[n]!]!;
        const mix = (n: number, weight: number) => set(n, blend(get(n), px, weight));
        const edge = factor === 3
          ? ((!equal(pf, pb) && !equal(pf, pc)) || (!equal(ph, pd) && !equal(ph, pg)) ||
            (equal(pe, pi) && ((!equal(pf, f4) && !equal(pf, i4)) || (!equal(ph, h5) && !equal(ph, i5)))) || equal(pe, pg) || equal(pe, pc))
          : ((!equal(pf, pb) && !equal(ph, pd)) || (equal(pe, pi) && !equal(pf, i4) && !equal(ph, i5)) || equal(pe, pg) || equal(pe, pc));
        if (e === i || !edge) { mix(factor * factor - 1, 4); continue; }
        const ke = diff(pf, pg), ki = diff(ph, pc);
        const left = 2 * ke <= ki && pe !== pg && pd !== pg;
        const up = ke >= 2 * ki && pe !== pc && pb !== pc;
        if (factor === 2) {
          if (left && up) { mix(3, 7); mix(2, 2); set(1, get(2)); }
          else if (left) { mix(3, 6); mix(2, 2); }
          else if (up) { mix(3, 6); mix(1, 2); }
          else mix(3, 4);
        } else if (factor === 3) {
          if (left && up) { mix(7, 6); mix(6, 2); set(5, get(7)); set(2, get(6)); set(8, px); }
          else if (left) { mix(7, 6); mix(5, 2); mix(6, 2); set(8, px); }
          else if (up) { mix(5, 6); mix(7, 2); mix(2, 2); set(8, px); }
          else { mix(8, 7); mix(5, 1); mix(7, 1); }
        } else {
          if (left && up) {
            mix(13, 6); mix(12, 2); set(15, px); set(14, px); set(11, px);
            set(10, get(12)); set(3, get(12)); set(7, get(13));
          } else if (left) { mix(11, 6); mix(13, 6); mix(10, 2); mix(12, 2); set(14, px); set(15, px); }
          else if (up) { mix(14, 6); mix(7, 6); mix(10, 2); mix(3, 2); set(11, px); set(15, px); }
          else { mix(11, 4); mix(14, 4); set(15, px); }
        }
      }
      for (let n = 0; n < block.length; n++) {
        const offset = ((y * factor + Math.floor(n / factor)) * width * factor + x * factor + n % factor) * 4;
        output[offset] = block[n]! >>> 16;
        output[offset + 1] = block[n]! >>> 8;
        output[offset + 2] = block[n]!;
        output[offset + 3] = 255;
      }
    }
  }
  return output;
}
