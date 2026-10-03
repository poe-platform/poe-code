import {multiplySvgMatrices,applySvgTransform} from "./svg-transform.js";
import type {SvgMatrix} from "./svg-renderer.js";
import {svgPathSteps,svgPathTokens} from "./svg-path.js";
import {parseSvgNumber} from "./svg-number.js";
import {rasterSvgElement,type SvgPixel} from "./svg-renderer.js";
export type {SvgPixel} from "./svg-renderer.js";
export {FONT_5X7} from "./font-5x7.js";
import { PdfDocument, renderPdfPageToPng } from "@poe-code/pdf-ast";
import { type ImageMetadata, type RgbaImage } from "../ast.js";
import { decodePngImage, encodePngImage } from "./png.js";




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



/** Shared blend arithmetic for buffered and caller-backed raster surfaces. */
export function blendSvgPixel(data: Uint8Array, idx: number, r: number, g: number, b: number, a: number): void {
  const srcA = a / 255;
  const dstA = data[idx + 3]! / 255;
  const outA = srcA + dstA * (1 - srcA);
  if (outA <= 0) return;
  data[idx] = Math.round((r * srcA + data[idx]! * dstA * (1 - srcA)) / outA);
  data[idx + 1] = Math.round((g * srcA + data[idx + 1]! * dstA * (1 - srcA)) / outA);
  data[idx + 2] = Math.round((b * srcA + data[idx + 2]! * dstA * (1 - srcA)) / outA);
  data[idx + 3] = Math.round(outA * 255);
}

export function decodeSvgImage(bytes: Uint8Array, options?: {readonly density?: number}): RgbaImage {
  const meta = readSvgMetadata(bytes, options), {width, height, density} = meta;
  const data = new Uint8Array(new ArrayBuffer(width * height * 4 + height), 0, width * height * 4);
  for (const pixel of svgRasterSteps(bytes, options, meta)) {if (!pixel) continue; const [x, y, r, g, b, a] = pixel; blendSvgPixel(data, (y * width + x) * 4, r, g, b, a);}
  return {width, height, data, format: "svg", space: "srgb", channels: 4, depth: "uchar", density, hasAlpha: true};
}

export function* svgRasterSteps(
  bytes: Uint8Array,
  options?: { readonly density?: number },
  meta: ImageMetadata = readSvgMetadata(bytes, options)
): Generator<SvgPixel | undefined, void, unknown> {
  const { width, height, density } = meta;
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
  type Mat2D = SvgMatrix;
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
      cur = applySvgTransform(cur, kind, args);
    }
    return cur;
  };
  const rootCtm: Mat2D = [scaleX, 0, 0, scaleY, -vbMinX * scaleX, -vbMinY * scaleY];
  let activeCtm: Mat2D = rootCtm;
  const mapPt = (ux: number, uy: number): [number, number] => [
    activeCtm[0] * ux + activeCtm[2] * uy + activeCtm[4],
    activeCtm[1] * ux + activeCtm[3] * uy + activeCtm[5]
  ];

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
    const tokens = svgPathTokens(dRaw ?? ""), steps = svgPathSteps(), pts: Array<[number, number]> = [];
    let next = steps.next();
    while (!next.done) {
      if (next.value === undefined) next = steps.next(tokens.next().value);
      else { pts.push(mapPt(...next.value)); next = steps.next(); }
    }
    return {pts, closed: next.value};
  };

  let syntaxWork = 0;
  const ctmStack: Mat2D[] = [rootCtm];
  // Rasterize <rect>, <circle>, <ellipse>, <line>, <polygon>, and <polyline> elements in document order
  const elemRegex = /<text\b([^>]*)>([\s\S]*?)<\/text>|<(\/?)(g|rect|circle|ellipse|line|polygon|polyline|path)\b([^>]*)\/?>/gi;
  let match: RegExpExecArray | null;
  while ((match = elemRegex.exec(text)) !== null) {
    if (++syntaxWork % 16384 === 0) yield undefined;
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
        const nextCtm = multiplySvgMatrices(ctmStack[ctmStack.length - 1]!, parseTransformAttr(getAttr(attrs, "transform")));
        ctmStack.push(nextCtm);
        activeCtm = nextCtm;
      }
      continue;
    }
    if (isClose) continue;
    const elemTransform = getAttr(attrs, "transform");
    const prevCtm = ctmStack[ctmStack.length - 1]!;
    activeCtm = elemTransform ? multiplySvgMatrices(prevCtm, parseTransformAttr(elemTransform)) : prevCtm;
    const parsed = tag === "path" ? parsePathPoints(getAttr(attrs, "d")) : undefined;
    const points = parsed?.pts ?? (tag === "polygon" || tag === "polyline" ? parsePointsList(getAttr(attrs, "points")) : []);
    const fields: Record<string,string|undefined> = {};
    for (const name of ["cx", "cy", "fill", "fill-opacity", "font-size", "height", "opacity", "r", "rx", "ry", "stroke", "stroke-opacity", "stroke-width", "text-anchor", "width", "x", "x1", "x2", "y", "y1", "y2"]) fields[name] = getAttr(attrs, name);
    const steps = rasterSvgElement({tag,attrs:fields,matrix:activeCtm,pointCount:points.length,closed:parsed?.closed??false,textLength:textContent.length},{width,height,vbW,vbH});
    let next = steps.next();
    try { while (!next.done) {
      const event = next.value;
      if (event && "kind" in event) next = steps.next(event.kind === "point" ? points[event.index] : textContent.charCodeAt(event.index));
      else { yield event; next = steps.next(); }
    }} finally { steps.return(); }

  }

}
