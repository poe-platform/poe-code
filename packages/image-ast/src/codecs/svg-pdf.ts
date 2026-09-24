import { PdfDocument, renderPdfPageToPng } from "@poe-code/pdf-ast";
import { parseColor, type ImageMetadata, type RgbaImage } from "../ast.js";
import { decodePngImage } from "./png.js";

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
  const regex = new RegExp(`\\b${attrName}\\s*=\\s*["']([^"']*)["']`, "i");
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
  const data = new Uint8Array(width * height * 4);
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
  const mapX = (ux: number) => (ux - vbMinX) * scaleX;
  const mapY = (uy: number) => (uy - vbMinY) * scaleY;

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
      pts.push([mapX(nums[i]!), mapY(nums[i + 1]!)]);
    }
    return pts;
  };

  // Rasterize <rect>, <circle>, <ellipse>, <line>, <polygon>, and <polyline> elements in document order
  const elemRegex = /<(rect|circle|ellipse|line|polygon|polyline)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = elemRegex.exec(text)) !== null) {
    const tag = match[1]!.toLowerCase();
    const attrs = match[2]!;
    const fillAttr = getAttr(attrs, "fill") ?? (tag === "line" ? "none" : "#000000");
    const opacity = parseFloat(getAttr(attrs, "opacity") ?? getAttr(attrs, "fill-opacity") ?? "1");
    const fill = fillAttr === "none" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(fillAttr);
    const effAlpha = Math.round(fill.a * (Number.isFinite(opacity) ? opacity : 1));
    const strokeAttr = getAttr(attrs, "stroke");
    const stroke = strokeAttr && strokeAttr !== "none" ? parseColor(strokeAttr) : { r: 0, g: 0, b: 0, a: 0 };
    const strokeW = parseSvgCoord(getAttr(attrs, "stroke-width"), 1, vbW) * ((scaleX + scaleY) / 2);

    if (tag === "rect" && effAlpha > 0) {
      const rx = Math.round(mapX(parseSvgCoord(getAttr(attrs, "x"), 0, vbW)));
      const ry = Math.round(mapY(parseSvgCoord(getAttr(attrs, "y"), 0, vbH)));
      const rw = Math.round(parseSvgNumber(getAttr(attrs, "width"), vbW) * scaleX);
      const rh = Math.round(parseSvgNumber(getAttr(attrs, "height"), vbH) * scaleY);
      for (let y = Math.max(0, ry); y < Math.min(height, ry + rh); y++) {
        for (let x = Math.max(0, rx); x < Math.min(width, rx + rw); x++) {
          blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
        }
      }
    } else if (tag === "circle" && effAlpha > 0) {
      const cx = mapX(parseSvgCoord(getAttr(attrs, "cx"), 0, vbW));
      const cy = mapY(parseSvgCoord(getAttr(attrs, "cy"), 0, vbH));
      const r = parseSvgCoord(getAttr(attrs, "r"), 0, (vbW + vbH) / 2);
      const rx = Math.max(0.5, r * scaleX);
      const ry = Math.max(0.5, r * scaleY);
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(height - 1, Math.ceil(cy + ry));
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(width - 1, Math.ceil(cx + rx));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
          }
        }
      }
    } else if (tag === "ellipse" && effAlpha > 0) {
      const cx = mapX(parseSvgCoord(getAttr(attrs, "cx"), 0, vbW));
      const cy = mapY(parseSvgCoord(getAttr(attrs, "cy"), 0, vbH));
      const rx = Math.max(0.5, parseSvgCoord(getAttr(attrs, "rx"), 0, vbW) * scaleX);
      const ry = Math.max(0.5, parseSvgCoord(getAttr(attrs, "ry"), 0, vbH) * scaleY);
      const minY = Math.max(0, Math.floor(cy - ry));
      const maxY = Math.min(height - 1, Math.ceil(cy + ry));
      const minX = Math.max(0, Math.floor(cx - rx));
      const maxX = Math.min(width - 1, Math.ceil(cx + rx));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = (x + 0.5 - cx) / rx;
          const dy = (y + 0.5 - cy) / ry;
          if (dx * dx + dy * dy <= 1) {
            blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
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
    } else if (tag === "polygon" || tag === "polyline") {
      const pts = parsePointsList(getAttr(attrs, "points"));
      if (pts.length >= 3 && effAlpha > 0 && (tag === "polygon" || getAttr(attrs, "fill") !== undefined)) {
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
        if (tag === "polygon" && stroke.a > 0) {
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
