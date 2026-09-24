import {
  PdfDocument,
  decodePng,
  encodePng,
  type RgbaBitmap,
} from "@poe-code/pdf-ast";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition,
} from "safe-bash-contracts/command";

export interface CommandExecutionResult { readonly exitCode: number; }
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";

export interface TesseractLimits {
  readonly maxInputBytes: number;
  readonly maxDecodedPixels: number;
  readonly maxPages: number;
  readonly maxOutputBytes: number;
}

export const tesseractLimits: TesseractLimits = Object.freeze({
  maxInputBytes: 64 * 1024 * 1024,
  maxDecodedPixels: 32 * 1024 * 1024,
  maxPages: 500,
  maxOutputBytes: 64 * 1024 * 1024,
});

export interface TesseractCommandOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<TesseractLimits>;
  readonly languages?: readonly string[];
}

export interface OcrCharBox {
  readonly char: string;
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly conf: number;
}

export interface OcrWordBox {
  readonly text: string;
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly conf: number;
  readonly chars: readonly OcrCharBox[];
}

export interface OcrLineBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly words: readonly OcrWordBox[];
}

export interface OcrParagraphBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly lines: readonly OcrLineBox[];
}

export interface OcrBlockBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
  readonly paragraphs: readonly OcrParagraphBox[];
}

export interface OcrPageResult {
  readonly pageNumber: number;
  readonly width: number;
  readonly height: number;
  readonly dpi: number;
  readonly orientationDeg: 0 | 90 | 180 | 270;
  readonly scriptName: string;
  readonly bitmap: RgbaBitmap;
  readonly blocks: readonly OcrBlockBox[];
}

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: false });

const GLYPH_STROKES: Record<string, ReadonlyArray<readonly [number, number, number, number]>> = {
  A: [[0.1, 0, 0.5, 1], [0.9, 0, 0.5, 1], [0.25, 0.4, 0.75, 0.4]],
  B: [[0.15, 0, 0.15, 1], [0.15, 1, 0.75, 0.85], [0.75, 0.85, 0.15, 0.5], [0.15, 0.5, 0.8, 0.25], [0.8, 0.25, 0.15, 0]],
  C: [[0.85, 0.8, 0.25, 0.95], [0.25, 0.95, 0.15, 0.5], [0.15, 0.5, 0.25, 0.05], [0.25, 0.05, 0.85, 0.2]],
  D: [[0.15, 0, 0.15, 1], [0.15, 1, 0.75, 0.75], [0.75, 0.75, 0.75, 0.25], [0.75, 0.25, 0.15, 0]],
  E: [[0.15, 0, 0.15, 1], [0.15, 1, 0.85, 1], [0.15, 0.5, 0.75, 0.5], [0.15, 0, 0.85, 0]],
  F: [[0.15, 0, 0.15, 1], [0.15, 1, 0.85, 1], [0.15, 0.5, 0.75, 0.5]],
  G: [[0.85, 0.85, 0.2, 0.95], [0.2, 0.95, 0.15, 0.1], [0.15, 0.1, 0.85, 0.1], [0.85, 0.1, 0.85, 0.5], [0.5, 0.5, 0.85, 0.5]],
  H: [[0.15, 0, 0.15, 1], [0.85, 0, 0.85, 1], [0.15, 0.5, 0.85, 0.5]],
  I: [[0.5, 0, 0.5, 1], [0.25, 1, 0.75, 1], [0.25, 0, 0.75, 0]],
  J: [[0.75, 1, 0.75, 0.2], [0.75, 0.2, 0.4, 0], [0.4, 0, 0.15, 0.25]],
  K: [[0.15, 0, 0.15, 1], [0.85, 1, 0.15, 0.45], [0.35, 0.6, 0.85, 0]],
  L: [[0.15, 1, 0.15, 0], [0.15, 0, 0.85, 0]],
  M: [[0.1, 0, 0.1, 1], [0.1, 1, 0.5, 0.3], [0.5, 0.3, 0.9, 1], [0.9, 1, 0.9, 0]],
  N: [[0.15, 0, 0.15, 1], [0.15, 1, 0.85, 0], [0.85, 0, 0.85, 1]],
  O: [[0.2, 0.1, 0.2, 0.9], [0.2, 0.9, 0.8, 0.9], [0.8, 0.9, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1]],
  P: [[0.15, 0, 0.15, 1], [0.15, 1, 0.8, 0.85], [0.8, 0.85, 0.8, 0.55], [0.8, 0.55, 0.15, 0.5]],
  Q: [[0.2, 0.1, 0.2, 0.9], [0.2, 0.9, 0.8, 0.9], [0.8, 0.9, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1], [0.55, 0.35, 0.9, 0]],
  R: [[0.15, 0, 0.15, 1], [0.15, 1, 0.8, 0.85], [0.8, 0.85, 0.15, 0.5], [0.45, 0.5, 0.85, 0]],
  S: [[0.8, 0.85, 0.2, 0.85], [0.2, 0.85, 0.2, 0.5], [0.2, 0.5, 0.8, 0.5], [0.8, 0.5, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1]],
  T: [[0.5, 0, 0.5, 1], [0.1, 1, 0.9, 1]],
  U: [[0.15, 1, 0.15, 0.15], [0.15, 0.15, 0.85, 0.15], [0.85, 0.15, 0.85, 1]],
  V: [[0.1, 1, 0.5, 0], [0.5, 0, 0.9, 1]],
  W: [[0.05, 1, 0.3, 0], [0.3, 0, 0.5, 0.6], [0.5, 0.6, 0.7, 0], [0.7, 0, 0.95, 1]],
  X: [[0.15, 1, 0.85, 0], [0.85, 1, 0.15, 0]],
  Y: [[0.15, 1, 0.5, 0.5], [0.85, 1, 0.5, 0.5], [0.5, 0.5, 0.5, 0]],
  Z: [[0.15, 1, 0.85, 1], [0.85, 1, 0.15, 0], [0.15, 0, 0.85, 0]],
  "0": [[0.2, 0.1, 0.2, 0.9], [0.2, 0.9, 0.8, 0.9], [0.8, 0.9, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1], [0.25, 0.15, 0.75, 0.85]],
  "1": [[0.5, 0, 0.5, 1], [0.25, 0.75, 0.5, 1], [0.25, 0, 0.75, 0]],
  "2": [[0.2, 0.8, 0.8, 0.9], [0.8, 0.9, 0.8, 0.5], [0.8, 0.5, 0.2, 0], [0.2, 0, 0.85, 0]],
  "3": [[0.2, 0.9, 0.8, 0.9], [0.8, 0.9, 0.8, 0.1], [0.3, 0.5, 0.8, 0.5], [0.2, 0.1, 0.8, 0.1]],
  "4": [[0.7, 0, 0.7, 1], [0.7, 1, 0.15, 0.35], [0.15, 0.35, 0.9, 0.35]],
  "5": [[0.8, 1, 0.2, 1], [0.2, 1, 0.2, 0.55], [0.2, 0.55, 0.8, 0.55], [0.8, 0.55, 0.8, 0.1], [0.8, 0.1, 0.2, 0.1]],
  "6": [[0.75, 0.95, 0.2, 0.5], [0.2, 0.5, 0.2, 0.1], [0.2, 0.1, 0.8, 0.1], [0.8, 0.1, 0.8, 0.5], [0.8, 0.5, 0.2, 0.5]],
  "7": [[0.15, 1, 0.85, 1], [0.85, 1, 0.35, 0]],
  "8": [[0.2, 0.1, 0.2, 0.9], [0.8, 0.1, 0.8, 0.9], [0.2, 0.9, 0.8, 0.9], [0.2, 0.5, 0.8, 0.5], [0.2, 0.1, 0.8, 0.1]],
  "9": [[0.2, 0.9, 0.8, 0.9], [0.2, 0.9, 0.2, 0.5], [0.2, 0.5, 0.8, 0.5], [0.8, 0.9, 0.8, 0.1], [0.2, 0.1, 0.8, 0.1]],
  "-": [[0.2, 0.45, 0.8, 0.45]],
  ".": [[0.45, 0, 0.55, 0.12]],
  ":": [[0.45, 0.1, 0.55, 0.2], [0.45, 0.6, 0.55, 0.7]],
  "/": [[0.2, 0, 0.8, 1]],
  "$": [[0.5, 0, 0.5, 1], [0.8, 0.8, 0.2, 0.8], [0.2, 0.8, 0.2, 0.5], [0.2, 0.5, 0.8, 0.5], [0.8, 0.5, 0.8, 0.2], [0.8, 0.2, 0.2, 0.2]],
  "%": [[0.2, 0, 0.8, 1], [0.2, 0.8, 0.35, 0.95], [0.65, 0.05, 0.8, 0.2]],
};

interface GlyphTemplate {
  readonly char: string;
  readonly grid: Uint8Array; // 16 x 24
  readonly inkCount: number;
}

function buildGlyphTemplates(): readonly GlyphTemplate[] {
  const templates: GlyphTemplate[] = [];
  const W = 16;
  const H = 24;
  for (const [ch, strokes] of Object.entries(GLYPH_STROKES)) {
    const grid = new Uint8Array(W * H);
    for (const [x0, y0, x1, y1] of strokes) {
      const px0 = x0 * (W - 3) + 1.5;
      const py0 = (1 - y0) * (H - 3) + 1.5;
      const px1 = x1 * (W - 3) + 1.5;
      const py1 = (1 - y1) * (H - 3) + 1.5;
      const steps = Math.max(1, Math.ceil(Math.hypot(px1 - px0, py1 - py0) * 2));
      for (let s = 0; s <= steps; s++) {
        const cx = Math.round(px0 + ((px1 - px0) * s) / steps);
        const cy = Math.round(py0 + ((py1 - py0) * s) / steps);
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const gx = cx + dx;
            const gy = cy + dy;
            if (gx >= 0 && gx < W && gy >= 0 && gy < H) {
              grid[gy * W + gx] = 1;
            }
          }
        }
      }
    }
    let inkCount = 0;
    for (let i = 0; i < grid.length; i++) inkCount += grid[i]!;
    templates.push({ char: ch, grid, inkCount });
  }
  return templates;
}

const GLYPH_TEMPLATES = buildGlyphTemplates();

function matchGlyphBox(
  ink: Uint8Array,
  imgWidth: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  whitelist?: Set<string>,
  blacklist?: Set<string>
): { char: string; conf: number } {
  const boxW = Math.max(1, x1 - x0 + 1);
  const boxH = Math.max(1, y1 - y0 + 1);
  if (boxH <= 4 && boxW <= 4) {
    return { char: ".", conf: 88.5 };
  }
  if (boxH <= 3 && boxW >= 4) {
    return { char: "-", conf: 89.0 };
  }
  const W = 16;
  const H = 24;
  const sample = new Uint8Array(W * H);
  let sampleInk = 0;
  for (let ty = 0; ty < H; ty++) {
    const sy = y0 + Math.min(boxH - 1, Math.floor((ty * boxH) / H));
    for (let tx = 0; tx < W; tx++) {
      const sx = x0 + Math.min(boxW - 1, Math.floor((tx * boxW) / W));
      const val = ink[sy * imgWidth + sx]!;
      sample[ty * W + tx] = val;
      sampleInk += val;
    }
  }
  let bestChar = "I";
  let bestScore = -1;
  for (const tpl of GLYPH_TEMPLATES) {
    if (whitelist && !whitelist.has(tpl.char) && !whitelist.has(tpl.char.toLowerCase())) continue;
    if (blacklist && (blacklist.has(tpl.char) || blacklist.has(tpl.char.toLowerCase()))) continue;
    let intersection = 0;
    let union = 0;
    for (let i = 0; i < W * H; i++) {
      const a = sample[i]!;
      const b = tpl.grid[i]!;
      if (a && b) intersection++;
      if (a || b) union++;
    }
    const score = union > 0 ? intersection / union : 0;
    if (score > bestScore) {
      bestScore = score;
      bestChar = tpl.char;
    }
  }
  if (whitelist && !whitelist.has(bestChar) && whitelist.has(bestChar.toLowerCase())) {
    bestChar = bestChar.toLowerCase();
  }
  const conf = Math.min(99.2, Math.max(65.0, Math.round((55 + bestScore * 45) * 10) / 10));
  return { char: bestChar, conf };
}

export function recognizeBitmapOcr(
  bitmap: RgbaBitmap,
  options: {
    pageNumber?: number | undefined;
    dpi?: number | undefined;
    psm?: number | undefined;
    whitelist?: string | undefined;
    blacklist?: string | undefined;
  } = {}
): OcrPageResult {
  const { width, height, data } = bitmap;
  const pageNumber = options.pageNumber ?? 1;
  const dpi = options.dpi ?? 150;
  const whitelist = options.whitelist ? new Set(options.whitelist.split("")) : undefined;
  const blacklist = options.blacklist ? new Set(options.blacklist.split("")) : undefined;

  // Compute background luminance from border pixels and build binary ink mask
  const lum = new Uint8Array(width * height);
  let sumLum = 0;
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4]!;
    const g = data[i * 4 + 1]!;
    const b = data[i * 4 + 2]!;
    const l = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    lum[i] = l;
    sumLum += l;
  }
  const meanLum = width * height > 0 ? sumLum / (width * height) : 255;
  const darkBackground = meanLum < 128;
  const threshold = darkBackground ? Math.min(220, meanLum + 40) : Math.max(35, meanLum - 40);

  const ink = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i++) {
    ink[i] = darkBackground ? (lum[i]! > threshold ? 1 : 0) : (lum[i]! < threshold ? 1 : 0);
  }

  // Horizontal projection to find text lines
  const rowCounts = new Int32Array(height);
  for (let y = 0; y < height; y++) {
    let count = 0;
    const rowOffset = y * width;
    for (let x = 0; x < width; x++) {
      count += ink[rowOffset + x]!;
    }
    rowCounts[y] = count;
  }

  const lineSpans: Array<[number, number]> = [];
  let inLine = false;
  let lineStart = 0;
  for (let y = 0; y < height; y++) {
    if (rowCounts[y]! > 0 && !inLine) {
      inLine = true;
      lineStart = y;
    } else if (rowCounts[y]! === 0 && inLine) {
      if (y - lineStart >= 3) {
        lineSpans.push([lineStart, y - 1]);
      }
      inLine = false;
    }
  }
  if (inLine && height - lineStart >= 3) {
    lineSpans.push([lineStart, height - 1]);
  }

  const lines: OcrLineBox[] = [];
  for (const [ly0, ly1] of lineSpans) {
    // Vertical projection inside line band
    const colCounts = new Int32Array(width);
    for (let x = 0; x < width; x++) {
      let c = 0;
      for (let y = ly0; y <= ly1; y++) {
        c += ink[y * width + x]!;
      }
      colCounts[x] = c;
    }

    const charSpans: Array<[number, number]> = [];
    let inChar = false;
    let charStart = 0;
    for (let x = 0; x < width; x++) {
      if (colCounts[x]! > 0 && !inChar) {
        inChar = true;
        charStart = x;
      } else if (colCounts[x]! === 0 && inChar) {
        charSpans.push([charStart, x - 1]);
        inChar = false;
      }
    }
    if (inChar) {
      charSpans.push([charStart, width - 1]);
    }
    if (charSpans.length === 0) continue;

    // Estimate average character width / gap to group characters into words
    let totalCharW = 0;
    for (const [cx0, cx1] of charSpans) totalCharW += cx1 - cx0 + 1;
    const avgCharW = totalCharW / charSpans.length;
    const wordGapThreshold = Math.max(4, Math.round(avgCharW * 0.65));

    const wordCharGroups: Array<Array<[number, number]>> = [];
    let currentGroup: Array<[number, number]> = [charSpans[0]!];
    for (let i = 1; i < charSpans.length; i++) {
      const prev = charSpans[i - 1]!;
      const curr = charSpans[i]!;
      const gap = curr[0] - prev[1] - 1;
      if (gap >= wordGapThreshold) {
        wordCharGroups.push(currentGroup);
        currentGroup = [curr];
      } else {
        currentGroup.push(curr);
      }
    }
    wordCharGroups.push(currentGroup);

    const words: OcrWordBox[] = [];
    for (const group of wordCharGroups) {
      const chars: OcrCharBox[] = [];
      let wLeft = width;
      let wTop = height;
      let wRight = 0;
      let wBottom = 0;
      let confSum = 0;
      for (const [cx0, cx1] of group) {
        let cy0 = ly1;
        let cy1 = ly0;
        for (let y = ly0; y <= ly1; y++) {
          for (let x = cx0; x <= cx1; x++) {
            if (ink[y * width + x]) {
              if (y < cy0) cy0 = y;
              if (y > cy1) cy1 = y;
            }
          }
        }
        const matched = matchGlyphBox(ink, width, cx0, cy0, cx1, cy1, whitelist, blacklist);
        chars.push({
          char: matched.char,
          left: cx0,
          top: cy0,
          right: cx1,
          bottom: cy1,
          conf: matched.conf,
        });
        wLeft = Math.min(wLeft, cx0);
        wTop = Math.min(wTop, cy0);
        wRight = Math.max(wRight, cx1);
        wBottom = Math.max(wBottom, cy1);
        confSum += matched.conf;
      }
      const text = chars.map((c) => c.char).join("");
      if (!text) continue;
      words.push({
        text,
        left: wLeft,
        top: wTop,
        width: Math.max(1, wRight - wLeft + 1),
        height: Math.max(1, wBottom - wTop + 1),
        conf: Math.round((confSum / chars.length) * 10) / 10,
        chars,
      });
    }

    if (words.length > 0) {
      const lLeft = Math.min(...words.map((w) => w.left));
      const lTop = Math.min(...words.map((w) => w.top));
      const lRight = Math.max(...words.map((w) => w.left + w.width));
      const lBottom = Math.max(...words.map((w) => w.top + w.height));
      lines.push({
        left: lLeft,
        top: lTop,
        width: Math.max(1, lRight - lLeft),
        height: Math.max(1, lBottom - lTop),
        words,
      });
    }
  }

  const blocks: OcrBlockBox[] = [];
  if (lines.length > 0) {
    const bLeft = Math.min(...lines.map((l) => l.left));
    const bTop = Math.min(...lines.map((l) => l.top));
    const bRight = Math.max(...lines.map((l) => l.left + l.width));
    const bBottom = Math.max(...lines.map((l) => l.top + l.height));
    blocks.push({
      left: bLeft,
      top: bTop,
      width: Math.max(1, bRight - bLeft),
      height: Math.max(1, bBottom - bTop),
      paragraphs: [
        {
          left: bLeft,
          top: bTop,
          width: Math.max(1, bRight - bLeft),
          height: Math.max(1, bBottom - bTop),
          lines,
        },
      ],
    });
  }

  return {
    pageNumber,
    width,
    height,
    dpi,
    orientationDeg: 0,
    scriptName: "Latin",
    bitmap,
    blocks,
  };
}

function decodeNetpbm(bytes: Uint8Array): RgbaBitmap {
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0);
  let pos = 2;
  const nextToken = (): string => {
    while (pos < bytes.length) {
      const b = bytes[pos]!;
      if (b === 35) {
        while (pos < bytes.length && bytes[pos] !== 10) pos++;
      } else if (b <= 32) {
        pos++;
      } else {
        break;
      }
    }
    const start = pos;
    while (pos < bytes.length && bytes[pos]! > 32 && bytes[pos] !== 35) pos++;
    return decoder.decode(bytes.subarray(start, pos));
  };
  const width = Number.parseInt(nextToken(), 10);
  const height = Number.parseInt(nextToken(), 10);
  const maxVal = magic === "P1" || magic === "P4" ? 1 : Number.parseInt(nextToken(), 10);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Invalid Netpbm dimensions");
  }
  pos++; // single whitespace after header
  const data = new Uint8Array(width * height * 4);
  if (magic === "P6") {
    for (let i = 0; i < width * height; i++) {
      data[i * 4] = Math.round(((bytes[pos++] ?? 0) * 255) / maxVal);
      data[i * 4 + 1] = Math.round(((bytes[pos++] ?? 0) * 255) / maxVal);
      data[i * 4 + 2] = Math.round(((bytes[pos++] ?? 0) * 255) / maxVal);
      data[i * 4 + 3] = 255;
    }
  } else if (magic === "P5") {
    for (let i = 0; i < width * height; i++) {
      const g = Math.round(((bytes[pos++] ?? 0) * 255) / maxVal);
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = 255;
    }
  } else {
    for (let i = 0; i < width * height; i++) {
      const tok = Number.parseInt(nextToken() || "0", 10);
      const g = magic === "P1" ? (tok ? 0 : 255) : Math.round((tok * 255) / maxVal);
      data[i * 4] = g;
      data[i * 4 + 1] = g;
      data[i * 4 + 2] = g;
      data[i * 4 + 3] = 255;
    }
  }
  return { width, height, data };
}

function decodeBmp(bytes: Uint8Array): RgbaBitmap {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const pixelOffset = view.getUint32(10, true);
  const width = view.getInt32(18, true);
  const rawHeight = view.getInt32(22, true);
  const topDown = rawHeight < 0;
  const height = Math.abs(rawHeight);
  const bpp = view.getUint16(28, true);
  const data = new Uint8Array(width * height * 4);
  const rowStride = Math.floor((bpp * width + 31) / 32) * 4;
  for (let y = 0; y < height; y++) {
    const srcRow = topDown ? y : height - 1 - y;
    const rowStart = pixelOffset + srcRow * rowStride;
    for (let x = 0; x < width; x++) {
      const px = rowStart + x * (bpp >> 3);
      const b = bytes[px] ?? 255;
      const g = bytes[px + 1] ?? 255;
      const r = bytes[px + 2] ?? 255;
      const a = bpp === 32 ? (bytes[px + 3] ?? 255) : 255;
      const dst = (y * width + x) * 4;
      data[dst] = r;
      data[dst + 1] = g;
      data[dst + 2] = b;
      data[dst + 3] = a;
    }
  }
  return { width, height, data };
}

async function decodePagesFromInput(
  bytes: Uint8Array,
  options: { dpi: number; psm: number; whitelist?: string | undefined; blacklist?: string | undefined },
  limits: TesseractLimits
): Promise<OcrPageResult[]> {
  if (bytes.byteLength > limits.maxInputBytes) {
    throw new Error("Input exceeds maximum byte budget");
  }
  const isPdf =
    bytes.length >= 5 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46 &&
    bytes[4] === 0x2d;

  if (isPdf) {
    const doc = await PdfDocument.load(bytes);
    if (doc.pageCount > limits.maxPages) {
      throw new Error("PDF page count exceeds limit");
    }
    const pages: OcrPageResult[] = [];
    for (let i = 0; i < doc.pageCount; i++) {
      const page = doc.getPage(i);
      const extracted = doc.extractPage(i, "layout");
      const pngBytes = doc.renderPageToPng(i, { dpi: options.dpi });
      const bitmap = decodePng(pngBytes);
      const scale = options.dpi / 72;

      const pageLines = extracted.blocks.flatMap((b) => b.lines);
      if (pageLines.length > 0) {
        const ocrLines: OcrLineBox[] = [];
        for (const line of pageLines) {
          const words: OcrWordBox[] = [];
          for (const word of line.words) {
            let filtered = word.text;
            if (options.whitelist) {
              const wl = new Set(options.whitelist.split(""));
              filtered = filtered.split("").filter((c: string) => wl.has(c)).join("");
            }
            if (options.blacklist) {
              const bl = new Set(options.blacklist.split(""));
              filtered = filtered.split("").filter((c: string) => !bl.has(c)).join("");
            }
            if (!filtered) continue;
            const left = Math.max(0, Math.round(word.bbox[0] * scale));
            const top = Math.max(0, Math.round((page.height - word.bbox[3]) * scale));
            const right = Math.max(left + 1, Math.round(word.bbox[2] * scale));
            const bottom = Math.max(top + 1, Math.round((page.height - word.bbox[1]) * scale));
            const wWidth = Math.max(1, right - left);
            const wHeight = Math.max(1, bottom - top);
            const charW = wWidth / Math.max(1, filtered.length);
            const chars: OcrCharBox[] = filtered.split("").map((ch: string, idx: number) => ({
              char: ch,
              left: Math.round(left + idx * charW),
              top,
              right: Math.round(left + (idx + 1) * charW),
              bottom,
              conf: 98.4,
            }));
            words.push({
              text: filtered,
              left,
              top,
              width: wWidth,
              height: wHeight,
              conf: 98.4,
              chars,
            });
          }
          if (words.length > 0) {
            const lLeft = Math.min(...words.map((w) => w.left));
            const lTop = Math.min(...words.map((w) => w.top));
            const lRight = Math.max(...words.map((w) => w.left + w.width));
            const lBottom = Math.max(...words.map((w) => w.top + w.height));
            ocrLines.push({
              left: lLeft,
              top: lTop,
              width: Math.max(1, lRight - lLeft),
              height: Math.max(1, lBottom - lTop),
              words,
            });
          }
        }
        const bLeft = ocrLines.length ? Math.min(...ocrLines.map((l) => l.left)) : 0;
        const bTop = ocrLines.length ? Math.min(...ocrLines.map((l) => l.top)) : 0;
        const bRight = ocrLines.length ? Math.max(...ocrLines.map((l) => l.left + l.width)) : bitmap.width;
        const bBottom = ocrLines.length ? Math.max(...ocrLines.map((l) => l.top + l.height)) : bitmap.height;
        pages.push({
          pageNumber: i + 1,
          width: bitmap.width,
          height: bitmap.height,
          dpi: options.dpi,
          orientationDeg: extracted.rotation ?? 0,
          scriptName: "Latin",
          bitmap,
          blocks:
            ocrLines.length > 0
              ? [
                  {
                    left: bLeft,
                    top: bTop,
                    width: Math.max(1, bRight - bLeft),
                    height: Math.max(1, bBottom - bTop),
                    paragraphs: [
                      {
                        left: bLeft,
                        top: bTop,
                        width: Math.max(1, bRight - bLeft),
                        height: Math.max(1, bBottom - bTop),
                        lines: ocrLines,
                      },
                    ],
                  },
                ]
              : [],
        });
      } else {
        // Scanned / image-only PDF page: run bitmap OCR on the rendered page bitmap
        pages.push(
          recognizeBitmapOcr(bitmap, {
            pageNumber: i + 1,
            dpi: options.dpi,
            psm: options.psm,
            whitelist: options.whitelist,
            blacklist: options.blacklist,
          })
        );
      }
    }
    return pages;
  }

  let bitmap: RgbaBitmap;
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    bitmap = decodePng(bytes);
  } else if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1]! >= 0x31 && bytes[1]! <= 0x36) {
    bitmap = decodeNetpbm(bytes);
  } else if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    bitmap = decodeBmp(bytes);
  } else {
    throw new Error("Unsupported image format; expected PNG, PDF, Netpbm (PBM/PGM/PPM), or BMP");
  }

  if (bitmap.width * bitmap.height > limits.maxDecodedPixels) {
    throw new Error("Decoded image dimensions exceed pixel budget");
  }

  return [
    recognizeBitmapOcr(bitmap, {
      pageNumber: 1,
      dpi: options.dpi,
      psm: options.psm,
      whitelist: options.whitelist,
      blacklist: options.blacklist,
    }),
  ];
}

function formatTxt(pages: readonly OcrPageResult[], pageSeparator: string): string {
  const parts: string[] = [];
  for (const page of pages) {
    const lineStrings: string[] = [];
    for (const block of page.blocks) {
      for (const par of block.paragraphs) {
        for (const line of par.lines) {
          lineStrings.push(line.words.map((w) => w.text).join(" "));
        }
      }
    }
    parts.push(lineStrings.join("\n") + (lineStrings.length ? "\n" : ""));
  }
  return parts.join(pageSeparator);
}

function formatTsv(pages: readonly OcrPageResult[]): string {
  const rows: string[] = [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
  ];
  for (const page of pages) {
    rows.push(
      `1\t${page.pageNumber}\t0\t0\t0\t0\t0\t0\t${page.width}\t${page.height}\t-1\t`
    );
    let blockIdx = 0;
    for (const block of page.blocks) {
      blockIdx++;
      rows.push(
        `2\t${page.pageNumber}\t${blockIdx}\t0\t0\t0\t${block.left}\t${block.top}\t${block.width}\t${block.height}\t-1\t`
      );
      let parIdx = 0;
      for (const par of block.paragraphs) {
        parIdx++;
        rows.push(
          `3\t${page.pageNumber}\t${blockIdx}\t${parIdx}\t0\t0\t${par.left}\t${par.top}\t${par.width}\t${par.height}\t-1\t`
        );
        let lineIdx = 0;
        for (const line of par.lines) {
          lineIdx++;
          rows.push(
            `4\t${page.pageNumber}\t${blockIdx}\t${parIdx}\t${lineIdx}\t0\t${line.left}\t${line.top}\t${line.width}\t${line.height}\t-1\t`
          );
          let wordIdx = 0;
          for (const word of line.words) {
            wordIdx++;
            rows.push(
              `5\t${page.pageNumber}\t${blockIdx}\t${parIdx}\t${lineIdx}\t${wordIdx}\t${word.left}\t${word.top}\t${word.width}\t${word.height}\t${word.conf.toFixed(1)}\t${word.text}`
            );
          }
        }
      }
    }
  }
  return rows.join("\n") + "\n";
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatHocr(pages: readonly OcrPageResult[], inputName: string): string {
  const out: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">`,
    `<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="en" lang="en">`,
    `<head>`,
    `  <title></title>`,
    `  <meta http-equiv="Content-Type" content="text/html;charset=utf-8"/>`,
    `  <meta name="ocr-system" content="tesseract 5.4.1" />`,
    `  <meta name="ocr-capabilities" content="ocr_page ocr_carea ocr_par ocr_line ocrx_word"/>`,
    `</head>`,
    `<body>`,
  ];
  let blockId = 0;
  let parId = 0;
  let lineId = 0;
  let wordId = 0;
  for (const page of pages) {
    out.push(
      `  <div class='ocr_page' id='page_${page.pageNumber}' title='image "${escapeXml(inputName)}"; bbox 0 0 ${page.width} ${page.height}; ppageno ${page.pageNumber - 1}; scan_res ${page.dpi} ${page.dpi}'>`
    );
    for (const block of page.blocks) {
      blockId++;
      out.push(
        `    <div class='ocr_carea' id='block_${page.pageNumber}_${blockId}' title="bbox ${block.left} ${block.top} ${block.left + block.width} ${block.top + block.height}">`
      );
      for (const par of block.paragraphs) {
        parId++;
        out.push(
          `      <p class='ocr_par' id='par_${page.pageNumber}_${parId}' lang='eng' title="bbox ${par.left} ${par.top} ${par.left + par.width} ${par.top + par.height}">`
        );
        for (const line of par.lines) {
          lineId++;
          out.push(
            `        <span class='ocr_line' id='line_${page.pageNumber}_${lineId}' title="bbox ${line.left} ${line.top} ${line.left + line.width} ${line.top + line.height}; baseline 0 0">`
          );
          for (const word of line.words) {
            wordId++;
            out.push(
              `          <span class='ocrx_word' id='word_${page.pageNumber}_${wordId}' title='bbox ${word.left} ${word.top} ${word.left + word.width} ${word.top + word.height}; x_wconf ${Math.round(word.conf)}'>${escapeXml(word.text)}</span>`
            );
          }
          out.push(`        </span>`);
        }
        out.push(`      </p>`);
      }
      out.push(`    </div>`);
    }
    out.push(`  </div>`);
  }
  out.push(`</body>`, `</html>`, ``);
  return out.join("\n");
}

function formatBox(pages: readonly OcrPageResult[]): string {
  const lines: string[] = [];
  for (const page of pages) {
    const pageIdx = page.pageNumber - 1;
    for (const block of page.blocks) {
      for (const par of block.paragraphs) {
        for (const line of par.lines) {
          for (const word of line.words) {
            for (const ch of word.chars) {
              const bottomOriginY0 = Math.max(0, page.height - ch.bottom);
              const bottomOriginY1 = Math.max(bottomOriginY0 + 1, page.height - ch.top);
              lines.push(`${ch.char} ${ch.left} ${bottomOriginY0} ${ch.right} ${bottomOriginY1} ${pageIdx}`);
            }
          }
        }
      }
    }
  }
  return lines.join("\n") + (lines.length ? "\n" : "");
}

function formatOsd(pages: readonly OcrPageResult[]): string {
  const first = pages[0];
  return [
    `Page number: 0`,
    `Orientation in degrees: ${first?.orientationDeg ?? 0}`,
    `Rotate: ${first?.orientationDeg ?? 0}`,
    `Orientation confidence: 15.00`,
    `Script: ${first?.scriptName ?? "Latin"}`,
    `Script confidence: 12.50`,
    ``,
  ].join("\n");
}

function buildSearchablePdf(pages: readonly OcrPageResult[], title: string): Uint8Array {
  const doc = PdfDocument.create();
  doc.setMetadata({
    title,
    creator: "Tesseract OCR 5.4.1",
    producer: "@poe-code/pdf-ast",
  });
  for (const pageResult of pages) {
    const scale = 72 / pageResult.dpi;
    const widthPt = Math.max(72, Math.round(pageResult.width * scale * 100) / 100);
    const heightPt = Math.max(72, Math.round(pageResult.height * scale * 100) / 100);
    const pdfPage = doc.addPage({ width: widthPt, height: heightPt });
    const pngBytes = encodePng(pageResult.bitmap);
    const imgRef = doc.embedPng(pngBytes);
    pdfPage.drawImage(imgRef, { x: 0, y: 0, width: widthPt, height: heightPt });

    for (const block of pageResult.blocks) {
      for (const par of block.paragraphs) {
        for (const line of par.lines) {
          for (const word of line.words) {
            const xPt = word.left * scale;
            const yPt = Math.max(2, heightPt - (word.top + word.height) * scale);
            const fontSizePt = Math.max(6, Math.min(48, word.height * scale * 0.9));
            pdfPage.drawText(word.text, {
              x: xPt,
              y: yPt,
              size: fontSizePt,
              font: "Helvetica",
            });
          }
        }
      }
    }
  }
  return doc.save();
}

function resolveVfsPath(cwd: string, p: string): string {
  if (p.startsWith("/")) return p;
  return (cwd.endsWith("/") ? cwd : cwd + "/") + p;
}

export async function runTesseract(
  context: CommandContext,
  options: TesseractCommandOptions = {}
): Promise<CommandExecutionResult> {
  context.signal.throwIfAborted();
  const limits: TesseractLimits = { ...tesseractLimits, ...options.limits };
  const stdout = createOutputOperation(context, context.stdout);
  const stderr = createOutputOperation(context, context.stderr);
  const writeOut = async (bytes: Uint8Array) => {
    if (bytes.byteLength > limits.maxOutputBytes) {
      throw new Error("Output exceeds maximum byte limit");
    }
    await writeBytes(stdout.output, bytes, context.signal);
  };
  const writeErr = async (text: string) => {
    await writeBytes(stderr.output, encoder.encode(text), context.signal);
  };

  try {
    const args = [...getCommandArguments(context).args];
    if (args.includes("--version") || args.includes("-v")) {
      await writeOut(
        encoder.encode(
          "tesseract 5.4.1\n leptonica-1.84.1\n  libpng 1.6.43 : zlib 1.3.1\n"
        )
      );
      return { exitCode: 0 };
    }
    if (
      args.includes("--help") ||
      args.includes("-h") ||
      args.includes("--help-extra")
    ) {
      await writeOut(
        encoder.encode(
          "Usage:\n  tesseract --help | --help-extra | --version\n  tesseract --list-langs [--tessdata-dir PATH]\n  tesseract imagename|pdf|stdin outputbase|stdout [options...] [configfile...]\n"
        )
      );
      return { exitCode: 0 };
    }
    if (args.includes("--help-psm")) {
      await writeOut(
        encoder.encode(
          "Page segmentation modes:\n  0    Orientation and script detection (OSD) only.\n  1    Automatic page segmentation with OSD.\n  3    Fully automatic page segmentation, but no OSD. (Default)\n  6    Assume a single uniform block of text.\n  7    Treat the image as a single text line.\n  8    Treat the image as a single word.\n 11    Sparse text.\n 13    Raw line.\n"
        )
      );
      return { exitCode: 0 };
    }
    if (args.includes("--help-oem")) {
      await writeOut(
        encoder.encode(
          "OCR Engine modes:\n  0    Legacy engine only.\n  1    Neural nets LSTM engine only.\n  2    Legacy + LSTM engines.\n  3    Default, based on what is available.\n"
        )
      );
      return { exitCode: 0 };
    }
    if (args.includes("--print-parameters")) {
      await writeOut(
        encoder.encode(
          "tessedit_create_txt\t1\tWrite .txt output file\ntessedit_create_tsv\t0\tWrite .tsv output file\ntessedit_create_hocr\t0\tWrite .hocr output file\ntessedit_create_pdf\t0\tWrite .pdf output file\ntessedit_create_boxfile\t0\tWrite .box output file\npage_separator\t\\f\tPage separator string\nuser_defined_dpi\t0\tSpecify custom DPI\ntessedit_char_whitelist\t\tWhitelist of characters\ntessedit_char_blacklist\t\tBlacklist of characters\n"
        )
      );
      return { exitCode: 0 };
    }

    let tessdataDir = "/tessdata";
    let lang = "eng";
    let psm = 3;
    let oem = 3;
    let dpi = 150;
    const configVars = new Map<string, string>();
    const positional: string[] = [];

    for (let i = 0; i < args.length; i++) {
      const arg = args[i]!;
      if (arg === "--tessdata-dir") {
        const val = args[++i];
        if (!val) {
          await writeErr("Error: Missing argument for --tessdata-dir\n");
          return { exitCode: 1 };
        }
        tessdataDir = val;
      } else if (arg === "-l") {
        const val = args[++i];
        if (!val) {
          await writeErr("Error: Missing argument for -l\n");
          return { exitCode: 1 };
        }
        lang = val;
      } else if (arg === "--psm") {
        const val = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isInteger(val) || val < 0 || val > 13) {
          await writeErr("Error: Invalid --psm value (expected 0..13)\n");
          return { exitCode: 1 };
        }
        psm = val;
      } else if (arg === "--oem") {
        const val = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isInteger(val) || val < 0 || val > 3) {
          await writeErr("Error: Invalid --oem value (expected 0..3)\n");
          return { exitCode: 1 };
        }
        oem = val;
      } else if (arg === "--dpi") {
        const val = Number.parseInt(args[++i] ?? "", 10);
        if (!Number.isInteger(val) || val < 70 || val > 2400) {
          await writeErr("Error: Invalid --dpi value (expected 70..2400)\n");
          return { exitCode: 1 };
        }
        dpi = val;
      } else if (arg === "-c") {
        const pair = args[++i];
        if (!pair || !pair.includes("=")) {
          await writeErr("Error: -c expects key=value\n");
          return { exitCode: 1 };
        }
        const eq = pair.indexOf("=");
        configVars.set(pair.slice(0, eq), pair.slice(eq + 1));
      } else if (arg === "--list-langs") {
        // Handled right after loop
        positional.push(arg);
      } else if (arg.startsWith("-")) {
        if (arg === "-") {
          positional.push(arg);
        } else {
          await writeErr(`Error: Unknown option ${arg}\n`);
          return { exitCode: 1 };
        }
      } else {
        positional.push(arg);
      }
    }

    const availableLangs = new Set<string>(options.languages ?? ["eng", "osd", "lat"]);
    try {
      const resolvedDir = resolveVfsPath(context.cwd, tessdataDir);
      const entries = await context.fs.readdir(resolvedDir);
      for (const entry of entries) {
        const name = typeof entry === "string" ? entry : entry.name;
        if (name.endsWith(".traineddata")) {
          availableLangs.add(name.slice(0, -".traineddata".length));
        }
      }
    } catch {
      // Optional VFS tessdata directory
    }

    if (positional.includes("--list-langs")) {
      const sorted = [...availableLangs].sort();
      await writeOut(
        encoder.encode(
          `List of available languages in "${tessdataDir}" (${sorted.length}):\n${sorted.join("\n")}\n`
        )
      );
      return { exitCode: 0 };
    }

    for (const subLang of lang.split("+")) {
      if (!availableLangs.has(subLang)) {
        await writeErr(
          `Error opening data file ${tessdataDir}/${subLang}.traineddata\nFailed loading language '${subLang}'\n`
        );
        return { exitCode: 1 };
      }
    }

    if (positional.length < 2) {
      await writeErr(
        "Usage: tesseract imagename outputbase [options...] [configfile...]\n"
      );
      return { exitCode: 1 };
    }

    const inputSpec = positional[0]!;
    const outputBase = positional[1]!;
    const configFiles = positional.slice(2);

    if (configVars.has("user_defined_dpi")) {
      const customDpi = Number.parseInt(configVars.get("user_defined_dpi")!, 10);
      if (Number.isInteger(customDpi) && customDpi >= 70 && customDpi <= 2400) {
        dpi = customDpi;
      }
    }

    // Acquire input bytes from stdin or VFS
    let inputBytes: Uint8Array;
    if (inputSpec === "stdin" || inputSpec === "-") {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, context.signal)) {
        total += chunk.byteLength;
        if (total > limits.maxInputBytes) {
          throw new Error("Stdin exceeds maximum input budget");
        }
        chunks.push(new Uint8Array(chunk));
      }
      inputBytes = new Uint8Array(total);
      let offset = 0;
      for (const c of chunks) {
        inputBytes.set(c, offset);
        offset += c.byteLength;
      }
    } else {
      const inputPath = resolveVfsPath(context.cwd, inputSpec);
      inputBytes = await context.fs.readFile(inputPath);
    }

    const pages = await decodePagesFromInput(
      inputBytes,
      {
        dpi,
        psm,
        whitelist: configVars.get("tessedit_char_whitelist"),
        blacklist: configVars.get("tessedit_char_blacklist"),
      },
      limits
    );

    const formats = new Set<string>();
    for (const cfg of configFiles) {
      const lower = cfg.toLowerCase();
      if (["txt", "tsv", "hocr", "pdf", "box", "makebox", "osd"].includes(lower)) {
        formats.add(lower === "makebox" ? "box" : lower);
      }
    }
    if (configVars.get("tessedit_create_txt") === "1") formats.add("txt");
    if (configVars.get("tessedit_create_tsv") === "1") formats.add("tsv");
    if (configVars.get("tessedit_create_hocr") === "1") formats.add("hocr");
    if (configVars.get("tessedit_create_pdf") === "1") formats.add("pdf");
    if (configVars.get("tessedit_create_boxfile") === "1") formats.add("box");
    if (psm === 0) formats.add("osd");
    if (formats.size === 0) formats.add("txt");

    const pageSeparator =
      configVars.get("page_separator")?.replace(/\\f/g, "\f").replace(/\\n/g, "\n") ?? "\f";
    const toStdout = outputBase === "stdout" || outputBase === "-";

    for (const fmt of formats) {
      let payload: Uint8Array;
      let ext = fmt;
      if (fmt === "txt") {
        payload = encoder.encode(formatTxt(pages, pageSeparator));
      } else if (fmt === "tsv") {
        payload = encoder.encode(formatTsv(pages));
      } else if (fmt === "hocr") {
        payload = encoder.encode(formatHocr(pages, inputSpec));
      } else if (fmt === "box") {
        payload = encoder.encode(formatBox(pages));
      } else if (fmt === "osd") {
        payload = encoder.encode(formatOsd(pages));
      } else if (fmt === "pdf") {
        payload = buildSearchablePdf(pages, inputSpec);
      } else {
        continue;
      }

      if (toStdout) {
        await writeOut(payload);
      } else {
        const outPath = resolveVfsPath(context.cwd, `${outputBase}.${ext}`);
        await context.fs.writeFile(outPath, payload);
      }
    }

    return { exitCode: 0 };
  } catch (error) {
    context.signal.throwIfAborted();
    const msg = error instanceof Error ? error.message : String(error);
    await writeErr(`Tesseract Error: ${msg}\n`);
    return { exitCode: 1 };
  } finally {
    await Promise.allSettled([stdout.close(), stderr.close()]);
  }
}

export function createTesseractCommand(
  options: TesseractCommandOptions = {}
): CommandDefinition {
  return Object.freeze({
    name: "tesseract",
    runtimeIdentity: commandRuntimeIdentity,
    description: "First-party OCR and searchable PDF generator powered by @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return runTesseract(context, options);
    },
  });
}

export const tesseractCommand = createTesseractCommand();

export function tesseractCommands(
  options: TesseractCommandOptions = {}
): VirtualShellPlugin {
  const command = createTesseractCommand(options);
  return {
    name: "tesseract",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
