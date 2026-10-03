import { PdfDocument, renderPdfPageToPng } from "@poe-code/pdf-ast";
import { parseColor, type ImageMetadata, type RgbaImage } from "../ast.js";
import { decodePngImage, encodePngImage } from "./png.js";


export const FONT_5X7 = new Uint8Array([
  0x00,0x00,0x00,0x00,0x00, 0x00,0x00,0x5f,0x00,0x00, 0x00,0x07,0x00,0x07,0x00, 0x14,0x7f,0x14,0x7f,0x14,
  0x24,0x2a,0x7f,0x2a,0x12, 0x23,0x13,0x08,0x64,0x62, 0x36,0x49,0x55,0x22,0x50, 0x00,0x05,0x03,0x00,0x00,
  0x00,0x1c,0x22,0x41,0x00, 0x00,0x41,0x22,0x1c,0x00, 0x14,0x08,0x3e,0x08,0x14, 0x08,0x08,0x3e,0x08,0x08,
  0x00,0x50,0x30,0x00,0x00, 0x08,0x08,0x08,0x08,0x08, 0x00,0x60,0x60,0x00,0x00, 0x20,0x10,0x08,0x04,0x02,
  0x3e,0x51,0x49,0x45,0x3e, 0x00,0x42,0x7f,0x40,0x00, 0x42,0x61,0x51,0x49,0x46, 0x21,0x41,0x45,0x4b,0x31,
  0x18,0x14,0x12,0x7f,0x10, 0x27,0x45,0x45,0x45,0x39, 0x3c,0x4a,0x49,0x49,0x30, 0x01,0x71,0x09,0x05,0x03,
  0x36,0x49,0x49,0x49,0x36, 0x06,0x49,0x49,0x29,0x1e, 0x00,0x36,0x36,0x00,0x00, 0x00,0x56,0x36,0x00,0x00,
  0x08,0x14,0x22,0x41,0x00, 0x14,0x14,0x14,0x14,0x14, 0x00,0x41,0x22,0x14,0x08, 0x02,0x01,0x51,0x09,0x06,
  0x32,0x49,0x79,0x41,0x3e, 0x7e,0x11,0x11,0x11,0x7e, 0x7f,0x49,0x49,0x49,0x36, 0x3e,0x41,0x41,0x41,0x22,
  0x7f,0x41,0x41,0x22,0x1c, 0x7f,0x49,0x49,0x49,0x41, 0x7f,0x09,0x09,0x09,0x01, 0x3e,0x41,0x49,0x49,0x7a,
  0x7f,0x08,0x08,0x08,0x7f, 0x00,0x41,0x7f,0x41,0x00, 0x20,0x40,0x41,0x3f,0x01, 0x7f,0x08,0x14,0x22,0x41,
  0x7f,0x40,0x40,0x40,0x40, 0x7f,0x02,0x0c,0x02,0x7f, 0x7f,0x04,0x08,0x10,0x7f, 0x3e,0x41,0x41,0x41,0x3e,
  0x7f,0x09,0x09,0x09,0x06, 0x3e,0x41,0x51,0x21,0x5e, 0x7f,0x09,0x19,0x29,0x46, 0x46,0x49,0x49,0x49,0x31,
  0x01,0x01,0x7f,0x01,0x01, 0x3f,0x40,0x40,0x40,0x3f, 0x1f,0x20,0x40,0x20,0x1f, 0x3f,0x40,0x38,0x40,0x3f,
  0x63,0x14,0x08,0x14,0x63, 0x07,0x08,0x70,0x08,0x07, 0x61,0x51,0x49,0x45,0x43, 0x00,0x7f,0x41,0x41,0x00,
  0x02,0x04,0x08,0x10,0x20, 0x00,0x41,0x41,0x7f,0x00, 0x04,0x02,0x01,0x02,0x04, 0x40,0x40,0x40,0x40,0x40,
  0x00,0x01,0x02,0x04,0x00, 0x20,0x54,0x54,0x54,0x78, 0x7f,0x48,0x44,0x44,0x38, 0x38,0x44,0x44,0x44,0x20,
  0x38,0x44,0x44,0x48,0x7f, 0x38,0x54,0x54,0x54,0x18, 0x08,0x7e,0x09,0x01,0x02, 0x0c,0x52,0x52,0x52,0x3e,
  0x7f,0x08,0x04,0x04,0x78, 0x00,0x44,0x7d,0x40,0x00, 0x20,0x40,0x44,0x3d,0x00, 0x7f,0x10,0x28,0x44,0x00,
  0x00,0x41,0x7f,0x40,0x00, 0x7c,0x04,0x18,0x04,0x78, 0x7c,0x08,0x04,0x04,0x78, 0x38,0x44,0x44,0x44,0x38,
  0x7c,0x14,0x14,0x14,0x08, 0x08,0x14,0x14,0x18,0x7c, 0x7c,0x08,0x04,0x04,0x08, 0x48,0x54,0x54,0x54,0x20,
  0x04,0x3f,0x44,0x40,0x20, 0x3c,0x40,0x40,0x20,0x7c, 0x1c,0x20,0x40,0x20,0x1c, 0x3c,0x40,0x30,0x40,0x3c,
  0x44,0x28,0x10,0x28,0x44, 0x0c,0x50,0x50,0x50,0x3c, 0x44,0x64,0x54,0x4c,0x44, 0x00,0x08,0x36,0x41,0x00,
  0x00,0x00,0x7f,0x00,0x00, 0x00,0x41,0x36,0x08,0x00, 0x10,0x08,0x08,0x10,0x08
]);

function unescapeSvgText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, String.fromCharCode(34))
    .replace(/&apos;|&#39;/g, String.fromCharCode(39))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

export function isPdfBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const limit = Math.min(bytes.length - 5, 1024);
  for (let i = 0; i <= limit; i++) {
    if (
      bytes[i] === 0x25 && // %
      bytes[i + 1] === 0x50 && // P
      bytes[i + 2] === 0x44 && // D
      bytes[i + 3] === 0x46 && // F
      bytes[i + 4] === 0x2d // -
    ) {
      return true;
    }
  }
  return false;
}

export function isSvgBytes(bytes: Uint8Array): boolean {
  if (bytes.length < 5) return false;
  const head = new TextDecoder("utf-8", { fatal: false })
    .decode(bytes.subarray(0, Math.min(bytes.length, 512)))
    .trimStart();
  return head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"));
}

export function readPdfMetadata(
  bytes: Uint8Array,
  options?: { readonly page?: number; readonly density?: number }
): ImageMetadata {
  const doc = PdfDocument.load(bytes);
  const pageIdx = Math.max(0, Math.min(doc.pageCount - 1, options?.page ?? 0));
  const page = doc.getPage(pageIdx);
  const density = options?.density ?? 72;
  const scale = density / 72;
  const width = Math.max(1, Math.round(page.width * scale));
  const height = Math.max(1, Math.round(page.height * scale));

  return {
    format: "pdf",
    width,
    height,
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density,
    hasAlpha: true,
    pages: doc.pageCount,
    pagePrimary: pageIdx,
    size: bytes.byteLength
  };
}

export function decodePdfImage(
  bytes: Uint8Array,
  options?: { readonly page?: number; readonly density?: number }
): RgbaImage {
  const doc = PdfDocument.load(bytes);
  const pageIdx = Math.max(0, Math.min(doc.pageCount - 1, options?.page ?? 0));
  const density = options?.density ?? 72;
  const scale = density / 72;
  const pngBytes = renderPdfPageToPng(bytes, pageIdx, { scale });
  const decoded = decodePngImage(pngBytes);
  return {
    ...decoded,
    format: "pdf",
    density,
    pages: doc.pageCount
  };
}

export function encodePdfImage(img: RgbaImage): Uint8Array {
  const doc = PdfDocument.create();
  const pngBytes = encodePngImage(img);
  const embedded = doc.embedPng(pngBytes);
  const page = doc.addPage([img.width, img.height]);
  page.drawImage(embedded, {
    x: 0,
    y: 0,
    width: img.width,
    height: img.height
  });
  return doc.save();
}

function parseSvgNumber(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const trimmed = val.trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|mm|cm|in|%)?$/i.exec(trimmed);
  if (!match) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) && num > 0 ? num : fallback;
  }
  const num = parseFloat(match[1]!);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "in":
      return num * 72;
    case "cm":
      return (num * 72) / 2.54;
    case "mm":
      return (num * 72) / 25.4;
    case "pc":
      return num * 12;
    case "%":
      return (num / 100) * fallback;
    case "pt":
    case "px":
    default:
      return num;
  }
}

function parseSvgCoord(val: string | undefined, fallback: number, refSize = 0): number {
  if (!val) return fallback;
  const trimmed = val.trim();
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+))(px|pt|pc|mm|cm|in|%)?$/i.exec(trimmed);
  if (!match) {
    const num = parseFloat(trimmed);
    return Number.isFinite(num) ? num : fallback;
  }
  const num = parseFloat(match[1]!);
  if (!Number.isFinite(num)) return fallback;
  const unit = (match[2] ?? "px").toLowerCase();
  switch (unit) {
    case "in":
      return num * 72;
    case "cm":
      return (num * 72) / 2.54;
    case "mm":
      return (num * 72) / 25.4;
    case "pc":
      return num * 12;
    case "%":
      return (num / 100) * refSize;
    case "pt":
    case "px":
    default:
      return num;
  }
}

function getAttr(tagText: string, attrName: string): string | undefined {
  const regex = new RegExp(`(?:^|[\\s"'])${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = regex.exec(tagText);
  return match?.[1];
}

export function readSvgMetadata(
  bytes: Uint8Array,
  options?: { readonly density?: number }
): ImageMetadata {
  const text = new TextDecoder().decode(bytes);
  const svgTagMatch = /<svg\b[^>]*>/i.exec(text);
  const svgTag = svgTagMatch?.[0] ?? "";
  const viewBoxRaw = getAttr(svgTag, "viewBox");
  let baseW = 300;
  let baseH = 150;
  if (viewBoxRaw) {
    const parts = viewBoxRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      baseW = parts[2]!;
      baseH = parts[3]!;
    }
  }
  baseW = parseSvgNumber(getAttr(svgTag, "width"), baseW);
  baseH = parseSvgNumber(getAttr(svgTag, "height"), baseH);

  const density = options?.density ?? 72;
  const scale = density / 72;
  const width = Math.max(1, Math.round(baseW * scale));
  const height = Math.max(1, Math.round(baseH * scale));

  return {
    format: "svg",
    width,
    height,
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density,
    hasAlpha: true,
    size: bytes.byteLength
  };
}

export function decodeSvgImage(
  bytes: Uint8Array,
  options?: { readonly density?: number }
): RgbaImage {
  const meta = readSvgMetadata(bytes, options);
  const { width, height, density } = meta;
  const data = new Uint8Array(new ArrayBuffer(width * height * 4 + height), 0, width * height * 4);
  const text = new TextDecoder().decode(bytes);
  const svgTagMatch = /<svg\b[^>]*>/i.exec(text);
  const svgTag = svgTagMatch?.[0] ?? "";
  const viewBoxRaw = getAttr(svgTag, "viewBox");
  let vbMinX = 0;
  let vbMinY = 0;
  let vbW = width / (density / 72);
  let vbH = height / (density / 72);
  if (viewBoxRaw) {
    const parts = viewBoxRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (parts.length === 4 && parts[2]! > 0 && parts[3]! > 0) {
      vbMinX = parts[0]!;
      vbMinY = parts[1]!;
      vbW = parts[2]!;
      vbH = parts[3]!;
    }
  }
  const scaleX = width / Math.max(1e-6, vbW);
  const scaleY = height / Math.max(1e-6, vbH);
  type Mat2D = [number, number, number, number, number, number];
  const mulMat = (m1: Mat2D, m2: Mat2D): Mat2D => [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5]
  ];
  const parseTransformAttr = (raw: string | undefined): Mat2D => {
    let cur: Mat2D = [1, 0, 0, 1, 0, 0];
    if (!raw) return cur;
    const fnRe = /(matrix|translate|scale|rotate)\s*\(([^)]*)\)/gi;
    let m: RegExpExecArray | null;
    while ((m = fnRe.exec(raw)) !== null) {
      const kind = m[1]!.toLowerCase();
      const args = m[2]!
        .trim()
        .split(/[\s,]+/)
        .map(Number)
        .filter(Number.isFinite);
      if (kind === "translate") {
        const tx = args[0] ?? 0;
        const ty = args[1] ?? 0;
        cur = mulMat(cur, [1, 0, 0, 1, tx, ty]);
      } else if (kind === "scale") {
        const sx = args[0] ?? 1;
        const sy = args[1] ?? sx;
        cur = mulMat(cur, [sx, 0, 0, sy, 0, 0]);
      } else if (kind === "rotate") {
        const rad = ((args[0] ?? 0) * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const cx = args[1] ?? 0;
        const cy = args[2] ?? 0;
        if (cx !== 0 || cy !== 0) {
          cur = mulMat(cur, [1, 0, 0, 1, cx, cy]);
          cur = mulMat(cur, [cos, sin, -sin, cos, 0, 0]);
          cur = mulMat(cur, [1, 0, 0, 1, -cx, -cy]);
        } else {
          cur = mulMat(cur, [cos, sin, -sin, cos, 0, 0]);
        }
      } else if (kind === "matrix" && args.length >= 6) {
        cur = mulMat(cur, [args[0]!, args[1]!, args[2]!, args[3]!, args[4]!, args[5]!]);
      }
    }
    return cur;
  };
  const rootCtm: Mat2D = [scaleX, 0, 0, scaleY, -vbMinX * scaleX, -vbMinY * scaleY];
  let activeCtm: Mat2D = rootCtm;
  const mapPt = (ux: number, uy: number): [number, number] => [
    activeCtm[0] * ux + activeCtm[2] * uy + activeCtm[4],
    activeCtm[1] * ux + activeCtm[3] * uy + activeCtm[5]
  ];
  const mapX = (ux: number) => activeCtm[0] * ux + activeCtm[4];
  const mapY = (uy: number) => activeCtm[3] * uy + activeCtm[5];

  const blendPixel = (px: number, py: number, r: number, g: number, b: number, a: number) => {
    if (px < 0 || py < 0 || px >= width || py >= height || a <= 0) return;
    const idx = (py * width + px) * 4;
    const srcA = a / 255;
    const dstA = data[idx + 3]! / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;
    data[idx] = Math.round((r * srcA + data[idx]! * dstA * (1 - srcA)) / outA);
    data[idx + 1] = Math.round((g * srcA + data[idx + 1]! * dstA * (1 - srcA)) / outA);
    data[idx + 2] = Math.round((b * srcA + data[idx + 2]! * dstA * (1 - srcA)) / outA);
    data[idx + 3] = Math.round(outA * 255);
  };

  const drawSegment = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeWidth: number,
    r: number,
    g: number,
    b: number,
    a: number
  ) => {
    if (a <= 0) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
    const half = Math.max(0, (strokeWidth - 1) / 2);
    const rad = Math.ceil(half);
    for (let s = 0; s <= steps; s++) {
      const px = x1 + ((x2 - x1) * s) / steps;
      const py = y1 + ((y2 - y1) * s) / steps;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          if (dx * dx + dy * dy <= (half + 0.5) * (half + 0.5)) {
            blendPixel(Math.round(px + dx), Math.round(py + dy), r, g, b, a);
          }
        }
      }
    }
  };

  const parsePointsList = (ptsRaw: string | undefined): Array<[number, number]> => {
    if (!ptsRaw) return [];
    const nums = ptsRaw
      .trim()
      .split(/[\s,]+/)
      .map(Number)
      .filter(Number.isFinite);
    const pts: Array<[number, number]> = [];
    for (let i = 0; i + 1 < nums.length; i += 2) {
      pts.push(mapPt(nums[i]!, nums[i + 1]!));
    }
    return pts;
  };

  const parsePathPoints = (dRaw: string | undefined): { readonly pts: Array<[number, number]>; readonly closed: boolean } => {
    if (!dRaw) return { pts: [], closed: false };
    const tokens = dRaw.match(/[a-zA-Z]|[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/g) ?? [];
    const pts: Array<[number, number]> = [];
    let curX = 0;
    let curY = 0;
    let startX = 0;
    let startY = 0;
    let closed = false;
    let i = 0;
    let cmd = "M";
    while (i < tokens.length) {
      const tok = tokens[i]!;
      if (/^[a-zA-Z]$/.test(tok)) {
        cmd = tok;
        i++;
        if (cmd === "Z" || cmd === "z") {
          closed = true;
          curX = startX;
          curY = startY;
          continue;
        }
      }
      const readNum = () => (i < tokens.length ? parseFloat(tokens[i++]!) : 0);
      if (cmd === "M" || cmd === "m") {
        const nx = readNum();
        const ny = readNum();
        curX = cmd === "m" ? curX + nx : nx;
        curY = cmd === "m" ? curY + ny : ny;
        startX = curX;
        startY = curY;
        pts.push(mapPt(curX, curY));
        cmd = cmd === "m" ? "l" : "L";
      } else if (cmd === "L" || cmd === "l") {
        const nx = readNum();
        const ny = readNum();
        curX = cmd === "l" ? curX + nx : nx;
        curY = cmd === "l" ? curY + ny : ny;
        pts.push(mapPt(curX, curY));
      } else if (cmd === "H" || cmd === "h") {
        const nx = readNum();
        curX = cmd === "h" ? curX + nx : nx;
        pts.push(mapPt(curX, curY));
      } else if (cmd === "V" || cmd === "v") {
        const ny = readNum();
        curY = cmd === "v" ? curY + ny : ny;
        pts.push(mapPt(curX, curY));
      } else if (cmd === "C" || cmd === "c") {
        const x1 = cmd === "c" ? curX + readNum() : readNum();
        const y1 = cmd === "c" ? curY + readNum() : readNum();
        const x2 = cmd === "c" ? curX + readNum() : readNum();
        const y2 = cmd === "c" ? curY + readNum() : readNum();
        const x3 = cmd === "c" ? curX + readNum() : readNum();
        const y3 = cmd === "c" ? curY + readNum() : readNum();
        for (let s = 1; s <= 12; s++) {
          const t = s / 12;
          const mt = 1 - t;
          const bx = mt * mt * mt * curX + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x3;
          const by = mt * mt * mt * curY + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y3;
          pts.push(mapPt(bx, by));
        }
        curX = x3;
        curY = y3;
      } else if (cmd === "Q" || cmd === "q") {
        const x1 = cmd === "q" ? curX + readNum() : readNum();
        const y1 = cmd === "q" ? curY + readNum() : readNum();
        const x2 = cmd === "q" ? curX + readNum() : readNum();
        const y2 = cmd === "q" ? curY + readNum() : readNum();
        for (let s = 1; s <= 10; s++) {
          const t = s / 10;
          const mt = 1 - t;
          const bx = mt * mt * curX + 2 * mt * t * x1 + t * t * x2;
          const by = mt * mt * curY + 2 * mt * t * y1 + t * t * y2;
          pts.push(mapPt(bx, by));
        }
        curX = x2;
        curY = y2;
      } else {
        i++;
      }
    }
    return { pts, closed };
  };

  const ctmStack: Mat2D[] = [rootCtm];
  // Rasterize <rect>, <circle>, <ellipse>, <line>, <polygon>, and <polyline> elements in document order
  const elemRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>|<(\/?)(g|rect|circle|ellipse|line|polygon|polyline|path)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = elemRegex.exec(text)) !== null) {
    const isTextTag = match[1] !== undefined && match[3] === undefined && match[4] === undefined;
    const isClose = !isTextTag && match[3] === "/";
    const tag = isTextTag ? "text" : match[4]!.toLowerCase();
    const attrs = isTextTag ? match[1]! : match[5]!;
    const textContent = isTextTag ? unescapeSvgText(match[2] ?? "") : "";
    const isSelfClose = !isTextTag && match[0]!.endsWith("/>");
    if (tag === "g") {
      if (isClose) {
        if (ctmStack.length > 1) ctmStack.pop();
        activeCtm = ctmStack[ctmStack.length - 1]!;
      } else if (!isSelfClose) {
        const nextCtm = mulMat(ctmStack[ctmStack.length - 1]!, parseTransformAttr(getAttr(attrs, "transform")));
        ctmStack.push(nextCtm);
        activeCtm = nextCtm;
      }
      continue;
    }
    if (isClose) continue;
    const elemTransform = getAttr(attrs, "transform");
    const prevCtm = ctmStack[ctmStack.length - 1]!;
    activeCtm = elemTransform ? mulMat(prevCtm, parseTransformAttr(elemTransform)) : prevCtm;
    const effScaleX = Math.hypot(activeCtm[0], activeCtm[1]);
    const effScaleY = Math.hypot(activeCtm[2], activeCtm[3]);

    const fillAttr = getAttr(attrs, "fill") ?? (tag === "line" ? "none" : "#000000");
    const opAttr = parseFloat(getAttr(attrs, "opacity") ?? "1");
    const fillOpAttr = parseFloat(getAttr(attrs, "fill-opacity") ?? "1");
    const opacity = (Number.isFinite(opAttr) ? opAttr : 1) * (Number.isFinite(fillOpAttr) ? fillOpAttr : 1);
    const fill = fillAttr === "none" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(fillAttr);
    const effAlpha = Math.round(fill.a * (Number.isFinite(opacity) ? opacity : 1));
    const strokeAttr = getAttr(attrs, "stroke");
    const stroke = strokeAttr && strokeAttr !== "none" ? parseColor(strokeAttr) : { r: 0, g: 0, b: 0, a: 0 };
    const strokeW = parseSvgCoord(getAttr(attrs, "stroke-width"), 1, vbW) * ((effScaleX + effScaleY) / 2);

    if (tag === "text" && effAlpha > 0 && textContent.length > 0) {
      const tx = mapX(parseSvgCoord(getAttr(attrs, "x"), 0, vbW));
      const ty = mapY(parseSvgCoord(getAttr(attrs, "y"), 0, vbH));
      const fontSize = Math.max(6, parseSvgCoord(getAttr(attrs, "font-size"), 12, vbH) * effScaleY);
      const glyphH = Math.max(7, Math.round(fontSize * 0.76));
      const glyphW = Math.max(5, Math.round(glyphH * (5 / 7)));
      const advanceX = Math.max(glyphW + 1, Math.round(glyphW * 1.2));
      const anchor = (getAttr(attrs, "text-anchor") ?? "start").toLowerCase();
      const totalW = textContent.length * advanceX;
      const startX = anchor === "middle" ? tx - totalW / 2 : anchor === "end" ? tx - totalW : tx;
      const baseTopY = Math.round(ty - glyphH);
      for (let ci = 0; ci < textContent.length; ci++) {
        const ch = textContent.charCodeAt(ci);
        if (ch <= 32) continue;
        const glyphIdx = Math.max(0, Math.min(94, ch - 32));
        const isDescender = ch === 103 || ch === 106 || ch === 112 || ch === 113 || ch === 121 || ch === 44 || ch === 59;
        const charTopY = baseTopY + (isDescender ? Math.max(1, Math.round(glyphH / 7)) : 0);
        const charLeftX = Math.round(startX + ci * advanceX);
        for (let py = 0; py < glyphH; py++) {
          const gy = Math.min(6, Math.floor((py * 7) / glyphH));
          const screenY = charTopY + py;
          if (screenY < 0 || screenY >= height) continue;
          for (let px = 0; px < glyphW; px++) {
            const gx = Math.min(4, Math.floor((px * 5) / glyphW));
            const colBits = FONT_5X7[glyphIdx * 5 + gx]!;
            if ((colBits & (1 << gy)) !== 0) {
              const screenX = charLeftX + px;
              if (screenX >= 0 && screenX < width) {
                blendPixel(screenX, screenY, fill.r, fill.g, fill.b, effAlpha);
              }
            }
          }
        }
      }
      continue;
    }
    if (tag === "rect" && effAlpha > 0) {
      const rx = Math.round(mapX(parseSvgCoord(getAttr(attrs, "x"), 0, vbW)));
      const ry = Math.round(mapY(parseSvgCoord(getAttr(attrs, "y"), 0, vbH)));
      const rw = Math.round(parseSvgNumber(getAttr(attrs, "width"), vbW) * effScaleX);
      const rh = Math.round(parseSvgNumber(getAttr(attrs, "height"), vbH) * effScaleY);
      const rawCornerRx = parseSvgCoord(getAttr(attrs, "rx"), 0, vbW) * effScaleX;
      const rawCornerRy = parseSvgCoord(getAttr(attrs, "ry"), 0, vbH) * effScaleY;
      const cRx = Math.min(rw / 2, rawCornerRx > 0 ? rawCornerRx : rawCornerRy);
      const cRy = Math.min(rh / 2, rawCornerRy > 0 ? rawCornerRy : rawCornerRx);
      for (let y = Math.max(0, ry); y < Math.min(height, ry + rh); y++) {
        for (let x = Math.max(0, rx); x < Math.min(width, rx + rw); x++) {
          let pixAlpha = effAlpha;
          if (cRx > 0 && cRy > 0) {
            const px = x + 0.5;
            const py = y + 0.5;
            let cx = px;
            let cy = py;
            if (px < rx + cRx) cx = rx + cRx;
            else if (px > rx + rw - cRx) cx = rx + rw - cRx;
            if (py < ry + cRy) cy = ry + cRy;
            else if (py > ry + rh - cRy) cy = ry + rh - cRy;
            if (cx !== px && cy !== py) {
              const dx = (px - cx) / cRx;
              const dy = (py - cy) / cRy;
              const d = Math.hypot(dx, dy);
              const cov = Math.max(0, Math.min(1, 0.5 - (d - 1) * Math.min(cRx, cRy)));
              if (cov <= 0) continue;
              pixAlpha = Math.round(effAlpha * cov);
            }
          }
          blendPixel(x, y, fill.r, fill.g, fill.b, pixAlpha);
        }
      }
    } else if (tag === "circle" && effAlpha > 0) {
      const cx = mapX(parseSvgCoord(getAttr(attrs, "cx"), 0, vbW));
      const cy = mapY(parseSvgCoord(getAttr(attrs, "cy"), 0, vbH));
      const r = parseSvgCoord(getAttr(attrs, "r"), 0, (vbW + vbH) / 2);
      const rx = Math.max(0.5, r * effScaleX);
      const ry = Math.max(0.5, r * effScaleY);
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(height - 1, Math.ceil(cy + ry));
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(width - 1, Math.ceil(cx + rx));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const d = Math.hypot(dx, dy);
          const cov = Math.max(0, Math.min(1, 0.5 - (d - 1) * Math.min(rx, ry)));
          if (cov > 0) {
            blendPixel(x, y, fill.r, fill.g, fill.b, Math.round(effAlpha * cov));
          }
        }
      }
    } else if (tag === "ellipse" && effAlpha > 0) {
      const cx = mapX(parseSvgCoord(getAttr(attrs, "cx"), 0, vbW));
      const cy = mapY(parseSvgCoord(getAttr(attrs, "cy"), 0, vbH));
      const rx = Math.max(0.5, parseSvgCoord(getAttr(attrs, "rx"), 0, vbW) * effScaleX);
      const ry = Math.max(0.5, parseSvgCoord(getAttr(attrs, "ry"), 0, vbH) * effScaleY);
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(height - 1, Math.ceil(cy + ry));
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(width - 1, Math.ceil(cx + rx));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          const d = Math.hypot(dx, dy);
          const cov = Math.max(0, Math.min(1, 0.5 - (d - 1) * Math.min(rx, ry)));
          if (cov > 0) {
            blendPixel(x, y, fill.r, fill.g, fill.b, Math.round(effAlpha * cov));
          }
        }
      }
    } else if (tag === "line") {
      const lineStroke = parseColor(getAttr(attrs, "stroke") ?? "#000000");
      const x1 = mapX(parseSvgCoord(getAttr(attrs, "x1"), 0, vbW));
      const y1 = mapY(parseSvgCoord(getAttr(attrs, "y1"), 0, vbH));
      const x2 = mapX(parseSvgCoord(getAttr(attrs, "x2"), 0, vbW));
      const y2 = mapY(parseSvgCoord(getAttr(attrs, "y2"), 0, vbH));
      drawSegment(x1, y1, x2, y2, strokeW, lineStroke.r, lineStroke.g, lineStroke.b, lineStroke.a);
    } else if (tag === "polygon" || tag === "polyline" || tag === "path") {
      const parsedPath = tag === "path" ? parsePathPoints(getAttr(attrs, "d")) : undefined;
      const pts = parsedPath ? parsedPath.pts : parsePointsList(getAttr(attrs, "points"));
      const shouldFill =
        pts.length >= 3 &&
        effAlpha > 0 &&
        (tag === "polygon" || (tag === "path" && fillAttr !== "none") || getAttr(attrs, "fill") !== undefined);
      if (shouldFill) {
        let minX = width;
        let maxX = 0;
        let minY = height;
        let maxY = 0;
        for (const [px, py] of pts) {
          if (px < minX) minX = px;
          if (px > maxX) maxX = px;
          if (py < minY) minY = py;
          if (py > maxY) maxY = py;
        }
        const y0 = Math.max(0, Math.floor(minY));
        const y1 = Math.min(height - 1, Math.ceil(maxY));
        const x0 = Math.max(0, Math.floor(minX));
        const x1 = Math.min(width - 1, Math.ceil(maxX));
        for (let y = y0; y <= y1; y++) {
          const py = y + 0.5;
          for (let x = x0; x <= x1; x++) {
            const px = x + 0.5;
            let inside = false;
            for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
              const [xi, yi] = pts[i]!;
              const [xj, yj] = pts[j]!;
              if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
                inside = !inside;
              }
            }
            if (inside) {
              blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
            }
          }
        }
      }
      if (pts.length >= 2 && (stroke.a > 0 || tag === "polyline")) {
        const sCol = stroke.a > 0 ? stroke : parseColor(getAttr(attrs, "stroke") ?? "#000000");
        for (let i = 0; i + 1 < pts.length; i++) {
          drawSegment(pts[i]![0], pts[i]![1], pts[i + 1]![0], pts[i + 1]![1], strokeW, sCol.r, sCol.g, sCol.b, sCol.a);
        }
        if ((tag === "polygon" || (tag === "path" && parsedPath?.closed)) && stroke.a > 0) {
          drawSegment(
            pts[pts.length - 1]![0],
            pts[pts.length - 1]![1],
            pts[0]![0],
            pts[0]![1],
            strokeW,
            sCol.r,
            sCol.g,
            sCol.b,
            sCol.a
          );
        }
      }
    }
    // Primitive outlines are independent of fill (Graphviz uses fill="none").
    if (stroke.a > 0 && strokeW > 0 && ["rect", "ellipse", "circle"].includes(tag)) {
      const points: Array<[number, number]> = [];
      if (tag === "rect") {
        const x = parseSvgCoord(getAttr(attrs, "x"), 0, vbW);
        const y = parseSvgCoord(getAttr(attrs, "y"), 0, vbH);
        const w = parseSvgNumber(getAttr(attrs, "width"), vbW);
        const h = parseSvgNumber(getAttr(attrs, "height"), vbH);
        const rawRx = parseSvgCoord(getAttr(attrs, "rx"), 0, vbW);
        const rawRy = parseSvgCoord(getAttr(attrs, "ry"), 0, vbH);
        const rx = Math.max(0, Math.min(w / 2, rawRx || rawRy));
        const ry = Math.max(0, Math.min(h / 2, rawRy || rawRx));
        if (w <= 0 || h <= 0) continue;
        if (rx && ry) {
          const corners = [[x + w - rx, y + ry], [x + w - rx, y + h - ry], [x + rx, y + h - ry], [x + rx, y + ry]];
          for (let corner = 0; corner < 4; corner++)
            for (let step = 0; step <= 16; step++) {
              const angle = (corner - 1 + step / 16) * Math.PI / 2;
              points.push(mapPt(corners[corner]![0]! + rx * Math.cos(angle), corners[corner]![1]! + ry * Math.sin(angle)));
            }
        } else points.push(mapPt(x, y), mapPt(x + w, y), mapPt(x + w, y + h), mapPt(x, y + h));
      } else {
        const cx = parseSvgCoord(getAttr(attrs, "cx"), 0, vbW);
        const cy = parseSvgCoord(getAttr(attrs, "cy"), 0, vbH);
        const r = parseSvgCoord(getAttr(attrs, "r"), 0, (vbW + vbH) / 2);
        const rx = tag === "circle" ? r : parseSvgCoord(getAttr(attrs, "rx"), 0, vbW);
        const ry = tag === "circle" ? r : parseSvgCoord(getAttr(attrs, "ry"), 0, vbH);
        if (rx <= 0 || ry <= 0) continue;
        for (let step = 0; step < 128; step++) {
          const angle = step * Math.PI / 64;
          points.push(mapPt(cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)));
        }
      }
      const strokeOpacity = Number(getAttr(attrs, "stroke-opacity") ?? 1);
      const alpha = Math.round(stroke.a * (Number.isFinite(opAttr) ? opAttr : 1) * (Number.isFinite(strokeOpacity) ? strokeOpacity : 1));
      for (let i = 0; i < points.length; i++) {
        const a = points[i]!, b = points[(i + 1) % points.length]!;
        drawSegment(a[0], a[1], b[0], b[1], strokeW, stroke.r, stroke.g, stroke.b, alpha);
      }
    }
  }

  return {
    width,
    height,
    data,
    format: "svg",
    space: "srgb",
    channels: 4,
    depth: "uchar",
    density,
    hasAlpha: true
  };
}
