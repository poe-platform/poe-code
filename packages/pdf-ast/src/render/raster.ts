import { parseCosDocument } from "../cos/parser.js";
import { PdfPage } from "../canvas.js";
import { dictGet, type PdfCosDict, type PdfCosNode, type PdfCosRef } from "../ast.js";
import type { PdfDisplayList, PdfPathSegment, PdfRgbColor } from "../ast.js";
import { applyPredictor, decodeFlate, encodeFlate } from "../cos/filters.js";

export interface RgbaBitmap {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
}

export function encodePng(bitmap: RgbaBitmap): Uint8Array {
  return encodeRgbaToPng(bitmap.width, bitmap.height, bitmap.data);
}

export function decodePng(pngBytes: Uint8Array): RgbaBitmap {
  if (pngBytes.length < 24 || pngBytes[0] !== 137 || pngBytes[1] !== 80 || pngBytes[2] !== 78 || pngBytes[3] !== 71) {
    throw new Error("Invalid PNG signature");
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  let width = 0, height = 0, bitDepth = 8, colorType = 2;
  const idatParts: Uint8Array[] = [];
  let pos = 8;
  while (pos + 8 <= pngBytes.length) {
    const len = view.getUint32(pos, false);
    const type = String.fromCharCode(pngBytes[pos + 4]!, pngBytes[pos + 5]!, pngBytes[pos + 6]!, pngBytes[pos + 7]!);
    const chunkData = pngBytes.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = view.getUint32(pos + 8, false);
      height = view.getUint32(pos + 12, false);
      bitDepth = chunkData[8]!;
      colorType = chunkData[9]!;
    } else if (type === "IDAT") {
      idatParts.push(chunkData);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len;
  }
  const totalIdat = idatParts.reduce((s, c) => s + c.length, 0);
  const mergedIdat = new Uint8Array(totalIdat);
  let off = 0;
  for (const part of idatParts) {
    mergedIdat.set(part, off);
    off += part.length;
  }
  const inflated = decodeFlate(mergedIdat);
  const colors = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : 1;
  const unpredicted = applyPredictor(inflated, {
    Predictor: 15,
    Columns: width,
    Colors: colors,
    BitsPerComponent: bitDepth,
  });
  const data = new Uint8Array(width * height * 4);
  if (colors === 4) {
    data.set(unpredicted.subarray(0, width * height * 4));
  } else if (colors === 3) {
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = unpredicted[i * 3]!;
      data[i * 4 + 1] = unpredicted[i * 3 + 1]!;
      data[i * 4 + 2] = unpredicted[i * 3 + 2]!;
      data[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      const g = unpredicted[i * colors]!;
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = colors === 2 ? unpredicted[i * 2 + 1]! : 255;
    }
  }
  return { width, height, data };
}

export interface RenderToPngOptions {
  readonly scale?: number | undefined;
  readonly dpi?: number | undefined;
  readonly background?: PdfRgbColor | undefined;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function makePngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  const crc = crc32(out.subarray(4, 8 + data.length));
  view.setUint32(8 + data.length, crc, false);
  return out;
}

export function encodeRgbaToPng(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const signature = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = new Uint8Array(13);
  const ihdrView = new DataView(ihdr.buffer);
  ihdrView.setUint32(0, width, false);
  ihdrView.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth 8
  ihdr[9] = 6; // color type 6 (RGBA)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const rawScanlines = new Uint8Array((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    rawScanlines[rowStart] = 0; // Filter type 0 (None)
    rawScanlines.set(rgba.subarray(y * stride, (y + 1) * stride), rowStart + 1);
  }

  const compressed = encodeFlate(rawScanlines);
  const ihdrChunk = makePngChunk("IHDR", ihdr);
  const idatChunk = makePngChunk("IDAT", compressed);
  const iendChunk = makePngChunk("IEND", new Uint8Array(0));

  const total = signature.length + ihdrChunk.length + idatChunk.length + iendChunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of [signature, ihdrChunk, idatChunk, iendChunk]) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function blendPixel(
  rgba: Uint8Array,
  width: number,
  height: number,
  px: number,
  py: number,
  color: PdfRgbColor,
  alpha: number
): void {
  if (px < 0 || py < 0 || px >= width || py >= height || alpha <= 0) return;
  const a = Math.min(1, Math.max(0, alpha));
  const idx = (py * width + px) * 4;
  const srcR = Math.round(Math.min(1, Math.max(0, color.r)) * 255);
  const srcG = Math.round(Math.min(1, Math.max(0, color.g)) * 255);
  const srcB = Math.round(Math.min(1, Math.max(0, color.b)) * 255);
  rgba[idx] = Math.round(srcR * a + rgba[idx]! * (1 - a));
  rgba[idx + 1] = Math.round(srcG * a + rgba[idx + 1]! * (1 - a));
  rgba[idx + 2] = Math.round(srcB * a + rgba[idx + 2]! * (1 - a));
  rgba[idx + 3] = 255;
}

function drawAntiAliasedSegment(
  rgba: Uint8Array,
  width: number,
  height: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  strokeWidth: number,
  color: PdfRgbColor
): void {
  const halfW = Math.max(0.6, strokeWidth * 0.5);
  const minX = Math.max(0, Math.floor(Math.min(x0, x1) - halfW - 1));
  const maxX = Math.min(width - 1, Math.ceil(Math.max(x0, x1) + halfW + 1));
  const minY = Math.max(0, Math.floor(Math.min(y0, y1) - halfW - 1));
  const maxY = Math.min(height - 1, Math.ceil(Math.max(y0, y1) + halfW + 1));

  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;

  for (let py = minY; py <= maxY; py++) {
    for (let px = minX; px <= maxX; px++) {
      const cx = px + 0.5;
      const cy = py + 0.5;
      let t = lenSq > 1e-6 ? ((cx - x0) * dx + (cy - y0) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const projX = x0 + t * dx;
      const projY = y0 + t * dy;
      const dist = Math.hypot(cx - projX, cy - projY);
      if (dist <= halfW + 0.75) {
        const cov = Math.max(0, Math.min(1, halfW + 0.5 - dist));
        blendPixel(rgba, width, height, px, py, color, cov);
      }
    }
  }
}

interface Edge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function segmentsToScreenEdges(
  segments: readonly PdfPathSegment[],
  pageHeight: number,
  scale: number
): Edge[] {
  const edges: Edge[] = [];
  let curX = 0;
  let curY = 0;
  let startX = 0;
  let startY = 0;

  const toScreen = (x: number, y: number): [number, number] => [x * scale, (pageHeight - y) * scale];

  for (const seg of segments) {
    if (seg.kind === "move") {
      [curX, curY] = toScreen(seg.x, seg.y);
      startX = curX;
      startY = curY;
    } else if (seg.kind === "line") {
      const [nx, ny] = toScreen(seg.x, seg.y);
      edges.push({ x0: curX, y0: curY, x1: nx, y1: ny });
      curX = nx;
      curY = ny;
    } else if (seg.kind === "cubic") {
      const [p1x, p1y] = toScreen(seg.x1, seg.y1);
      const [p2x, p2y] = toScreen(seg.x2, seg.y2);
      const [p3x, p3y] = toScreen(seg.x, seg.y);
      const steps = 12;
      let px = curX;
      let py = curY;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        const mt = 1 - t;
        const qx =
          mt * mt * mt * curX +
          3 * mt * mt * t * p1x +
          3 * mt * t * t * p2x +
          t * t * t * p3x;
        const qy =
          mt * mt * mt * curY +
          3 * mt * mt * t * p1y +
          3 * mt * t * t * p2y +
          t * t * t * p3y;
        edges.push({ x0: px, y0: py, x1: qx, y1: qy });
        px = qx;
        py = qy;
      }
      curX = p3x;
      curY = p3y;
    } else if (seg.kind === "close") {
      if (curX !== startX || curY !== startY) {
        edges.push({ x0: curX, y0: curY, x1: startX, y1: startY });
        curX = startX;
        curY = startY;
      }
    } else if (seg.kind === "rect") {
      const [rx0, ry0] = toScreen(seg.x, seg.y + seg.height);
      const [rx1, ry1] = toScreen(seg.x + seg.width, seg.y);
      edges.push(
        { x0: rx0, y0: ry0, x1: rx1, y1: ry0 },
        { x0: rx1, y0: ry0, x1: rx1, y1: ry1 },
        { x0: rx1, y0: ry1, x1: rx0, y1: ry1 },
        { x0: rx0, y0: ry1, x1: rx0, y1: ry0 }
      );
    }
  }
  return edges;
}

function fillEdgesScanline4x4(
  rgba: Uint8Array,
  width: number,
  height: number,
  edges: readonly Edge[],
  color: PdfRgbColor
): void {
  if (edges.length === 0) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const e of edges) {
    minY = Math.min(minY, e.y0, e.y1);
    maxY = Math.max(maxY, e.y0, e.y1);
  }
  const startRow = Math.max(0, Math.floor(minY));
  const endRow = Math.min(height - 1, Math.ceil(maxY));

  const subOffsets = [0.125, 0.375, 0.625, 0.875];
  for (let py = startRow; py <= endRow; py++) {
    const rowCounts = new Uint8Array(width);
    for (const sy of subOffsets) {
      const scanY = py + sy;
      const xs: number[] = [];
      for (const e of edges) {
        if ((e.y0 <= scanY && e.y1 > scanY) || (e.y1 <= scanY && e.y0 > scanY)) {
          const t = (scanY - e.y0) / (e.y1 - e.y0);
          xs.push(e.x0 + t * (e.x1 - e.x0));
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const xStart = Math.max(0, Math.floor(xs[i]!));
        const xEnd = Math.min(width - 1, Math.ceil(xs[i + 1]!));
        for (let px = xStart; px <= xEnd; px++) {
          for (const sx of subOffsets) {
            const sampleX = px + sx;
            if (sampleX >= xs[i]! && sampleX <= xs[i + 1]!) {
              rowCounts[px] = (rowCounts[px] ?? 0) + 1;
            }
          }
        }
      }
    }
    for (let px = 0; px < width; px++) {
      const count = rowCounts[px]!;
      if (count > 0) {
        blendPixel(rgba, width, height, px, py, color, count / 16);
      }
    }
  }
}

// Minimal clean vector stroke glyph outlines for rendering readable text on PNGs
const VECTOR_GLYPH_STROKES: Readonly<Record<string, ReadonlyArray<readonly [number, number, number, number]>>> = {
  A: [[0.1, 0, 0.5, 0.75], [0.5, 0.75, 0.9, 0], [0.24, 0.28, 0.76, 0.28]],
  B: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.75, 0.75], [0.75, 0.75, 0.75, 0.4], [0.15, 0.4, 0.8, 0.4], [0.8, 0.4, 0.8, 0], [0.15, 0, 0.8, 0]],
  C: [[0.85, 0.65, 0.2, 0.75], [0.2, 0.75, 0.15, 0.1], [0.15, 0.1, 0.85, 0.1]],
  D: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.75, 0.6], [0.75, 0.6, 0.75, 0.15], [0.75, 0.15, 0.15, 0]],
  E: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0.75], [0.15, 0.38, 0.72, 0.38], [0.15, 0, 0.85, 0]],
  F: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0.75], [0.15, 0.38, 0.72, 0.38]],
  G: [[0.85, 0.65, 0.2, 0.75], [0.2, 0.75, 0.15, 0.05], [0.15, 0.05, 0.85, 0.05], [0.85, 0.05, 0.85, 0.38], [0.5, 0.38, 0.85, 0.38]],
  H: [[0.15, 0, 0.15, 0.75], [0.85, 0, 0.85, 0.75], [0.15, 0.38, 0.85, 0.38]],
  I: [[0.5, 0, 0.5, 0.75], [0.25, 0.75, 0.75, 0.75], [0.25, 0, 0.75, 0]],
  J: [[0.75, 0.75, 0.75, 0.15], [0.75, 0.15, 0.4, 0], [0.4, 0, 0.15, 0.2]],
  K: [[0.15, 0, 0.15, 0.75], [0.85, 0.75, 0.15, 0.35], [0.35, 0.45, 0.85, 0]],
  L: [[0.15, 0.75, 0.15, 0], [0.15, 0, 0.85, 0]],
  M: [[0.1, 0, 0.1, 0.75], [0.1, 0.75, 0.5, 0.2], [0.5, 0.2, 0.9, 0.75], [0.9, 0.75, 0.9, 0]],
  N: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.85, 0], [0.85, 0, 0.85, 0.75]],
  O: [[0.15, 0.1, 0.15, 0.65], [0.15, 0.65, 0.85, 0.65], [0.85, 0.65, 0.85, 0.1], [0.85, 0.1, 0.15, 0.1]],
  P: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.8, 0.75], [0.8, 0.75, 0.8, 0.38], [0.8, 0.38, 0.15, 0.38]],
  Q: [[0.15, 0.1, 0.15, 0.65], [0.15, 0.65, 0.85, 0.65], [0.85, 0.65, 0.85, 0.1], [0.85, 0.1, 0.15, 0.1], [0.55, 0.25, 0.9, -0.05]],
  R: [[0.15, 0, 0.15, 0.75], [0.15, 0.75, 0.8, 0.75], [0.8, 0.75, 0.8, 0.38], [0.8, 0.38, 0.15, 0.38], [0.45, 0.38, 0.85, 0]],
  S: [[0.85, 0.68, 0.2, 0.72], [0.2, 0.72, 0.2, 0.4], [0.2, 0.4, 0.8, 0.35], [0.8, 0.35, 0.8, 0.05], [0.8, 0.05, 0.15, 0.05]],
  T: [[0.5, 0, 0.5, 0.75], [0.1, 0.75, 0.9, 0.75]],
  U: [[0.15, 0.75, 0.15, 0.1], [0.15, 0.1, 0.85, 0.1], [0.85, 0.1, 0.85, 0.75]],
  V: [[0.1, 0.75, 0.5, 0], [0.5, 0, 0.9, 0.75]],
  W: [[0.08, 0.75, 0.28, 0], [0.28, 0, 0.5, 0.5], [0.5, 0.5, 0.72, 0], [0.72, 0, 0.92, 0.75]],
  X: [[0.15, 0.75, 0.85, 0], [0.85, 0.75, 0.15, 0]],
  Y: [[0.15, 0.75, 0.5, 0.38], [0.85, 0.75, 0.5, 0.38], [0.5, 0.38, 0.5, 0]],
  Z: [[0.15, 0.75, 0.85, 0.75], [0.85, 0.75, 0.15, 0], [0.15, 0, 0.85, 0]],
  "0": [[0.18, 0.05, 0.18, 0.7], [0.18, 0.7, 0.82, 0.7], [0.82, 0.7, 0.82, 0.05], [0.82, 0.05, 0.18, 0.05], [0.22, 0.1, 0.78, 0.65]],
  "1": [[0.25, 0.58, 0.5, 0.75], [0.5, 0.75, 0.5, 0], [0.22, 0, 0.78, 0]],
  "2": [[0.18, 0.6, 0.5, 0.75], [0.5, 0.75, 0.82, 0.55], [0.82, 0.55, 0.15, 0], [0.15, 0, 0.85, 0]],
  "3": [[0.18, 0.72, 0.8, 0.72], [0.8, 0.72, 0.45, 0.4], [0.45, 0.4, 0.82, 0.15], [0.82, 0.15, 0.18, 0.02]],
  "4": [[0.7, 0, 0.7, 0.75], [0.7, 0.75, 0.15, 0.25], [0.15, 0.25, 0.88, 0.25]],
  "5": [[0.82, 0.75, 0.2, 0.75], [0.2, 0.75, 0.2, 0.42], [0.2, 0.42, 0.8, 0.35], [0.8, 0.35, 0.75, 0.03], [0.75, 0.03, 0.18, 0.03]],
  "6": [[0.78, 0.72, 0.2, 0.4], [0.2, 0.4, 0.2, 0.05], [0.2, 0.05, 0.8, 0.05], [0.8, 0.05, 0.8, 0.38], [0.8, 0.38, 0.2, 0.38]],
  "7": [[0.15, 0.75, 0.85, 0.75], [0.85, 0.75, 0.35, 0]],
  "8": [[0.2, 0.05, 0.8, 0.05], [0.8, 0.05, 0.8, 0.7], [0.8, 0.7, 0.2, 0.7], [0.2, 0.7, 0.2, 0.05], [0.2, 0.38, 0.8, 0.38]],
  "9": [[0.8, 0.38, 0.2, 0.38], [0.2, 0.38, 0.2, 0.72], [0.2, 0.72, 0.8, 0.72], [0.8, 0.72, 0.8, 0.05], [0.8, 0.05, 0.25, 0.02]],
  "-": [[0.2, 0.35, 0.8, 0.35]],
  ".": [[0.45, 0, 0.55, 0.08]],
  ":": [[0.45, 0.05, 0.55, 0.12], [0.45, 0.45, 0.55, 0.52]],
  "/": [[0.2, 0, 0.8, 0.75]],
  "%": [[0.2, 0, 0.8, 0.75], [0.2, 0.55, 0.35, 0.7], [0.65, 0.05, 0.8, 0.2]],
  "$": [[0.5, -0.05, 0.5, 0.8], [0.8, 0.65, 0.2, 0.65], [0.2, 0.65, 0.2, 0.4], [0.2, 0.4, 0.8, 0.35], [0.8, 0.35, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1]],
  "[": [[0.65, 0.75, 0.3, 0.75], [0.3, 0.75, 0.3, 0], [0.3, 0, 0.65, 0]],
  "]": [[0.35, 0.75, 0.7, 0.75], [0.7, 0.75, 0.7, 0], [0.7, 0, 0.35, 0]],
  "(": [[0.65, 0.75, 0.35, 0.5], [0.35, 0.5, 0.35, 0.25], [0.35, 0.25, 0.65, 0]],
  ")": [[0.35, 0.75, 0.65, 0.5], [0.65, 0.5, 0.65, 0.25], [0.65, 0.25, 0.35, 0]],
  ",": [[0.5, 0.12, 0.45, 0], [0.45, 0, 0.35, -0.1]],
  ";": [[0.45, 0.45, 0.55, 0.52], [0.5, 0.15, 0.38, -0.08]],
  "&": [[0.75, 0.02, 0.22, 0.6], [0.22, 0.6, 0.5, 0.75], [0.5, 0.75, 0.68, 0.58], [0.68, 0.58, 0.18, 0.22], [0.18, 0.22, 0.45, 0.02], [0.45, 0.02, 0.82, 0.32]],
  "'": [[0.5, 0.75, 0.45, 0.52]],
  "\"": [[0.35, 0.75, 0.35, 0.52], [0.65, 0.75, 0.65, 0.52]],
  "!": [[0.5, 0.75, 0.5, 0.2], [0.48, 0.06, 0.52, 0]],
  "?": [[0.22, 0.6, 0.5, 0.75], [0.5, 0.75, 0.78, 0.58], [0.78, 0.58, 0.5, 0.35], [0.5, 0.35, 0.5, 0.2], [0.48, 0.06, 0.52, 0]],
  "+": [[0.5, 0.12, 0.5, 0.62], [0.2, 0.37, 0.8, 0.37]],
  "=": [[0.2, 0.48, 0.8, 0.48], [0.2, 0.26, 0.8, 0.26]],
  "_": [[0.1, 0, 0.9, 0]],
  "#": [[0.32, 0.05, 0.38, 0.72], [0.62, 0.05, 0.68, 0.72], [0.15, 0.5, 0.85, 0.5], [0.15, 0.26, 0.85, 0.26]],
  "*": [[0.5, 0.15, 0.5, 0.65], [0.22, 0.25, 0.78, 0.55], [0.22, 0.55, 0.78, 0.25]],
};

export function renderDisplayListToPng(
  displayList: PdfDisplayList,
  options: RenderToPngOptions = {}
): Uint8Array {
  const scale = options.scale ?? (options.dpi ? options.dpi / 72 : 1.5);
  const width = Math.max(1, Math.round(displayList.width * scale));
  const height = Math.max(1, Math.round(displayList.height * scale));
  const rgba = new Uint8Array(width * height * 4);

  const bg = options.background ?? { r: 1, g: 1, b: 1 };
  const bgR = Math.round(bg.r * 255);
  const bgG = Math.round(bg.g * 255);
  const bgB = Math.round(bg.b * 255);
  for (let i = 0; i < width * height; i++) {
    rgba[i * 4] = bgR;
    rgba[i * 4 + 1] = bgG;
    rgba[i * 4 + 2] = bgB;
    rgba[i * 4 + 3] = 255;
  }

  // 1. Render vector paths
  for (const path of displayList.paths) {
    const edges = segmentsToScreenEdges(path.segments, displayList.height, scale);
    if (path.fillColor) {
      fillEdgesScanline4x4(rgba, width, height, edges, path.fillColor);
    }
    if (path.strokeColor) {
      const sw = Math.max(1, path.strokeWidth * scale);
      for (const e of edges) {
        drawAntiAliasedSegment(rgba, width, height, e.x0, e.y0, e.x1, e.y1, sw, path.strokeColor);
      }
    }
  }

  // 2. Render placed images
  for (const img of displayList.images) {
    if (!img.decodedRgba) continue;
    const dstX0 = Math.round(img.matrix[4] * scale);
    const dstW = Math.max(1, Math.round(Math.abs(img.matrix[0]) * scale));
    const dstH = Math.max(1, Math.round(Math.abs(img.matrix[3]) * scale));
    const dstY0 = Math.round((displayList.height - (img.matrix[5] + Math.abs(img.matrix[3]))) * scale);
    for (let dy = 0; dy < dstH; dy++) {
      const sy = Math.min(img.height - 1, Math.floor((dy / dstH) * img.height));
      for (let dx = 0; dx < dstW; dx++) {
        const sx = Math.min(img.width - 1, Math.floor((dx / dstW) * img.width));
        const sIdx = (sy * img.width + sx) * 4;
        blendPixel(
          rgba,
          width,
          height,
          dstX0 + dx,
          dstY0 + dy,
          {
            r: img.decodedRgba[sIdx]! / 255,
            g: img.decodedRgba[sIdx + 1]! / 255,
            b: img.decodedRgba[sIdx + 2]! / 255,
          },
          img.decodedRgba[sIdx + 3]! / 255
        );
      }
    }
  }

  // 3. Render placed glyphs with clean vector strokes
  for (const g of displayList.glyphs) {
    const ch = g.unicode.trim().toUpperCase();
    if (!ch) continue;
    const gx0 = g.bbox[0] * scale;
    const gyBase = (displayList.height - g.baselineY) * scale;
    const gw = Math.max(3, (g.bbox[2] - g.bbox[0]) * scale);
    const gh = Math.max(5, g.fontSize * scale);
    const strokes = VECTOR_GLYPH_STROKES[ch] ?? [[0.2, 0.1, 0.8, 0.1], [0.8, 0.1, 0.8, 0.6], [0.8, 0.6, 0.2, 0.6], [0.2, 0.6, 0.2, 0.1]];
    const sw = Math.max(1.1, gh * 0.1);
    for (const [sx0, sy0, sx1, sy1] of strokes) {
      drawAntiAliasedSegment(
        rgba,
        width,
        height,
        gx0 + sx0 * gw,
        gyBase - sy0 * gh,
        gx0 + sx1 * gw,
        gyBase - sy1 * gh,
        sw,
        g.color
      );
    }
  }

  return encodeRgbaToPng(width, height, rgba);
}

function collectLeavesForRaster(
  cosDoc: ReturnType<typeof parseCosDocument>,
  node: PdfCosNode | undefined,
  out: Array<{ ref: PdfCosRef; dict: PdfCosDict }> = [],
  visited = new Set<number>()
): Array<{ ref: PdfCosRef; dict: PdfCosDict }> {
  if (!node) return out;
  let ref: PdfCosRef | undefined;
  if (node.kind === "ref") {
    if (visited.has(node.objectNumber)) return out;
    visited.add(node.objectNumber);
    ref = node;
  }
  const dict = cosDoc.resolveDict(node);
  if (!dict) return out;
  const kids = cosDoc.resolveArray(dictGet(dict, "Kids"));
  if (kids) {
    for (const k of kids.items) collectLeavesForRaster(cosDoc, k, out, visited);
  } else {
    out.push({ ref: ref ?? cosDoc.allocateObject(dict), dict });
  }
  return out;
}

export function renderPdfPageToPng(
  pdfBytes: Uint8Array,
  pageIndex = 0,
  options?: RenderToPngOptions
): Uint8Array {
  const cos = parseCosDocument(pdfBytes);
  const catalog = cos.resolveDict(cos.rootRef);
  const leaves = collectLeavesForRaster(cos, catalog ? dictGet(catalog, "Pages") : undefined);
  const leaf = leaves[pageIndex];
  if (!leaf) throw new Error(`Page index ${pageIndex} out of bounds`);
  const page = new PdfPage(cos, leaf.ref, leaf.dict, pageIndex);
  return renderDisplayListToPng(page.evaluateDisplayList(), options);
}
