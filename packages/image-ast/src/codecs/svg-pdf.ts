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
  const num = parseFloat(val.replace(/px|pt|mm|cm|in|%/g, "").trim());
  return Number.isFinite(num) && num > 0 ? num : fallback;
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
  const scale = density / 72;
  const data = new Uint8Array(width * height * 4);
  const text = new TextDecoder().decode(bytes);

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

  // Rasterize <rect>, <circle>, and <line> elements in document order
  const elemRegex = /<(rect|circle|ellipse|line)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = elemRegex.exec(text)) !== null) {
    const tag = match[1]!.toLowerCase();
    const attrs = match[2]!;
    const fillAttr = getAttr(attrs, "fill") ?? "#000000";
    const opacity = parseFloat(getAttr(attrs, "opacity") ?? getAttr(attrs, "fill-opacity") ?? "1");
    const fill = fillAttr === "none" ? { r: 0, g: 0, b: 0, a: 0 } : parseColor(fillAttr);
    const effAlpha = Math.round(fill.a * (Number.isFinite(opacity) ? opacity : 1));

    if (tag === "rect" && effAlpha > 0) {
      const rx = Math.round(parseFloat(getAttr(attrs, "x") ?? "0") * scale);
      const ry = Math.round(parseFloat(getAttr(attrs, "y") ?? "0") * scale);
      const rw = Math.round(parseSvgNumber(getAttr(attrs, "width"), width / scale) * scale);
      const rh = Math.round(parseSvgNumber(getAttr(attrs, "height"), height / scale) * scale);
      for (let y = Math.max(0, ry); y < Math.min(height, ry + rh); y++) {
        for (let x = Math.max(0, rx); x < Math.min(width, rx + rw); x++) {
          blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
        }
      }
    } else if (tag === "circle" && effAlpha > 0) {
      const cx = parseFloat(getAttr(attrs, "cx") ?? "0") * scale;
      const cy = parseFloat(getAttr(attrs, "cy") ?? "0") * scale;
      const r = parseFloat(getAttr(attrs, "r") ?? "0") * scale;
      const r2 = r * r;
      const minY = Math.max(0, Math.floor(cy - r));
      const maxY = Math.min(height - 1, Math.ceil(cy + r));
      const minX = Math.max(0, Math.floor(cx - r));
      const maxX = Math.min(width - 1, Math.ceil(cx + r));
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          if (dx * dx + dy * dy <= r2) {
            blendPixel(x, y, fill.r, fill.g, fill.b, effAlpha);
          }
        }
      }
    } else if (tag === "line") {
      const strokeAttr = getAttr(attrs, "stroke") ?? "#000000";
      const stroke = parseColor(strokeAttr);
      const x1 = parseFloat(getAttr(attrs, "x1") ?? "0") * scale;
      const y1 = parseFloat(getAttr(attrs, "y1") ?? "0") * scale;
      const x2 = parseFloat(getAttr(attrs, "x2") ?? "0") * scale;
      const y2 = parseFloat(getAttr(attrs, "y2") ?? "0") * scale;
      const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1)));
      for (let s = 0; s <= steps; s++) {
        const px = Math.round(x1 + ((x2 - x1) * s) / steps);
        const py = Math.round(y1 + ((y2 - y1) * s) / steps);
        blendPixel(px, py, stroke.r, stroke.g, stroke.b, stroke.a);
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
