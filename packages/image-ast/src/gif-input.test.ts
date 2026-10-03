import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { defaultRuntime } from "@poe-code/compression";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import sharp from "./index.js";
import { decodeGifImage } from "./codecs/gif.js";
import { decodeGifToStorage } from "./codecs/gif-input-storage.js";
import type { ImageMetadata, RgbaImage } from "./ast.js";

export interface GifInputSpec {
  width?: number;
  height?: number;
  frames?: number;
  minimum?: number;
  block?: number;
  disposal?: number;
  local?: boolean;
  interlace?: boolean;
  offset?: boolean;
  transparent?: boolean;
  noGlobal?: boolean;
  noGce?: boolean;
  loop?: number;
  mode?: string;
  truncate?: number;
  comment?: number;
}
export interface GifInputOptions {
  page?: number;
  pages?: number;
  animated?: boolean;
}
function lzwCodes(codes: number[], minimum: number): Uint8Array {
  const bits: number[] = [];
  let width = minimum + 1,
    next = (1 << minimum) + 2,
    old = false;
  for (const code of codes) {
    for (let i = 0; i < width; i++) bits.push((code >>> i) & 1);
    if (code === 1 << minimum) {
      width = minimum + 1;
      next = (1 << minimum) + 2;
      old = false;
      continue;
    }
    if (code === (1 << minimum) + 1) break;
    if (old && next < 4096) {
      next++;
      if (next === 1 << width && width < 12) width++;
    }
    old = true;
  }
  const bytes = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => (bytes[i >>> 3]! |= bit << (i & 7)));
  return bytes;
}
export function gifInputFixture(spec: GifInputSpec): Uint8Array {
  const width = spec.width ?? 9,
    height = spec.height ?? 11,
    frames = spec.frames ?? 4,
    minimum = spec.minimum ?? 2,
    block = spec.block ?? 255,
    bytes: number[] = [
      71,
      73,
      70,
      56,
      57,
      97,
      width & 255,
      width >>> 8,
      height & 255,
      height >>> 8,
      spec.noGlobal ? 0 : 247,
      0,
      0
    ];
  if (!spec.noGlobal)
    for (let i = 0; i < 256; i++) bytes.push((i * 43) % 256, (i * 71) % 256, (i * 113) % 256);
  if (spec.loop !== undefined)
    bytes.push(
      33,
      255,
      11,
      78,
      69,
      84,
      83,
      67,
      65,
      80,
      69,
      50,
      46,
      48,
      3,
      1,
      spec.loop & 255,
      (spec.loop >>> 8) & 255,
      0
    );
  if (spec.comment) {
    bytes.push(33, 254);
    for (let n = 0; n < spec.comment; n += 255) {
      const count = Math.min(255, spec.comment - n);
      bytes.push(count, ...new Array(count).fill(120));
    }
    bytes.push(0);
  }
  for (let frame = 0; frame < frames; frame++) {
    const transparent = spec.transparent && frame % 2 === 0,
      disposal = spec.disposal ?? [0, 2, 3, 1][frame % 4]!;
    if (!spec.noGce)
      bytes.push(33, 249, 4, (disposal << 2) | (transparent ? 1 : 0), (frame * 7) & 255, 0, 0, 0);
    const left = spec.offset && frame > 0 ? width - 3 : 0,
      top = spec.offset && frame > 0 ? height - 2 : 0,
      local = spec.local && frame % 2 === 1;
    bytes.push(
      44,
      left & 255,
      left >>> 8,
      top & 255,
      top >>> 8,
      width & 255,
      width >>> 8,
      height & 255,
      height >>> 8,
      (local ? 129 : 0) | (spec.interlace ? 64 : 0)
    );
    if (local) bytes.push(255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255);
    bytes.push(minimum);
    const clear = 1 << minimum,
      eoi = clear + 1,
      indices = Array.from(
        { length: width * height },
        (_, i) => (i + Math.floor(i / width) + frame) % 4
      );
    let codes = [clear, ...indices, eoi];
    if (spec.mode === "kwkwk") codes = [clear, 1, clear + 2, clear + 3, clear + 4, eoi];
    if (spec.mode === "clear") codes = [clear, clear, 1, clear, 2, clear, clear, 3, eoi];
    if (spec.mode === "early") codes = [clear, 1, eoi];
    if (spec.mode === "missing-clear") codes = [...indices, eoi];
    const packed = lzwCodes(codes, minimum);
    for (let at = 0; at < packed.length; at += block) {
      const chunk = packed.subarray(at, at + block);
      bytes.push(chunk.length, ...chunk);
    }
    bytes.push(0);
  }
  bytes.push(59);
  const result = Uint8Array.from(bytes);
  return spec.truncate === undefined
    ? result
    : result.subarray(
        0,
        spec.truncate < 0 ? Math.max(0, result.length + spec.truncate) : spec.truncate
      );
}
export interface GifInputVector {
  spec: GifInputSpec;
  options: GifInputOptions;
  metadata?: ImageMetadata;
  expected?: Omit<RgbaImage, "data">;
  hash?: string;
  error?: string;
}

// Independently executed pre-retained decoder at 7e531d71ec.
export const gifInputVectors: GifInputVector[] = [
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "3540a64cd5afeaad224bda2b17b5347b8d54ed975f2763a10d510dff01a93560"
  },
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "039c9c52794d0711f7001646b31f0d34261d66bfb9545b6f1c9a9845b78b347c"
  },
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "4c70a2b1a3c681c35d07d255bf33e82b50139c5ed8c4e41f344e5dea792e368b"
  },
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "af269592247d3313e51d125e830441e591ff3241fa4d2d7576878cdfc78db8a5"
  },
  {
    spec: { disposal: 0, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "af269592247d3313e51d125e830441e591ff3241fa4d2d7576878cdfc78db8a5"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "5405872e0ebb8e266bf72b2976a06453c275b97518c6499e740a1973d54ced17"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "ba5c1f88808a7f5d57ec8987b9d81dc8fbfdb41c425d51eeeaa62d8b095aa077"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "978d41100faa0999de3ff09bbbf0621f46aa50d1748cec7629ac617962a30845"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "9986f3fa1d6fc2858ef2cd9d2c2b1eb0491bbf1d06e8d16e5769034ae2a10a24"
  },
  {
    spec: { disposal: 0, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "9986f3fa1d6fc2858ef2cd9d2c2b1eb0491bbf1d06e8d16e5769034ae2a10a24"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "3540a64cd5afeaad224bda2b17b5347b8d54ed975f2763a10d510dff01a93560"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "039c9c52794d0711f7001646b31f0d34261d66bfb9545b6f1c9a9845b78b347c"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "4c70a2b1a3c681c35d07d255bf33e82b50139c5ed8c4e41f344e5dea792e368b"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "af269592247d3313e51d125e830441e591ff3241fa4d2d7576878cdfc78db8a5"
  },
  {
    spec: { disposal: 1, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "af269592247d3313e51d125e830441e591ff3241fa4d2d7576878cdfc78db8a5"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "5405872e0ebb8e266bf72b2976a06453c275b97518c6499e740a1973d54ced17"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "ba5c1f88808a7f5d57ec8987b9d81dc8fbfdb41c425d51eeeaa62d8b095aa077"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "978d41100faa0999de3ff09bbbf0621f46aa50d1748cec7629ac617962a30845"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "9986f3fa1d6fc2858ef2cd9d2c2b1eb0491bbf1d06e8d16e5769034ae2a10a24"
  },
  {
    spec: { disposal: 1, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "9986f3fa1d6fc2858ef2cd9d2c2b1eb0491bbf1d06e8d16e5769034ae2a10a24"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "a452d24e893b48eeafb9e1bdee9e116285652fde4f60cf37b5c784473e3e228b"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "86d9b6ca10de93db1d29c1b742c3a22a2c4c596b3e6e431ffc5b3cf29e93ce22"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "1fa6fce46160aed495ae060b8987283049d68676d9eb0656a2ee6efb52efa699"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "632484d1c2b01c28827c92e775dbc03fc616c19e1f07bf572f63687476f0657e"
  },
  {
    spec: { disposal: 2, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "d0ec58c01371d71f37957fa38f7638c92a5b4ea7f71095c0563ce5fa7d77afa1"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "e3be3fe109fb6da078d392ee7393a80ecb06bad69969f129a4c22ab34da02f20"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "bde8b1aaf7c5fc8a48d17854d6b537e344d4579ca359674fb4139acbb155b2df"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "340fcfa3108e1fca77c49ca7c8c0c258bfa8a60223c523f399a80908eae74c49"
  },
  {
    spec: { disposal: 2, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "a452d24e893b48eeafb9e1bdee9e116285652fde4f60cf37b5c784473e3e228b"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "86d9b6ca10de93db1d29c1b742c3a22a2c4c596b3e6e431ffc5b3cf29e93ce22"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "1fa6fce46160aed495ae060b8987283049d68676d9eb0656a2ee6efb52efa699"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "632484d1c2b01c28827c92e775dbc03fc616c19e1f07bf572f63687476f0657e"
  },
  {
    spec: { disposal: 3, local: false, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1189
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: {},
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "26a76dabf209217130a1881ac73f400d3eb2bb4297cfa661ae2db8bd90b886ed"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "d0ec58c01371d71f37957fa38f7638c92a5b4ea7f71095c0563ce5fa7d77afa1"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "e3be3fe109fb6da078d392ee7393a80ecb06bad69969f129a4c22ab34da02f20"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 1, pages: 2 },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "bde8b1aaf7c5fc8a48d17854d6b537e344d4579ca359674fb4139acbb155b2df"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 3, pages: -1 },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "340fcfa3108e1fca77c49ca7c8c0c258bfa8a60223c523f399a80908eae74c49"
  },
  {
    spec: { disposal: 3, local: true, interlace: true, offset: true, transparent: true, loop: 2 },
    options: { page: 8, animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 3,
      size: 1213
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0, 70, 140, 210],
      loop: 3
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 1, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 15260
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 1, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 808
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 1, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 810
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 1, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 806
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 1, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 15260
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 2, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 11646
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 2, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 807
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 2, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 808
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 2, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 805
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 2, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 11646
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 254, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8060
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 254, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 806
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 254, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 807
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 254, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 805
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 254, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8060
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 255, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8060
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 255, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 806
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 255, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 807
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 255, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 805
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 2, block: 255, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8060
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 1, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 15570
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 1, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 816
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 1, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 824
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 1, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 810
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 1, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 15568
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 2, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 11878
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 2, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 813
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 2, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 819
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 2, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 808
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 2, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 11877
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 254, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8216
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 254, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 810
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 254, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 814
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 254, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 807
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 254, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8215
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 255, mode: "literal" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8215
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 255, mode: "kwkwk" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 810
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "38414a8e2e882bb5739c180d4f05432ed1ccb57adfb7691bd7a5dc4189bca25a"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 255, mode: "clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 814
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "4dd068c976c8a39343dc138f31a8d37115a31f62b878df3ee59fd408b6d734fa"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 255, mode: "early" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 807
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "e731a16c872644f8808908a661151e1e4f8145c46aa0574a8e1e6c7bb4c4b31e"
  },
  {
    spec: { width: 1031, height: 5, frames: 1, minimum: 8, block: 255, mode: "missing-clear" },
    options: {},
    metadata: {
      format: "gif",
      width: 1031,
      height: 5,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 8214
    },
    expected: {
      width: 1031,
      height: 5,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      delay: [0]
    },
    hash: "85c0cc7e8b514f845b4e19d709741eb7242fcf4756845b57873147cd1a5ff36c"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 0 },
    options: { animated: true },
    error: "Invalid GIF header"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 5 },
    options: { animated: true },
    error: "Invalid GIF header"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 12 },
    options: { animated: true },
    error: "Invalid GIF header"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 13 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      size: 13
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 20 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      size: 20
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 780 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      size: 780
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 790 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      size: 790
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: 795 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      size: 795
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true
    },
    hash: "58553b15fb3888e443e29fff5663675b8f70e37f0ea6c54076489d6ff04c1032"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -1 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 987
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "a58d4889dce96215ce3f39e6785a602c23544d5571ec8025f86577a417d376f9"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -2 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 986
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "a58d4889dce96215ce3f39e6785a602c23544d5571ec8025f86577a417d376f9"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -3 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 985
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "a58d4889dce96215ce3f39e6785a602c23544d5571ec8025f86577a417d376f9"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -7 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 981
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "966144dea838b98dae52b578519b2a4c8856c548b3ee44381bc817a3ffae8b15"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -13 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 975
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "34f9172920b0cd5170b0f2d42f3789ced2008285f93d9839c7630adf30304f82"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -25 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 963
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "fbc8d3799794ed82aded86402fec0f0e9397835423ed617220f93ec2329c7a52"
  },
  {
    spec: { frames: 2, local: true, transparent: true, truncate: -60 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 928
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "658bcfc3e7ea798fb776473e18d1bf49833b22810a87c049ac8307ed8b0c5eff"
  },
  {
    spec: { noGlobal: true, local: true },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 0,
      size: 426
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 0
    },
    hash: "9d132d1af172bb88c0687a047c3d66f6ccfdd9c71ab2fe4da8d9c191289c22e5"
  },
  {
    spec: { noGce: true, loop: 0 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [100, 100, 100, 100],
      loop: 0,
      size: 1157
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [100, 100, 100, 100],
      loop: 0
    },
    hash: "92cf497309357db87f489f1ef998ebe7fb6384647ac5262506b5d33d1f75f978"
  },
  {
    spec: { noGce: true, loop: 65535 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [100, 100, 100, 100],
      loop: 65536,
      size: 1157
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [100, 100, 100, 100],
      loop: 65536
    },
    hash: "92cf497309357db87f489f1ef998ebe7fb6384647ac5262506b5d33d1f75f978"
  },
  {
    spec: { width: 1, height: 1 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 1,
      height: 4,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 1,
      delay: [0, 70, 140, 210],
      loop: 0,
      size: 874
    },
    expected: {
      width: 1,
      height: 4,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 4,
      sourcePages: 4,
      pageHeight: 1,
      delay: [0, 70, 140, 210],
      loop: 0
    },
    hash: "a713375f22a68bf536ba36ae4a1f4c1064187ce76df26178604a9089f36f2ea1"
  },
  {
    spec: { comment: 100003 },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 44,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 0,
      size: 101569
    },
    expected: {
      width: 9,
      height: 44,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 4,
      sourcePages: 4,
      pageHeight: 11,
      delay: [0, 70, 140, 210],
      loop: 0
    },
    hash: "92cf497309357db87f489f1ef998ebe7fb6384647ac5262506b5d33d1f75f978"
  },
  {
    spec: { frames: 1, transparent: true },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 11,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 1,
      delay: [0],
      size: 879
    },
    expected: {
      width: 9,
      height: 11,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      delay: [0]
    },
    hash: "333ba9bd4633f73cebe25f9e2cb4680bee7c8dff309d5f17aea9f2d853b25f03"
  },
  {
    spec: { frames: 2, interlace: false },
    options: { animated: true },
    metadata: {
      format: "gif",
      width: 9,
      height: 22,
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: true,
      pages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0,
      size: 976
    },
    expected: {
      width: 9,
      height: 22,
      format: "gif",
      space: "srgb",
      channels: 4,
      depth: "uchar",
      density: 72,
      hasAlpha: false,
      pages: 2,
      sourcePages: 2,
      pageHeight: 11,
      delay: [0, 70],
      loop: 0
    },
    hash: "b6bbad150c0533ff94ca15191322d17f86882362e11c9b86bd85fc5547cc7372"
  }
];

it.each(gifInputVectors)("retained GIF preserves $spec with $options", async (vector) => {
  const bytes = gifInputFixture(vector.spec),
    fs = new MemoryFileSystem(),
    signal = new AbortController().signal,
    storage = new PagedStorage({ fs, cwd: "/", env: {}, signal });
  try {
    const result = decodeGifToStorage(
      { size: bytes.length, read: async (at, length) => bytes.subarray(at, at + length) },
      storage,
      signal,
      vector.options
    );
    if (vector.error) {
      await expect(result).rejects.toThrow(vector.error);
      return;
    }
    const { position, storedDelay, ...metadata } = await result,
      delay = storedDelay
        ? await Promise.all(Array.from({ length: storedDelay.length }, (_, i) => storedDelay.at(i)))
        : undefined;
    expect({ ...metadata, ...(delay ? { delay } : {}) }).toEqual(vector.expected);
    const hash = createHash("sha256"),
      length = metadata.width * metadata.height * 4;
    for (let at = 0; at < length; at += 4096)
      hash.update(await storage.read(position + at, Math.min(4096, length - at)));
    expect(hash.digest("hex")).toBe(vector.hash);
  } finally {
    await storage.close();
  }
});
it("honors the delay consumer signal independently of the decoder signal", async () => {
  const bytes = gifInputFixture({ frames: 1 }),
    fs = new MemoryFileSystem(),
    storage = new PagedStorage({ fs, cwd: "/", env: {}, signal: new AbortController().signal });
  try {
    const image = await decodeGifToStorage(
      { size: bytes.length, read: async (at, length) => bytes.subarray(at, at + length) },
      storage,
      new AbortController().signal
    );
    const controller = new AbortController(),
      reason = { delays: true };
    controller.abort(reason);
    await expect(image.storedDelay!.at(0, { signal: controller.signal })).rejects.toBe(reason);
    expect(await image.storedDelay!.at(0.5)).toBeUndefined();
  } finally {
    await storage.close();
  }
});

function backing() {
  const memory = new Uint8Array(8 * 1024 * 1024),
    borrowed = new Uint8Array(4096);
  let end = 8;
  return {
    memory,
    storage: {
      allocate: vi.fn((length: number) => {
        const position = end;
        end += length;
        if (end > memory.length) throw new Error("fixture exhausted");
        return position;
      }),
      write: vi.fn(async (position: number, bytes: Uint8Array) => {
        if (
          !Number.isSafeInteger(position) ||
          position < 8 ||
          position + bytes.length > end ||
          bytes.length > 4096
        )
          throw new Error("invalid storage write");
        memory.set(bytes, position);
      }),
      read: vi.fn(async (position: number, length: number) => {
        if (
          !Number.isSafeInteger(position) ||
          length > 4096 ||
          position < 8 ||
          position + length > end
        )
          throw new Error("invalid backing read");
        borrowed.fill(37);
        borrowed.set(memory.subarray(position, position + length));
        return borrowed.subarray(0, length);
      })
    }
  };
}
function source(bytes: Uint8Array) {
  const borrowed = new Uint8Array(4096);
  return {
    size: bytes.length,
    read: vi.fn(async (position: number, length: number) => {
      if (length > 4096 || position < 0 || position + length > bytes.length)
        throw new Error("invalid source read");
      borrowed.fill(39);
      borrowed.set(bytes.subarray(position, position + length));
      return borrowed.subarray(0, length);
    })
  };
}
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
it.each([2, 3])(
  "owns source/canvas pages across wide interlaced disposal %i frames",
  async (disposal) => {
    const bytes = gifInputFixture({
        width: 1031,
        height: 37,
        frames: 4,
        local: true,
        interlace: true,
        offset: true,
        transparent: true,
        disposal
      }),
      before = new Uint8Array(bytes),
      expected = decodeGifImage(bytes, { animated: true }),
      { memory, storage } = backing(),
      input = source(bytes),
      Original = Uint8Array;
    vi.stubGlobal(
      "Uint8Array",
      new Proxy(Original, {
        construct(target, args) {
          const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
          if (length > 4096) throw new Error("unbounded GIF decoder allocation");
          return Reflect.construct(target, args);
        }
      })
    );
    try {
      const actual = await decodeGifToStorage(input, storage, new AbortController().signal, {
        animated: true
      });
      expect(digest(memory.subarray(actual.position, actual.position + expected.data.length))).toBe(
        digest(expected.data)
      );
      expect(storage.allocate.mock.calls.length).toBe(4);
      expect(input.read.mock.calls.length).toBeGreaterThan(32);
      expect(bytes).toEqual(before);
    } finally {
      vi.unstubAllGlobals();
    }
  }
);
it("retains thousands of frame delays in caller storage with bounded typed arrays", async () => {
  const frames = 3000,
    bytes = gifInputFixture({ width: 1, height: 1, frames }),
    { memory, storage } = backing(),
    input = source(bytes),
    Original = Uint8Array,
    OriginalInts = Int32Array;
  vi.stubGlobal(
    "Uint8Array",
    new Proxy(Original, {
      construct(target, args) {
        const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
        if (length > 4096) throw new Error("unbounded animation metadata");
        return Reflect.construct(target, args);
      }
    })
  );
  vi.stubGlobal(
    "Int32Array",
    new Proxy(OriginalInts, {
      construct(target, args) {
        if (typeof args[0] === "number" && args[0] > 4096)
          throw new Error("unbounded row/delay metadata");
        return Reflect.construct(target, args);
      }
    })
  );
  try {
    const actual = await decodeGifToStorage(input, storage, new AbortController().signal);
    expect(actual).not.toHaveProperty("delay");
    expect(actual.storedDelay?.length).toBe(frames);
    expect(storage.allocate.mock.calls.map(([length]) => length)).toEqual([frames * 4, 4, 4]);
    const first = await actual.storedDelay!.at(0),
      last = await actual.storedDelay!.at(frames - 1);
    expect(first).toBe(0);
    expect(last).toBe((((frames - 1) * 7) & 255) * 10);
    expect(await actual.storedDelay!.at(-1)).toBeUndefined();
    expect(await actual.storedDelay!.at(frames)).toBeUndefined();
    expect(memory[actual.position + 3]).toBe(255);
  } finally {
    vi.unstubAllGlobals();
  }
});
it.each(["start", "source", "write", "backing", "checkpoint"])(
  "preserves GIF decoder %s cancellation",
  async (phase) => {
    const { storage } = backing(),
      input = source(gifInputFixture({ width: 1031, height: 37, frames: 2, disposal: 3 })),
      controller = new AbortController(),
      reason = { phase };
    let sourceReads = 0,
      writes = 0,
      backingReads = 0;
    if (phase === "start") controller.abort(reason);
    if (phase === "source") {
      const read = input.read.getMockImplementation()!;
      input.read.mockImplementationOnce(async (position, length) => {
        const bytes = await read(position, length);
        sourceReads = 1;
        controller.abort(reason);
        return bytes;
      });
    }
    if (phase === "write")
      storage.write.mockImplementationOnce(async () => {
        sourceReads = input.read.mock.calls.length;
        writes = 1;
        controller.abort(reason);
      });
    if (phase === "backing") {
      const read = storage.read.getMockImplementation()!;
      storage.read.mockImplementationOnce(async (position, length) => {
        const bytes = await read(position, length);
        sourceReads = input.read.mock.calls.length;
        writes = storage.write.mock.calls.length;
        backingReads = 1;
        controller.abort(reason);
        return bytes;
      });
    }
    const checkpoint =
      phase === "checkpoint"
        ? vi.spyOn(defaultRuntime, "yieldTurn").mockImplementationOnce(async () => {
            sourceReads = input.read.mock.calls.length;
            writes = storage.write.mock.calls.length;
            backingReads = storage.read.mock.calls.length;
            controller.abort(reason);
          })
        : undefined;
    try {
      await expect(
        decodeGifToStorage(input, storage, controller.signal, { animated: true })
      ).rejects.toBe(reason);
      expect(input.read).toHaveBeenCalledTimes(sourceReads);
      expect(storage.write).toHaveBeenCalledTimes(writes);
      expect(storage.read).toHaveBeenCalledTimes(backingReads);
    } finally {
      checkpoint?.mockRestore();
    }
  }
);
it.each(["source", "write", "read", "allocate"])(
  "propagates GIF decoder %s faults",
  async (phase) => {
    const { storage } = backing(),
      input = source(gifInputFixture({ disposal: 3 })),
      reason = new Error(phase);
    if (phase === "source") input.read.mockResolvedValueOnce(new Uint8Array(3));
    if (phase === "read") storage.read.mockResolvedValueOnce(new Uint8Array(1));
    if (phase === "write") storage.write.mockRejectedValueOnce(reason);
    if (phase === "allocate") storage.allocate.mockReturnValueOnce(-1);
    const result = decodeGifToStorage(input, storage, new AbortController().signal);
    if (phase === "write") await expect(result).rejects.toBe(reason);
    else
      await expect(result).rejects.toThrow(
        phase === "source"
          ? "Truncated GIF source"
          : phase === "read"
            ? "Truncated GIF backing storage"
            : "Invalid GIF backing allocation"
      );
  }
);
it("propagates delayed metadata I/O errors and cancellation after decode", async () => {
  const { storage } = backing(),
    controller = new AbortController(),
    reason = { cancel: "delay" },
    image = await decodeGifToStorage(
      source(gifInputFixture({ frames: 3 })),
      storage,
      controller.signal
    ),
    failure = new Error("delay read");
  storage.read.mockRejectedValueOnce(failure);
  await expect(image.storedDelay!.at(1)).rejects.toBe(failure);
  controller.abort(reason);
  const reads = storage.read.mock.calls.length;
  await expect(image.storedDelay!.at(1)).rejects.toBe(reason);
  expect(storage.read).toHaveBeenCalledTimes(reads);
});
it("checks stacked pixel limits before allocating frame canvases or metadata", async () => {
  const { storage } = backing();
  await expect(
    decodeGifToStorage(
      source(gifInputFixture({ width: 9, height: 11, frames: 4 })),
      storage,
      new AbortController().signal,
      { animated: true, limitInputPixels: 200 }
    )
  ).rejects.toThrow("pixel limit");
  expect(storage.allocate).not.toHaveBeenCalled();
});
// Hand-packed illegal future codes create a self-referencing prefix after one insertion.
it("bounds cyclic malformed LZW dictionary traversal", async () => {
  const bytes = gifInputFixture({
      width: 30,
      height: 1,
      frames: 1,
      noGce: true,
      noGlobal: true,
      mode: "early"
    }),
    descriptor = 13,
    minimum = descriptor + 10,
    payload = minimum + 2;
  bytes[minimum] = 2;
  const codes = [4, 0, 7, 7, 7, 5],
    bits: number[] = [];
  let width = 3,
    next = 6,
    old = false;
  for (const code of codes) {
    for (let i = 0; i < width; i++) bits.push((code >>> i) & 1);
    if (code === 4) {
      width = 3;
      next = 6;
      old = false;
      continue;
    }
    if (old && next < 4096) {
      next++;
      if (next === 1 << width && width < 12) width++;
    }
    old = true;
  }
  const packed = new Uint8Array(Math.ceil(bits.length / 8));
  bits.forEach((bit, i) => (packed[i >>> 3]! |= bit << (i & 7)));
  const altered = new Uint8Array(payload + packed.length + 2);
  altered.set(bytes.subarray(0, payload));
  altered[minimum + 1] = packed.length;
  altered.set(packed, payload);
  altered[altered.length - 1] = 59;
  const { storage } = backing();
  await expect(
    decodeGifToStorage(source(altered), storage, new AbortController().signal)
  ).rejects.toThrow("Invalid GIF LZW dictionary");
});
it.each([0, 1, 9, 12, 31, 32, 255])(
  "terminates bounded malformed minCodeSize %i decoding",
  async (minimum) => {
    const bytes = gifInputFixture({
        width: 129,
        height: 2,
        frames: 1,
        noGce: true,
        noGlobal: true
      }),
      at = 23;
    bytes[at] = minimum;
    const { storage } = backing(),
      Original = Uint8Array;
    vi.stubGlobal(
      "Uint8Array",
      new Proxy(Original, {
        construct(target, args) {
          const length = typeof args[0] === "number" ? args[0] : (args[0]?.length ?? 0);
          if (length > 4096) throw new Error("unbounded malformed GIF allocation");
          return Reflect.construct(target, args);
        }
      })
    );
    try {
      try {
        const result = await decodeGifToStorage(
          source(bytes),
          storage,
          new AbortController().signal
        );
        expect(result.width).toBe(129);
        expect(result.height).toBe(2);
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("Invalid GIF LZW dictionary");
      }
    } finally {
      vi.unstubAllGlobals();
    }
  }
);
it("observes cancellation while scanning a large extension before allocating", async () => {
  const input = {
      size: 5_000_000,
      async read(position: number, length: number) {
        const bytes = new Uint8Array(length).fill(255);
        if (position === 0) bytes.set([71, 73, 70, 56, 57, 97, 1, 0, 1, 0, 0, 0, 0, 33, 254]);
        return bytes;
      }
    },
    { storage } = backing(),
    controller = new AbortController(),
    reason = { cancel: "metadata scan" },
    checkpoint = vi.spyOn(defaultRuntime, "yieldTurn").mockImplementationOnce(async () => {
      controller.abort(reason);
    });
  try {
    await expect(decodeGifToStorage(input, storage, controller.signal)).rejects.toBe(reason);
    expect(storage.allocate).not.toHaveBeenCalled();
  } finally {
    checkpoint.mockRestore();
  }
});

it.each([{}, { animated: true }, { page: 1, pages: 2 }, { page: 8, animated: true }])(
  "retains GIF file input and animated output with %j",
  async (options) => {
    const fs = new MemoryFileSystem(),
      bytes = gifInputFixture({
        local: true,
        interlace: true,
        offset: true,
        transparent: true,
        loop: 2
      });
    await fs.writeFile("/in", bytes);
    const guarded = new Proxy(fs, {
      get(target, key) {
        if (key === "readFile" || key === "writeFile")
          return () => {
            throw new Error("whole-file I/O forbidden");
          };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
    });
    for (const format of ["png", "gif", "tiff", "bmp"] as const) {
      const expected = sharp(bytes, options).flop().toFormat(format).toBufferWithObjectSync(),
        info = await sharp("/in", { ...options, filesystem: guarded })
          .flop()
          .toFormat(format)
          .toFile("/out");
      const actual = await fs.readFile("/out");
      expect(info).toEqual({ ...expected.info, size: actual.length });
      if (format === "png") {
        // Streaming PNG uses different IDAT boundaries; pixels and metadata stay identical.
        expect(await sharp(actual).raw().toBuffer()).toEqual(await sharp(expected.data).raw().toBuffer());
      } else expect(Buffer.compare(actual, expected.data)).toBe(0);
    }
    expect((await fs.readdir("/")).map((entry) => entry.name)).toEqual(["in", "out"]);
  }
);
it("resolves GIF composite resources through the parent retained filesystem", async () => {
  const fs = new MemoryFileSystem(),
    bytes = gifInputFixture({ frames: 1 });
  await fs.writeFile("/in", bytes);
  const raw = new Uint8Array(9 * 11 * 4).fill(255),
    base = sharp(raw, { raw: { width: 9, height: 11, channels: 4 } })
      .png()
      .toBufferSync();
  await fs.writeFile("/base", base);
  const guarded = new Proxy(fs, {
    get(target, key) {
      if (key === "readFile" || key === "writeFile")
        return () => {
          throw new Error("whole-file I/O forbidden");
        };
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
  const expected = sharp(base)
    .composite([{ input: bytes }])
    .png()
    .toBufferSync();
  await sharp("/base", { filesystem: guarded })
    .composite([{ input: "/in" }])
    .png()
    .toFile("/out");
  expect(await sharp(await fs.readFile("/out")).raw().toBuffer()).toEqual(await sharp(expected).raw().toBuffer());
});
