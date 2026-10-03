import {ConvolutionPixel} from "./convolve.js";
import {extendedCoordinate,PixelMedian,trimBackground} from "./canvas-math.js";
import {SRGB_TO_LINEAR_LUT,linearToSrgbByte,srgbToBwByte,srgbToLab,labToSrgb} from "./color.js";
import {NormalizationHistogram,normalizeRgb} from "./normalize.js";
import type {
  BlendMode,
  ChannelStats,
  ColorSpace,
  CompositeLayer,
  ImageStats,
  RgbaColor,
  RgbaImage
} from "../ast.js";
import { decodeImage } from "../codecs/index.js";
import { resolveGravityOffset } from "./resize.js";

export function *flipImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    const srcOffset = y * rowBytes;
    const dstOffset = (height - 1 - y) * rowBytes;
    {
 const copySource = data.subarray(srcOffset, srcOffset + rowBytes);
 const copyTargetOffset = dstOffset;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  out.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
  }
  return { ...img, data: out };
}

export function *flopImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const srcIdx = (y * width + x) * 4;
      const dstIdx = (y * width + (width - 1 - x)) * 4;
      out[dstIdx] = data[srcIdx]!;
      out[dstIdx + 1] = data[srcIdx + 1]!;
      out[dstIdx + 2] = data[srcIdx + 2]!;
      out[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }
  return { ...img, data: out };
}

function *rotate90CWSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const dstW = height;
  const dstH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const srcIdx = (y * width + x) * 4;
      const dstX = height - 1 - y;
      const dstY = x;
      const dstIdx = (dstY * dstW + dstX) * 4;
      out[dstIdx] = data[srcIdx]!;
      out[dstIdx + 1] = data[srcIdx + 1]!;
      out[dstIdx + 2] = data[srcIdx + 2]!;
      out[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }
  return { ...img, width: dstW, height: dstH, data: out };
}

function *rotate180Steps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const total = width * height;
  for (let i = 0; i < total; i++) {
    if (++work % 16384 === 0) yield;
    const srcIdx = i * 4;
    const dstIdx = (total - 1 - i) * 4;
    out[dstIdx] = data[srcIdx]!;
    out[dstIdx + 1] = data[srcIdx + 1]!;
    out[dstIdx + 2] = data[srcIdx + 2]!;
    out[dstIdx + 3] = data[srcIdx + 3]!;
  }
  return { ...img, data: out };
}

function *rotate270CWSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const dstW = height;
  const dstH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      const srcIdx = (y * width + x) * 4;
      const dstX = y;
      const dstY = width - 1 - x;
      const dstIdx = (dstY * dstW + dstX) * 4;
      out[dstIdx] = data[srcIdx]!;
      out[dstIdx + 1] = data[srcIdx + 1]!;
      out[dstIdx + 2] = data[srcIdx + 2]!;
      out[dstIdx + 3] = data[srcIdx + 3]!;
    }
  }
  return { ...img, width: dstW, height: dstH, data: out };
}

export function *applyExifOrientationSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  const orientation = img.orientation;
  if (!orientation || orientation === 1) {
    return { ...img, orientation: 1 };
  }
  let result = img;
  switch (orientation) {
    case 2:
      result = (yield* flopImageSteps(img));
      break;
    case 3:
      result = (yield* rotate180Steps(img));
      break;
    case 4:
      result = (yield* flipImageSteps(img));
      break;
    case 5:
      result = (yield* flopImageSteps((yield* rotate90CWSteps(img))));
      break;
    case 6:
      result = (yield* rotate90CWSteps(img));
      break;
    case 7:
      result = (yield* flipImageSteps((yield* rotate90CWSteps(img))));
      break;
    case 8:
      result = (yield* rotate270CWSteps(img));
      break;
    default:
      break;
  }
  return { ...result, orientation: 1 };
}

export function *rotateImageSteps(
  img: RgbaImage,
  angle: number,
  background: RgbaColor = { r: 0, g: 0, b: 0, a: 255 }
): Generator<void, RgbaImage, void> {
  const norm = ((angle % 360) + 360) % 360;
  if (Math.abs(norm) < 1e-6) return img;
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight && Math.abs(norm - 180) >= 1e-6) {
    throw new Error("Rotate is not supported for multi-page images");
  }
  if (Math.abs(norm - 90) < 1e-6) return (yield* rotate90CWSteps(img));
  if (Math.abs(norm - 180) < 1e-6) return (yield* rotate180Steps(img));
  if (Math.abs(norm - 270) < 1e-6) return (yield* rotate270CWSteps(img));

  const rad = (norm * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return (yield* affineImageSteps(img, {
    matrix: [cos, -sin, sin, cos],
    background,
    interpolator: "bilinear"
  }));
}

export function *extractImageSteps(
  img: RgbaImage,
  region: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
): Generator<void, RgbaImage, void> {
  let work = 0;
  const left = Math.round(region.left);
  const top = Math.round(region.top);
  const width = Math.round(region.width);
  const height = Math.round(region.height);
  if (
    width <= 0 ||
    height <= 0 ||
    left < 0 ||
    top < 0 ||
    left + width > img.width ||
    top + height > img.height
  ) {
    throw new Error(
      `extract_area: bad extract area (left=${left}, top=${top}, width=${width}, height=${height} on ${img.width}x${img.height})`
    );
  }
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight && top + height <= img.pageHeight) {
    const pages = img.pages;
    const pageH = img.pageHeight;
    const out = new Uint8Array(width * height * pages * 4);
    for (let p = 0; p < pages; p++) {
    if (++work % 16384 === 0) yield;
      for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
        const srcStart = ((p * pageH + top + y) * img.width + left) * 4;
        {
 const copySource = img.data.subarray(srcStart, srcStart + width * 4);
 const copyTargetOffset = (p * height + y) * width * 4;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  out.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
      }
    }
    return { ...img, width, height: height * pages, pageHeight: height, pages, data: out };
  }
  const out = new Uint8Array(new ArrayBuffer(width * height * 4 + height), 0, width * height * 4);
  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    const srcStart = ((top + y) * img.width + left) * 4;
    {
 const copySource = img.data.subarray(srcStart, srcStart + width * 4);
 const copyTargetOffset = y * width * 4;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  out.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
  }
  return { ...img, width, height, data: out };
}

export function *trimImageSteps(
  img: RgbaImage,
  options?: { readonly threshold?: number; readonly background?: RgbaColor; readonly lineArt?: boolean }
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight) {
    throw new Error("Trim is not supported for multi-page images");
  }
  const threshold = options?.threshold ?? 10;
  const detectImg =
    options?.lineArt || img.width < 3 || img.height < 3 ? img : (yield* medianImageSteps(img, 3));
  const ref: RgbaColor = options?.background ?? {
    r: detectImg.data[0] ?? 0,
    g: detectImg.data[1] ?? 0,
    b: detectImg.data[2] ?? 0,
    a: detectImg.data[3] ?? 255
  };
  const matches=trimBackground(ref,threshold);
  const isBg=(x:number,y:number):boolean=>{
    const index=(y*img.width+x)*4;
    return matches(detectImg.data[index]!,detectImg.data[index+1]!,detectImg.data[index+2]!,detectImg.data[index+3]!);
  };

  let top = 0;
  while (top < img.height) {
    if (++work % 16384 === 0) yield;
    let allBg = true;
    for (let x = 0; x < img.width; x++) {
    if (++work % 16384 === 0) yield;
      if (!isBg(x, top)) {
        allBg = false;
        break;
      }
    }
    if (!allBg) break;
    top++;
  }
  if (top >= img.height) {
    return {
      ...img,
      trimOffsetLeft: 0,
      trimOffsetTop: 0
    };
  }

  let bottom = img.height - 1;
  while (bottom > top) {
    if (++work % 16384 === 0) yield;
    let allBg = true;
    for (let x = 0; x < img.width; x++) {
    if (++work % 16384 === 0) yield;
      if (!isBg(x, bottom)) {
        allBg = false;
        break;
      }
    }
    if (!allBg) break;
    bottom--;
  }

  let left = 0;
  while (left < img.width) {
    if (++work % 16384 === 0) yield;
    let allBg = true;
    for (let y = top; y <= bottom; y++) {
    if (++work % 16384 === 0) yield;
      if (!isBg(left, y)) {
        allBg = false;
        break;
      }
    }
    if (!allBg) break;
    left++;
  }

  let right = img.width - 1;
  while (right > left) {
    if (++work % 16384 === 0) yield;
    let allBg = true;
    for (let y = top; y <= bottom; y++) {
    if (++work % 16384 === 0) yield;
      if (!isBg(right, y)) {
        allBg = false;
        break;
      }
    }
    if (!allBg) break;
    right--;
  }

  const extracted = (yield* extractImageSteps(img, {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  }));
  return {
    ...extracted,
    trimOffsetLeft: -left,
    trimOffsetTop: -top
  };
}

export function *extendImageSteps(
  img: RgbaImage,
  spec: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly background: RgbaColor;
    readonly extendWith: "background" | "copy" | "repeat" | "mirror";
  }
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight) {
    const pages = img.pages;
    const pageH = img.pageHeight;
    const pageBytes = img.width * pageH * 4;
    const extendedPages: RgbaImage[] = [];
    for (let p = 0; p < pages; p++) {
    if (++work % 16384 === 0) yield;
      extendedPages.push(
        (yield* extendImageSteps(
          { ...img, height: pageH, pages: 1, pageHeight: pageH, data: img.data.subarray(p * pageBytes, (p + 1) * pageBytes) },
          spec
        ))
      );
    }
    const first = extendedPages[0]!;
    const outW = first.width;
    const outPageH = first.height;
    const outData = new Uint8Array(outW * outPageH * pages * 4);
    for (let p = 0; p < pages; p++) {
    if (++work % 16384 === 0) yield;
      {
 const copySource = extendedPages[p]!.data;
 const copyTargetOffset = p * outW * outPageH * 4;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  outData.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
    }
    return { ...first, width: outW, height: outPageH * pages, pages, pageHeight: outPageH, data: outData };
  }
  const top = Math.max(0, Math.round(spec.top));
  const bottom = Math.max(0, Math.round(spec.bottom));
  const left = Math.max(0, Math.round(spec.left));
  const right = Math.max(0, Math.round(spec.right));
  const dstW = img.width + left + right;
  const dstH = img.height + top + bottom;
  const out = new Uint8Array(new ArrayBuffer(dstW * dstH * 4 + dstH), 0, dstW * dstH * 4);


  for (let y = 0; y < dstH; y++) {
    if (++work % 16384 === 0) yield;
    const sy = extendedCoordinate(y - top, img.height,spec.extendWith);
    for (let x = 0; x < dstW; x++) {
    if (++work % 16384 === 0) yield;
      const sx = extendedCoordinate(x - left, img.width,spec.extendWith);
      const dIdx = (y * dstW + x) * 4;
      if (sx < 0 || sy < 0) {
        out[dIdx] = spec.background.r;
        out[dIdx + 1] = spec.background.g;
        out[dIdx + 2] = spec.background.b;
        out[dIdx + 3] = spec.background.a;
      } else {
        const sIdx = (sy * img.width + sx) * 4;
        out[dIdx] = img.data[sIdx]!;
        out[dIdx + 1] = img.data[sIdx + 1]!;
        out[dIdx + 2] = img.data[sIdx + 2]!;
        out[dIdx + 3] = img.data[sIdx + 3]!;
      }
    }
  }
  return {
    ...img,
    width: dstW,
    height: dstH,
    data: out,
    hasAlpha: img.hasAlpha || (spec.extendWith === "background" && spec.background.a < 255),
    channels:
      img.hasAlpha || (spec.extendWith === "background" && spec.background.a < 255)
        ? img.channels < 3
          ? 2
          : 4
        : img.channels
  };
}

function getBlendModeId(mode: BlendMode): number {
  switch (mode) {
    case "multiply": return 1;
    case "screen": return 2;
    case "overlay": return 3;
    case "darken": return 4;
    case "lighten": return 5;
    case "color-dodge":
    case "colour-dodge": return 6;
    case "color-burn":
    case "colour-burn": return 7;
    case "hard-light": return 8;
    case "soft-light": return 9;
    case "difference": return 10;
    case "exclusion": return 11;
    default: return 0;
  }
}

function blendChannelById(s: number, d: number, modeId: number): number {
  switch (modeId) {
    case 1: return s * d;
    case 2: return s + d - s * d;
    case 3: return d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case 4: return Math.min(s, d);
    case 5: return Math.max(s, d);
    case 6: return d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s));
    case 7: return d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s);
    case 8: return s < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case 9:
      return s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (d <= 0.25 ? ((16 * d - 12) * d + 3) * d : Math.sqrt(d) - d);
    case 10: return Math.abs(d - s);
    case 11: return s + d - 2 * s * d;
    case 12: return Math.min(1, s + d);
    default: return s;
  }
}

function blendChannel(s: number, d: number, mode: BlendMode): number {
  return blendChannelById(s, d, getBlendModeId(mode));
}

export function *compositeImageSteps(
  base: RgbaImage,
  layers: readonly CompositeLayer[],
  readFile?: (path: string) => Uint8Array
): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(base.data);
  const baseW = base.width;
  const baseH = base.height;
  const initU32 = new Uint32Array(out.buffer, out.byteOffset, baseW * baseH);
  for (let i = 0; i < initU32.length; i++) {
    if (++work % 16384 === 0) yield;
    if ((initU32[i]! >>> 24) === 0) {
      initU32[i] = 0;
    }
  }

  for (const layer of layers) {
    if (++work % 16384 === 0) yield;
    let overlay: RgbaImage;
    const layerOpts = {
      ...(layer.density !== undefined ? { density: layer.density } : {}),
      ...(layer.page !== undefined ? { page: layer.page } : {}),
      ...(layer.pages !== undefined ? { pages: layer.pages } : {}),
      ...(layer.animated !== undefined ? { animated: layer.animated } : {}),
      ...(layer.raw !== undefined
        ? {
            raw: {
              ...layer.raw,
              premultiplied: false
            }
          }
        : {})
    };
    if (typeof layer.input === "string") {
      if (!layer.input.trimStart().startsWith("<") && !readFile) {
        throw new Error("Composite file inputs require an explicit readFile capability");
      }
      const strBytes = layer.input.trimStart().startsWith("<")
        ? new TextEncoder().encode(layer.input)
        : readFile!(layer.input);
      overlay = decodeImage(strBytes, layerOpts);
    } else if (layer.input instanceof Uint8Array || ArrayBuffer.isView(layer.input) || layer.input instanceof ArrayBuffer) {
      const bufBytes =
        layer.input instanceof Uint8Array
          ? layer.input
          : ArrayBuffer.isView(layer.input)
            ? new Uint8Array(layer.input.buffer, layer.input.byteOffset, layer.input.byteLength)
            : new Uint8Array(layer.input);
      overlay = decodeImage(bufBytes, layerOpts);

    } else {
      overlay = decodeImage(undefined, {
        ...(layer.input.create !== undefined ? { create: layer.input.create } : {}),
        ...(layer.input.text !== undefined ? { text: layer.input.text } : {}),
        ...(layer.density !== undefined ? { density: layer.density } : {})
      });
    }

    if (layer.autoOrient && overlay.orientation && overlay.orientation > 1) {
      overlay = (yield* applyExifOrientationSteps(overlay));
    }
    if (overlay.width > baseW || overlay.height > baseH) {
      throw new Error("Image to composite must have same dimensions or smaller");
    }
    const blend: BlendMode = layer.blend ?? "over";
    const grav = resolveGravityOffset(
      baseW,
      baseH,
      overlay.width,
      overlay.height,
      layer.gravity ?? "center",
      !layer.tile
    );
    let startX: number;
    let startY: number;
    if (layer.tile && layer.left !== undefined && layer.top !== undefined) {
      const reqLeft = Math.round(layer.left);
      const reqTop = Math.round(layer.top);
      if (reqLeft < 0 || reqTop < 0) {
        throw new Error("extract_area: bad extract area");
      }
      const repW = (overlay.width < baseW ? Math.floor(baseW / overlay.width) + 1 : 1) * overlay.width;
      const repH = (overlay.height < baseH ? Math.floor(baseH / overlay.height) + 1 : 1) * overlay.height;
      startX = -Math.min(reqLeft, repW - baseW);
      startY = -Math.min(reqTop, repH - baseH);
    } else {
      startX =
        layer.left !== undefined
          ? Math.round(layer.left)
          : layer.top !== undefined
            ? 0
            : grav.x;
      startY =
        layer.top !== undefined
          ? Math.round(layer.top)
          : layer.left !== undefined
            ? 0
            : grav.y;
    }

    // Fast scanline copy for opaque non-tiled "over"/"source" layers (e.g. multi-megapixel panorama/grid merges)
    if (!layer.tile && !overlay.hasAlpha && (blend === "over" || blend === "source")) {
      if (blend === "source") {
        out.fill(0);
      }
      const copyStartX = Math.max(0, startX);
      const copyEndX = Math.min(baseW, startX + overlay.width);
      const copyW = copyEndX - copyStartX;
      if (copyW > 0) {
        const srcOffX = copyStartX - startX;
        const copyStartY = Math.max(0, startY);
        const copyEndY = Math.min(baseH, startY + overlay.height);
        for (let dy = copyStartY; dy < copyEndY; dy++) {
    if (++work % 16384 === 0) yield;
          const sy = dy - startY;
          const sRowOff = (sy * overlay.width + srcOffX) * 4;
          const dRowOff = (dy * baseW + copyStartX) * 4;
          {
 const copySource = overlay.data.subarray(sRowOff, sRowOff + copyW * 4);
 const copyTargetOffset = dRowOff;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  out.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
        }
      }
      continue;
    }

    const yStart = layer.tile ? 0 : Math.max(0, -startY);
    const yEnd = layer.tile ? baseH : Math.min(overlay.height, baseH - startY);
    const xStart = layer.tile ? 0 : Math.max(0, -startX);
    const xEnd = layer.tile ? baseW : Math.min(overlay.width, baseW - startX);
    const isOver = blend === "over";
    const blendId = getBlendModeId(blend);
    const isSeparable = blendId > 0;
    const skipWhenSaZero =
      blend !== "clear" &&
      blend !== "source" &&
      blend !== "in" &&
      blend !== "out" &&
      blend !== "dest-in" &&
      blend !== "dest-atop";
    const dstBuf = !skipWhenSaZero && !layer.tile ? new Uint8Array(out) : out;
    if (!skipWhenSaZero && !layer.tile) {
      out.fill(0);
    }

    const inv255 = 1 / 255;
    const ovData = overlay.data;
    const ovW = overlay.width;
    const ovH = overlay.height;
    const xCount = Math.max(0, xEnd - xStart);
    const sxTable = new Int32Array(xCount);
    for (let i = 0; i < xCount; i++) {
    if (++work % 16384 === 0) yield;
      const x = xStart + i;
      const dx = layer.tile ? x : startX + x;
      sxTable[i] = layer.tile ? (((dx - startX) % ovW) + ovW) % ovW : x;
    }

    for (let ty = 0; ty < 1; ty++) {
    if (++work % 16384 === 0) yield;
      for (let tx = 0; tx < 1; tx++) {
    if (++work % 16384 === 0) yield;
        for (let y = yStart; y < yEnd; y++) {
    if (++work % 16384 === 0) yield;
          const dy = layer.tile ? y : startY + y;
          const sy = layer.tile
            ? (((dy - startY) % ovH) + ovH) % ovH
            : y;
          const syRow = sy * ovW;
          const dyRow = dy * baseW;
          for (let xi = 0; xi < xCount; xi++) {
    if (++work % 16384 === 0) yield;
            const x = xStart + xi;
            const dx = layer.tile ? x : startX + x;
            const sx = sxTable[xi]!;
            const sIdx = (syRow + sx) * 4;
            const saByte = ovData[sIdx + 3]!;
            if (saByte === 0 && skipWhenSaZero) continue;
            const dIdx = (dyRow + dx) * 4;
            if (saByte === 0 && !skipWhenSaZero) {
              out[dIdx] = 0;
              out[dIdx + 1] = 0;
              out[dIdx + 2] = 0;
              out[dIdx + 3] = 0;
              continue;
            }
            if (isOver && saByte === 255) {
              out[dIdx] = ovData[sIdx]!;
              out[dIdx + 1] = ovData[sIdx + 1]!;
              out[dIdx + 2] = ovData[sIdx + 2]!;
              out[dIdx + 3] = 255;
              continue;
            }
            const daByte = dstBuf[dIdx + 3]!;
            if (isOver && daByte === 255 && !layer.premultiplied) {
              const invSa = 255 - saByte;
              out[dIdx] = ((ovData[sIdx]! * saByte + out[dIdx]! * invSa) / 255) | 0;
              out[dIdx + 1] = ((ovData[sIdx + 1]! * saByte + out[dIdx + 1]! * invSa) / 255) | 0;
              out[dIdx + 2] = ((ovData[sIdx + 2]! * saByte + out[dIdx + 2]! * invSa) / 255) | 0;
              continue;
            }

            const sa = saByte * inv255;
            const srP = layer.premultiplied ? ovData[sIdx]! * inv255 : (ovData[sIdx]! * inv255) * sa;
            const sgP = layer.premultiplied ? ovData[sIdx + 1]! * inv255 : (ovData[sIdx + 1]! * inv255) * sa;
            const sbP = layer.premultiplied ? ovData[sIdx + 2]! * inv255 : (ovData[sIdx + 2]! * inv255) * sa;
            const sr = layer.premultiplied ? (sa > 0 ? srP / sa : 0) : ovData[sIdx]! * inv255;
            const sg = layer.premultiplied ? (sa > 0 ? sgP / sa : 0) : ovData[sIdx + 1]! * inv255;
            const sb = layer.premultiplied ? (sa > 0 ? sbP / sa : 0) : ovData[sIdx + 2]! * inv255;

            const dr = dstBuf[dIdx]! * inv255;
            const dg = dstBuf[dIdx + 1]! * inv255;
            const db = dstBuf[dIdx + 2]! * inv255;
            const da = daByte * inv255;

            if (isSeparable) {
              const outA = sa + da * (1 - sa);
              if (outA <= 0) {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              } else {
                const drP = dr * da;
                const dgP = dg * da;
                const dbP = db * da;
                const br = blendChannelById(srP, drP, blendId);
                const bg = blendChannelById(sgP, dgP, blendId);
                const bb = blendChannelById(sbP, dbP, blendId);
                const invDa = 1 - da;
                const invSa = 1 - sa;
                const saDa = sa * da;
                const invOutA255 = 255 / outA;
                const rOut = ((invDa * srP + invSa * drP + saDa * br) * invOutA255 + 1e-5) | 0;
                const gOut = ((invDa * sgP + invSa * dgP + saDa * bg) * invOutA255 + 1e-5) | 0;
                const bOut = ((invDa * sbP + invSa * dbP + saDa * bb) * invOutA255 + 1e-5) | 0;
                out[dIdx] = rOut < 0 ? 0 : rOut > 255 ? 255 : rOut;
                out[dIdx + 1] = gOut < 0 ? 0 : gOut > 255 ? 255 : gOut;
                out[dIdx + 2] = bOut < 0 ? 0 : bOut > 255 ? 255 : bOut;
                out[dIdx + 3] = daByte === 255 ? 255 : ((outA * 255 + 1e-5) | 0);
              }
              continue;
            }

            if (blend === "clear") {
              out[dIdx] = 0;
              out[dIdx + 1] = 0;
              out[dIdx + 2] = 0;
              out[dIdx + 3] = 0;
              continue;
            }
            if (blend === "source") {
              if (sa > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.floor(sr * 255 + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(sg * 255 + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(sb * 255 + 1e-5)));
                out[dIdx + 3] = saByte;
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "dest") continue;
            if (blend === "over") {
              const outA = sa + da * (1 - sa);
              if (outA > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((((srP + dr * da * (1 - sa) + 1e-5)) / outA) * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((((sgP + dg * da * (1 - sa) + 1e-5)) / outA) * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((((sbP + db * da * (1 - sa) + 1e-5)) / outA) * 255)));
                out[dIdx + 3] = Math.max(0, Math.min(255, Math.floor((outA * 255) + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "dest-over") {
              const outA = da + sa * (1 - da);
              if (outA > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((((dr * da + srP * (1 - da) + 1e-5)) / outA) * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((((dg * da + sgP * (1 - da) + 1e-5)) / outA) * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((((db * da + sbP * (1 - da) + 1e-5)) / outA) * 255)));
                out[dIdx + 3] = Math.max(0, Math.min(255, Math.floor((outA * 255) + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "in") {
              const outA = sa * da;
              if (outA > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((sr * 255) + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((sg * 255) + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((sb * 255) + 1e-5)));
                out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "out") {
              const outA = sa * (1 - da);
              if (outA > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((sr * 255) + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((sg * 255) + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((sb * 255) + 1e-5)));
                out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "dest-in") {
              const outA = da * sa;
              if (outA > 0) {
                out[dIdx] = dstBuf[dIdx]!;
                out[dIdx + 1] = dstBuf[dIdx + 1]!;
                out[dIdx + 2] = dstBuf[dIdx + 2]!;
                out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "dest-out") {
              const outA = da * (1 - sa);
              if (outA > 0) {
                out[dIdx] = Math.floor((dr * 255) + 1e-5);
                out[dIdx + 1] = Math.floor((dg * 255) + 1e-5);
                out[dIdx + 2] = Math.floor((db * 255) + 1e-5);
                out[dIdx + 3] = Math.floor((outA + 1e-5) * 255);
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
                out[dIdx + 3] = 0;
              }
              continue;
            }
            if (blend === "atop") {
              const outA = da;
              if (outA > 0) {
                const cr = (srP + dr * da * (1 - sa)) / outA;
                const cg = (sgP + dg * da * (1 - sa)) / outA;
                const cb = (sbP + db * da * (1 - sa)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              continue;
            }
            if (blend === "dest-atop") {
              const outA = sa;
              if (outA > 0) {
                const cr = (dr * da + srP * (1 - da)) / outA;
                const cg = (dg * da + sgP * (1 - da)) / outA;
                const cb = (db * da + sbP * (1 - da)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              continue;
            }
            if (blend === "xor") {
              const outA = sa * (1 - da) + da * (1 - sa);
              if (outA > 0) {
                const cr = (srP * (1 - da) + dr * da * (1 - sa)) / outA;
                const cg = (sgP * (1 - da) + dg * da * (1 - sa)) / outA;
                const cb = (sbP * (1 - da) + db * da * (1 - sa)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.floor((cr * 255) + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor((cg * 255) + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor((cb * 255) + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.floor((outA * 255) + 1e-5);
              continue;
            }
            if (blend === "saturate") {
              const outA = Math.min(1, sa + da);
              if (outA > 0) {
                const f = Math.min(sa, 1 - da);
                const cr = (srP * f + dr * da) / outA;
                const cg = (sgP * f + dg * da) / outA;
                const cb = (sbP * f + db * da) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.floor(cr * 255 + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(cg * 255 + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(cb * 255 + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.floor(outA * 255 + 1e-5);
              continue;
            }
            if (blend === "add") {
              const outA = Math.min(1, sa + da);
              if (outA > 0) {
                const cr = (srP + dr * da) / outA;
                const cg = (sgP + dg * da) / outA;
                const cb = (sbP + db * da) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.floor(cr * 255 + 1e-5)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.floor(cg * 255 + 1e-5)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.floor(cb * 255 + 1e-5)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.floor(outA * 255 + 1e-5);
              continue;
            }

            // Standard W3C separable blend over destination
            const outA = sa + da * (1 - sa);
            if (outA <= 0) {
              out[dIdx] = 0;
              out[dIdx + 1] = 0;
              out[dIdx + 2] = 0;
              out[dIdx + 3] = 0;
            } else {
              const srP = sr * sa;
              const sgP = sg * sa;
              const sbP = sb * sa;
              const drP = dr * da;
              const dgP = dg * da;
              const dbP = db * da;
              const br = blendChannel(srP, drP, blend);
              const bg = blendChannel(sgP, dgP, blend);
              const bb = blendChannel(sbP, dbP, blend);
              const cr = ((1 - da) * srP + (1 - sa) * drP + sa * da * br) / outA;
              const cg = ((1 - da) * sgP + (1 - sa) * dgP + sa * da * bg) / outA;
              const cb = ((1 - da) * sbP + (1 - sa) * dbP + sa * da * bb) / outA;
              out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
              out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
              out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(outA * 255)));
            }
          }
        }
      }
    }
  }

  return {
    ...base,
    data: out,
    hasAlpha: true,
    channels: base.channels < 3 ? 2 : 4
  };
}

export function *booleanImageSteps(
  img: RgbaImage,
  operand: RgbaImage,
  op: "and" | "or" | "eor"
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.channels !== operand.channels && img.channels !== 1 && operand.channels !== 1) {
    throw new Error(`boolean: not one band or ${operand.channels} bands`);
  }
  const out = new Uint8Array(img.data.length);
  const w = img.width;
  const h = img.height;
  const opW = operand.width;
  const opH = operand.height;
  const outChannels = Math.max(img.channels, operand.channels) as 1 | 2 | 3 | 4;
  const hasAlpha = outChannels === 4 || outChannels === 2;
  for (let y = 0; y < h; y++) {
    if (++work % 16384 === 0) yield;
    const oy = Math.min(opH - 1, y);
    for (let x = 0; x < w; x++) {
    if (++work % 16384 === 0) yield;
      const ox = Math.min(opW - 1, x);
      const idx = (y * w + x) * 4;
      const oIdx = (oy * opW + ox) * 4;
      for (let c = 0; c < 4; c++) {
    if (++work % 16384 === 0) yield;
        const a = img.channels === 1 ? img.data[idx]! : img.data[idx + c]!;
        const b = operand.channels === 1 ? operand.data[oIdx]! : operand.data[oIdx + c]!;
        out[idx + c] = op === "and" ? a & b : op === "or" ? a | b : a ^ b;
      }
      if (!hasAlpha) {
        out[idx + 3] = 255;
      }
    }
  }
  return {
    ...img,
    data: out,
    hasAlpha,
    channels: outChannels,
    ...(outChannels >= 3 ? { space: "srgb" as const } : {})
  };
}

export function *grayscaleImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const luma = srgbToBwByte(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    out[idx] = luma;
    out[idx + 1] = luma;
    out[idx + 2] = luma;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "b-w", channels: 1 };
}

export function *flattenImageSteps(img: RgbaImage, background: RgbaColor): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  const bgG = img.channels === 2 ? background.r : background.g;
  const bgB = img.channels === 2 ? background.r : background.b;
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const a = img.data[idx + 3]! / 255;
    out[idx] = Math.floor(img.data[idx]! * a + background.r * (1 - a) + 1e-6);
    out[idx + 1] = Math.floor(img.data[idx + 1]! * a + bgG * (1 - a) + 1e-6);
    out[idx + 2] = Math.floor(img.data[idx + 2]! * a + bgB * (1 - a) + 1e-6);
    out[idx + 3] = 255;
  }
  return {
    ...img,
    data: out,
    hasAlpha: false,
    channels: img.channels === 4 ? 3 : img.channels === 2 ? 1 : img.channels
  };
}

export function *unflattenImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const r = img.data[idx]!;
    const g = img.data[idx + 1]!;
    const b = img.data[idx + 2]!;
    out[idx] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
    out[idx + 3] = r === 255 && g === 255 && b === 255 ? 0 : img.data[idx + 3]!;
  }
  return { ...img, data: out, hasAlpha: true, channels: 4 };
}

export function *negateImageSteps(img: RgbaImage, options?: { readonly alpha?: boolean }): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  const negAlpha = options?.alpha ?? false;
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    out[idx] = 255 - img.data[idx]!;
    out[idx + 1] = 255 - img.data[idx + 1]!;
    out[idx + 2] = 255 - img.data[idx + 2]!;
    out[idx + 3] = negAlpha ? 255 - img.data[idx + 3]! : img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0);
        break;
      case gn:
        h = (bn - rn) / d + 2;
        break;
      case bn:
        h = (rn - gn) / d + 4;
        break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hn = (((h % 360) + 360) % 360) / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const r = Math.max(0, Math.min(255, Math.round(hue2rgb(p, q, hn + 1 / 3) * 255)));
  const g = Math.max(0, Math.min(255, Math.round(hue2rgb(p, q, hn) * 255)));
  const b = Math.max(0, Math.min(255, Math.round(hue2rgb(p, q, hn - 1 / 3) * 255)));
  return [r, g, b];
}

export function *modulateImageSteps(
  img: RgbaImage,
  spec: {
    readonly brightness: number;
    readonly saturation: number;
    readonly hue: number;
    readonly lightness: number;
  }
): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  const hueRadOffset = (spec.hue * Math.PI) / 180;
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const [L, a, bLab] = srgbToLab(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    const C = Math.hypot(a, bLab) * spec.saturation;
    const hRad = Math.atan2(bLab, a) + hueRadOffset;
    const nL = L * spec.brightness + spec.lightness;
    const [r, g, b] = labToSrgb(nL, C * Math.cos(hRad), C * Math.sin(hRad));
    out[idx] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return {
    ...img,
    data: out,
    channels: img.hasAlpha ? 4 : 3,
    space: "srgb"
  };
}

export function *tintImageSteps(img: RgbaImage, color: RgbaColor): Generator<void, RgbaImage, void> {
  let work = 0;
  const [, ta, tb] = srgbToLab(color.r, color.g, color.b);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    if (++work % 16384 === 0) yield;
    const [L] = srgbToLab(i, i, i);
    const d = L / 100.0 - 0.5;
    const weight = 1.0 - 4.0 * d * d;
    const [ro, go, bo] = labToSrgb(L, ta * weight, tb * weight);
    lut[i * 3] = ro;
    lut[i * 3 + 1] = go;
    lut[i * 3 + 2] = bo;
  }
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const bw = srgbToBwByte(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    out[idx] = lut[bw * 3]!;
    out[idx + 1] = lut[bw * 3 + 1]!;
    out[idx + 2] = lut[bw * 3 + 2]!;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "srgb", channels: img.hasAlpha ? 4 : 3 };
}

export function *gammaImageSteps(img: RgbaImage, gamma = 2.2, gammaOut = gamma): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  const gIn = Math.max(0.1, gamma);
  const gOut = Math.max(0.1, gammaOut);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    if (++work % 16384 === 0) yield;
    const v1 = Math.min(255, Math.max(0, Math.floor(255 * Math.pow(i / 255, gIn))));
    lut[i] = Math.min(255, Math.max(0, Math.floor(255 * Math.pow(v1 / 255, 1 / gOut))));
  }
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    out[idx] = lut[img.data[idx]!]!;
    out[idx + 1] = lut[img.data[idx + 1]!]!;
    out[idx + 2] = lut[img.data[idx + 2]!]!;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function *linearImageSteps(
  img: RgbaImage,
  a: readonly number[],
  b: readonly number[]
): Generator<void, RgbaImage, void> {
  let work = 0;
  const vecLen = Math.max(a.length, b.length);
  if (vecLen > img.channels) {
    throw new Error("Band expansion using linear is unsupported");
  }
  if (vecLen !== 1 && vecLen !== img.channels && !(img.channels === 4 && vecLen === 3)) {
    throw new Error(`linear: vector must have 1 or ${img.channels} elements`);
  }
  const out = new Uint8Array(img.data.length);
  if (img.channels === 2) {
    const mulG = a[0] ?? 1;
    const offG = b[0] ?? 0;
    const applyAlpha = vecLen >= 2;
    const mulA = a[1] ?? 1;
    const offA = b[1] ?? 0;
    for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
      const idx = i * 4;
      const vg = Math.floor(img.data[idx]! * mulG + offG + 1e-6);
      const cg = vg < 0 ? 0 : vg > 255 ? 255 : vg;
      out[idx] = cg;
      out[idx + 1] = cg;
      out[idx + 2] = cg;
      if (applyAlpha) {
        const va = Math.floor(img.data[idx + 3]! * mulA + offA + 1e-6);
        out[idx + 3] = va < 0 ? 0 : va > 255 ? 255 : va;
      } else {
        out[idx + 3] = img.data[idx + 3]!;
      }
    }
    return { ...img, data: out };
  }
  const applyAlpha = a.length >= 4 || b.length >= 4;
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
    if (++work % 16384 === 0) yield;
      const mul = a[c] ?? a[0] ?? 1;
      const off = b[c] ?? b[0] ?? 0;
      const v = Math.floor(img.data[idx + c]! * mul + off + 1e-6);
      out[idx + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    if (applyAlpha) {
      const mulA = a[3] ?? 1;
      const offA = b[3] ?? 0;
      const va = Math.floor(img.data[idx + 3]! * mulA + offA + 1e-6);
      out[idx + 3] = va < 0 ? 0 : va > 255 ? 255 : va;
    } else {
      out[idx + 3] = img.data[idx + 3]!;
    }
  }
  return { ...img, data: out };
}

export function *normalizeImageSteps(
  img: RgbaImage,
  options?: { readonly lower?: number; readonly upper?: number }
): Generator<void, RgbaImage, void> {
  const numPixels=img.width*img.height;
  if (!(numPixels>0)) return img;
  const histogram=new NormalizationHistogram(numPixels);
  let work=0;
  for(let p=0;p<numPixels;p++) {
    if(++work%16384===0) yield;
    const offset=p*4;
    histogram.add(img.data[offset]!,img.data[offset+1]!,img.data[offset+2]!);
  }
  const scale=histogram.scale(options);
  if(!scale) return img;
  const out=new Uint8Array(img.data.length);
  for(let p=0;p<numPixels;p++) {
    if(++work%16384===0) yield;
    const offset=p*4;
    out.set(normalizeRgb(img.data[offset]!,img.data[offset+1]!,img.data[offset+2]!,scale),offset);
    out[offset+3]=img.data[offset+3]!;
  }
  return {...img,data:out};
}

export function *thresholdImageSteps(
  img: RgbaImage,
  value = 128,
  grayscale = true
): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    if (grayscale) {
      const luma = srgbToBwByte(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
      const bit = luma >= value ? 255 : 0;
      out[idx] = bit;
      out[idx + 1] = bit;
      out[idx + 2] = bit;
    } else {
      out[idx] = img.data[idx]! >= value ? 255 : 0;
      out[idx + 1] = img.data[idx + 1]! >= value ? 255 : 0;
      out[idx + 2] = img.data[idx + 2]! >= value ? 255 : 0;
    }
    out[idx + 3] = img.hasAlpha ? (img.data[idx + 3]! >= value ? 255 : 0) : 255;
  }
  return { ...img, data: out, ...(grayscale ? { space: "b-w" as const } : {}) };
}

export function *premultiplyRgbaImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.isPremultiplied) return img;
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const a = data[idx + 3]!;
    const af = Math.fround(a / 255.0);
    out[idx] = Math.trunc(Math.fround(data[idx]! * af));
    out[idx + 1] = Math.trunc(Math.fround(data[idx + 1]! * af));
    out[idx + 2] = Math.trunc(Math.fround(data[idx + 2]! * af));
    out[idx + 3] = a;
  }
  return { ...img, data: out, isPremultiplied: true };
}

export function *unpremultiplyRgbaImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  if (!img.isPremultiplied) return { ...img, wasPremultiplied: true };
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const a = data[idx + 3]!;
    if (a === 0) {
      out[idx] = 0;
      out[idx + 1] = 0;
      out[idx + 2] = 0;
      out[idx + 3] = 0;
    } else {
      const factor = Math.fround(255.0 / a);
      out[idx] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * data[idx]!))));
      out[idx + 1] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * data[idx + 1]!))));
      out[idx + 2] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * data[idx + 2]!))));
      out[idx + 3] = a;
    }
  }
  return { ...img, data: out, isPremultiplied: false, wasPremultiplied: true };
}

export function *blurImageSteps(
  img: RgbaImage,
  sigma = 1.5,
  minAmplitude = 0.2,
  precision: "integer" | "float" | "approximate" = "integer"
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (sigma < 0) {
    return (yield* convolveImageSteps(img, {
      width: 3,
      height: 3,
      kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      scale: 9,
      offset: 0
    }));
  }
  if (sigma < 0.2) return img;
  const twoSigmaSq = 2 * sigma * sigma;
  let rIdx = 0;
  while (rIdx < 5000 && Math.exp(-(rIdx * rIdx) / twoSigmaSq) >= minAmplitude) {
    if (++work % 16384 === 0) yield;
    rIdx++;
  }
  const radius = Math.max(1, rIdx) - 1;
  if (radius <= 0) return img;
  const size = radius * 2 + 1;
  const kernel = new Float64Array(size);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    if (++work % 16384 === 0) yield;
    const rawW = Math.exp(-(i * i) / twoSigmaSq);
    const w = precision === "float" ? rawW : Math.round(20.0 * rawW);
    kernel[i + radius] = w;
    sum += w;
  }

  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const alreadyPremultiplied = Boolean(img.isPremultiplied);
  const usePremul = alreadyPremultiplied || img.hasAlpha || img.channels === 4 || img.channels === 2;
  const src = new Uint8Array(data.length);
  if (usePremul && !alreadyPremultiplied) {
    for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
      const idx = i * 4;
      const a = data[idx + 3]!;
      const af = Math.fround(a / 255.0);
      src[idx] = Math.trunc(Math.fround(data[idx]! * af));
      src[idx + 1] = Math.trunc(Math.fround(data[idx + 1]! * af));
      src[idx + 2] = Math.trunc(Math.fround(data[idx + 2]! * af));
      src[idx + 3] = a;
    }
  } else {
    {
 const copySource = data;
 const copyTargetOffset = 0;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  src.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
  }

  if (precision !== "float") {
    let maxW = 0;
    for (let i = 0; i < size; i++) {
    if (++work % 16384 === 0) yield;
      if (kernel[i]! > maxW) maxW = kernel[i]!;
    }
    const w27 = Math.ceil(Math.log2(maxW / sum) + 1.0);
    const shift = 7 - w27;
    const scale = 1 << shift;
    const half = 1 << (shift - 1);
    const mant = new Int32Array(size);
    for (let i = 0; i < size; i++) {
    if (++work % 16384 === 0) yield;
      mant[i] = Math.round((kernel[i]! / sum) * scale);
    }
    const temp = new Uint8Array(data.length);
    const blurred = new Uint8Array(data.length);
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
          const sx = Math.max(0, Math.min(width - 1, x + k));
          const sIdx = (y * width + sx) * 4;
          const m = mant[k + radius]!;
          r += src[sIdx]! * m;
          g += src[sIdx + 1]! * m;
          b += src[sIdx + 2]! * m;
          a += src[sIdx + 3]! * m;
        }
        const dIdx = (y * width + x) * 4;
        temp[dIdx] = Math.min(255, Math.max(0, (r + half) >> shift));
        temp[dIdx + 1] = Math.min(255, Math.max(0, (g + half) >> shift));
        temp[dIdx + 2] = Math.min(255, Math.max(0, (b + half) >> shift));
        temp[dIdx + 3] = usePremul ? Math.min(255, Math.max(0, (a + half) >> shift)) : 255;
      }
    }
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
          const sy = Math.max(0, Math.min(height - 1, y + k));
          const sIdx = (sy * width + x) * 4;
          const m = mant[k + radius]!;
          r += temp[sIdx]! * m;
          g += temp[sIdx + 1]! * m;
          b += temp[sIdx + 2]! * m;
          a += temp[sIdx + 3]! * m;
        }
        const dIdx = (y * width + x) * 4;
        blurred[dIdx] = Math.min(255, Math.max(0, (r + half) >> shift));
        blurred[dIdx + 1] = Math.min(255, Math.max(0, (g + half) >> shift));
        blurred[dIdx + 2] = Math.min(255, Math.max(0, (b + half) >> shift));
        blurred[dIdx + 3] = usePremul ? Math.min(255, Math.max(0, (a + half) >> shift)) : 255;
      }
    }
    if (alreadyPremultiplied) {
      return { ...img, data: blurred };
    }
    if (usePremul) {
      for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
        const idx = i * 4;
        const a = blurred[idx + 3]!;
        if (a === 0) {
          out[idx] = 0;
          out[idx + 1] = 0;
          out[idx + 2] = 0;
          out[idx + 3] = 0;
        } else {
          const factor = Math.fround(255.0 / a);
          out[idx] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * blurred[idx]!))));
          out[idx + 1] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * blurred[idx + 1]!))));
          out[idx + 2] = Math.min(255, Math.max(0, Math.trunc(Math.fround(factor * blurred[idx + 2]!))));
          out[idx + 3] = a;
        }
      }
    } else {
      {
 const copySource = blurred;
 const copyTargetOffset = 0;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  out.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
    }
    return { ...img, data: out };
  }

  for (let i = 0; i < size; i++) { if (++work % 16384 === 0) yield; kernel[i]! /= sum; }
  const temp = new Float32Array(data.length);

  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
        const sx = Math.max(0, Math.min(width - 1, x + k));
        const sIdx = (y * width + sx) * 4;
        const w = kernel[k + radius]!;
        r += src[sIdx]! * w;
        g += src[sIdx + 1]! * w;
        b += src[sIdx + 2]! * w;
        a += src[sIdx + 3]! * w;
      }
      const dIdx = (y * width + x) * 4;
      temp[dIdx] = Math.fround(r);
      temp[dIdx + 1] = Math.fround(g);
      temp[dIdx + 2] = Math.fround(b);
      temp[dIdx + 3] = Math.fround(a);
    }
  }

  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(height - 1, y + k));
        const sIdx = (sy * width + x) * 4;
        const w = kernel[k + radius]!;
        r += temp[sIdx]! * w;
        g += temp[sIdx + 1]! * w;
        b += temp[sIdx + 2]! * w;
        a += temp[sIdx + 3]! * w;
      }
      const dIdx = (y * width + x) * 4;
      const fR = Math.fround(r);
      const fG = Math.fround(g);
      const fB = Math.fround(b);
      const fA = Math.fround(a);
      if (alreadyPremultiplied) {
        out[dIdx] = Math.max(0, Math.min(255, Math.trunc(fR)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.trunc(fG)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.trunc(fB)));
        out[dIdx + 3] = Math.max(0, Math.min(255, Math.trunc(fA)));
      } else if (usePremul) {
        if (fA === 0) {
          out[dIdx] = 0;
          out[dIdx + 1] = 0;
          out[dIdx + 2] = 0;
          out[dIdx + 3] = 0;
        } else {
          const factor = Math.fround(255.0 / fA);
          out[dIdx] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * fR))));
          out[dIdx + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * fG))));
          out[dIdx + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * fB))));
          out[dIdx + 3] = Math.max(0, Math.min(255, Math.trunc(fA)));
        }
      } else {
        out[dIdx] = Math.max(0, Math.min(255, Math.trunc(fR)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.trunc(fG)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.trunc(fB)));
        out[dIdx + 3] = 255;
      }
    }
  }
  return { ...img, data: out };
}

function rintEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - r) === 0.5) return r % 2 === 0 ? r : r - 1;
  return r;
}

function buildVipsGaussmat(
  sigma: number,
  minAmpl = 0.1
): { readonly radius: number; readonly weights: Float64Array; readonly scale: number } {
  const sig2 = 2.0 * sigma * sigma;
  const maxX = Math.max(Math.min(Math.floor(Math.sqrt(-sig2 * Math.log(minAmpl))), 5000), 1);
  const size = maxX * 2 + 1;
  const weights = new Float64Array(size);
  let scale = 0;
  for (let i = 0; i < size; i++) {
    const x = i - maxX;
    const v = rintEven(20.0 * Math.exp(-(x * x) / sig2));
    weights[i] = v;
    scale += v;
  }
  return { radius: maxX, weights, scale };
}

const SHARPEN_LAB_OUT = new Float64Array(3);
const SHARPEN_RGB_OUT = new Uint8Array(3);

function vipsSrgbToLabForSharpenInto(r: number, g: number, b: number, out: Float64Array): void {
  const rl = SRGB_TO_LINEAR_LUT[r]!;
  const gl = SRGB_TO_LINEAR_LUT[g]!;
  const bl = SRGB_TO_LINEAR_LUT[b]!;
  const X = (41.24 * rl + 35.76 * gl + 18.05 * bl) / 95.047;
  const Y = (21.26 * rl + 71.52 * gl + 7.22 * bl) / 100.0;
  const Z = (1.93 * rl + 11.92 * gl + 95.05 * bl) / 108.883;
  const fx = X > 0.008856 ? Math.cbrt(X) : 7.787 * X + 16.0 / 116.0;
  const fy = Y > 0.008856 ? Math.cbrt(Y) : 7.787 * Y + 16.0 / 116.0;
  const fz = Z > 0.008856 ? Math.cbrt(Z) : 7.787 * Z + 16.0 / 116.0;
  out[0] = Math.fround(116.0 * fy - 16.0);
  out[1] = Math.fround(500.0 * (fx - fy));
  out[2] = Math.fround(200.0 * (fy - fz));
}

function vipsLabToSrgbForSharpenInto(L: number, a: number, b: number, out: Uint8Array): void {
  const fy = (L + 16.0) / 116.0;
  const fx = fy + a / 500.0;
  const fz = fy - b / 200.0;
  const X = (fx > 0.20689655172413793 ? fx * fx * fx : (fx - 16.0 / 116.0) / 7.787) * 0.95047;
  const Y = (fy > 0.20689655172413793 ? fy * fy * fy : (fy - 16.0 / 116.0) / 7.787) * 1.0;
  const Z = (fz > 0.20689655172413793 ? fz * fz * fz : (fz - 16.0 / 116.0) / 7.787) * 1.08883;
  const rl = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const gl = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  out[0] = linearToSrgbByte(rl);
  out[1] = linearToSrgbByte(gl);
  out[2] = linearToSrgbByte(bl);
}

export function *sharpenImageSteps(
  img: RgbaImage,
  sigma = 1.0,
  m1 = 1.0,
  m2 = 2.0,
  x1 = 2.0,
  y2 = 10.0,
  y3 = 20.0
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (sigma < 0) {
    return (yield* convolveImageSteps(img, {
      width: 3,
      height: 3,
      kernel: [-1, -1, -1, -1, 32, -1, -1, -1, -1],
      scale: 24,
      offset: 0
    }));
  }
  const { width, height, data } = img;
  const alreadyPremultiplied = Boolean(img.isPremultiplied);
  let hasSemiTransparentAlpha = false;
  if (!alreadyPremultiplied && (img.hasAlpha || img.channels === 4 || img.channels === 2)) {
    for (let i = 3; i < data.length; i += 4) {
    if (++work % 16384 === 0) yield;
      if (data[i]! < 255) {
        hasSemiTransparentAlpha = true;
        break;
      }
    }
  }
  let cur = data;
  if (hasSemiTransparentAlpha) {
    const pre = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i += 4) {
    if (++work % 16384 === 0) yield;
      const a = data[i + 3]!;
      const af = Math.fround(a / 255.0);
      pre[i] = Math.max(0, Math.min(255, Math.trunc(Math.fround(data[i]! * af))));
      pre[i + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(data[i + 1]! * af))));
      pre[i + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(data[i + 2]! * af))));
      pre[i + 3] = a;
    }
    cur = pre;
  }

  const Ls = new Int16Array(width * height);
  const As = new Int16Array(width * height);
  const Bs = new Int16Array(width * height);
  for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    vipsSrgbToLabForSharpenInto(cur[idx]!, cur[idx + 1]!, cur[idx + 2]!, SHARPEN_LAB_OUT);
    Ls[i] = Math.trunc(SHARPEN_LAB_OUT[0]! * 327.67);
    As[i] = Math.trunc(SHARPEN_LAB_OUT[1]! * 256.0);
    Bs[i] = Math.trunc(SHARPEN_LAB_OUT[2]! * 256.0);
  }

  const { radius, weights, scale } = buildVipsGaussmat(sigma, 0.1);
  const roundAdd = Math.trunc(scale) >> 1;
  const tmpL = new Int16Array(width * height);
  const blurL = new Int16Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (++work % 16384 === 0) yield;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += Ls[rowOff + Math.max(0, Math.min(width - 1, x + k))]! * weights[k + radius]!;
      }
      tmpL[rowOff + x] = Math.floor((sum + roundAdd) / scale);
    }
  }
  for (let y = 0; y < height; y++) {
    const rowOff = y * width;
    for (let x = 0; x < width; x++) {
      if (++work % 16384 === 0) yield;
      let sum = 0;
      for (let k = -radius; k <= radius; k++) {
        sum += tmpL[Math.max(0, Math.min(height - 1, y + k)) * width + x]! * weights[k + radius]!;
      }
      blurL[rowOff + x] = Math.floor((sum + roundAdd) / scale);
    }
  }

  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < width * height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const diffIdx = Ls[i]! - blurL[i]!;
    const d5 = diffIdx / 327.67;
    let v: number;
    if (d5 < -x1) v = (d5 + x1) * m2 - x1 * m1;
    else if (d5 < x1) v = d5 * m1;
    else v = (d5 - x1) * m2 + x1 * m1;
    if (v < -y3) v = -y3;
    if (v > y2) v = y2;
    const boostS = rintEven(v * 327.67);
    const newLS = Math.max(0, Math.min(32767, Ls[i]! + boostS));
    vipsLabToSrgbForSharpenInto(newLS / 327.67, As[i]! / 256.0, Bs[i]! / 256.0, SHARPEN_RGB_OUT);
    const nr = SHARPEN_RGB_OUT[0]!;
    const ng = SHARPEN_RGB_OUT[1]!;
    const nb = SHARPEN_RGB_OUT[2]!;
    if (hasSemiTransparentAlpha && !alreadyPremultiplied) {
      const a = cur[idx + 3]!;
      const factor = a === 0 ? 0 : Math.fround(255.0 / a);
      out[idx] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * nr))));
      out[idx + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * ng))));
      out[idx + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * nb))));
      out[idx + 3] = a;
    } else {
      out[idx] = nr;
      out[idx + 1] = ng;
      out[idx + 2] = nb;
      out[idx + 3] = cur[idx + 3]!;
    }
  }
  return { ...img, data: out };
}

export function *medianImageSteps(img: RgbaImage, size = 3): Generator<void, RgbaImage, void> {
  let work = 0;
  const radius = Math.max(1, Math.floor(size / 2));
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const histogram=new PixelMedian();

  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      histogram.clear();
      for (let ky = -radius; ky <= radius; ky++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(height - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
    if (++work % 16384 === 0) yield;
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const sIdx = (sy * width + sx) * 4;
          histogram.add(data[sIdx]!,data[sIdx+1]!,data[sIdx+2]!,data[sIdx+3]!);
        }
      }
      const pixel=histogram.pixel(),dIdx=(y*width+x)*4;
      out[dIdx]=pixel&255;out[dIdx+1]=pixel>>>8&255;out[dIdx+2]=pixel>>>16&255;out[dIdx+3]=pixel>>>24;
    }
  }
  return { ...img, data: out };
}

export function *convolveImageSteps(
  img: RgbaImage,
  spec: {
    readonly width: number;
    readonly height: number;
    readonly kernel: readonly number[];
    readonly scale: number;
    readonly offset: number;
  }
): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const kw = spec.width;
  const kh = spec.height;
  const rx = Math.floor(kw / 2);
  const ry = Math.floor(kh / 2);
  const out=new Uint8Array(data.length),accumulator=new ConvolutionPixel(img,spec.scale,spec.offset);

  for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
      accumulator.clear();
      for (let ky = 0; ky < kh; ky++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(height - 1, y + ky - ry));
        for (let kx = 0; kx < kw; kx++) {
    if (++work % 16384 === 0) yield;
          const sx = Math.max(0, Math.min(width - 1, x + kx - rx));
          const w = spec.kernel[ky * kw + kx] ?? 0;
          const sIdx = (sy * width + sx) * 4;
          accumulator.add(data[sIdx]!,data[sIdx+1]!,data[sIdx+2]!,data[sIdx+3]!,w);
        }
      }
      const dIdx = (y * width + x) * 4;
      const pixel=accumulator.pixel(data[dIdx+3]!);
      out[dIdx]=pixel&255;out[dIdx+1]=pixel>>>8&255;out[dIdx+2]=pixel>>>16&255;out[dIdx+3]=pixel>>>24;
    }
  }
  return { ...img, data: out };
}

export function *ensureAlphaImageSteps(img: RgbaImage, alpha = 1): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.hasAlpha) return img;
  const aByte = alpha <= 1 ? Math.floor(alpha * 255) : Math.floor(alpha);
  const out = new Uint8Array(img.data);
  for (let i = 3; i < out.length; i += 4) {
    if (++work % 16384 === 0) yield;
    out[i] = aByte;
  }
  return { ...img, data: out, hasAlpha: true, channels: 4 };
}

export function *removeAlphaImageSteps(img: RgbaImage): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data);
  for (let i = 3; i < out.length; i += 4) {
    if (++work % 16384 === 0) yield;
    out[i] = 255;
  }
  return {
    ...img,
    data: out,
    hasAlpha: false,
    channels: img.channels === 4 ? 3 : img.channels === 2 ? 1 : img.channels
  };
}

export function *extractChannelImageSteps(img: RgbaImage, channel: 0 | 1 | 2 | 3): Generator<void, RgbaImage, void> {
  let work = 0;
  const maxChannel = img.hasAlpha ? 3 : 2;
  if (channel > maxChannel) {
    throw new Error(`Cannot extract channel ${channel} from image with channels 0-${maxChannel}`);
  }
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const v = img.data[idx + channel]!;
    out[idx] = v;
    out[idx + 1] = v;
    out[idx + 2] = v;
    out[idx + 3] = 255;
  }
  return { ...img, data: out, space: "b-w", channels: 1, hasAlpha: false };
}

function clamp(n: number): number {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function clampFloor(n: number): number {
  return Math.max(0, Math.min(255, Math.floor(n)));
}

export function *recombImageSteps(
  img: RgbaImage,
  matrix: readonly (readonly number[])[]
): Generator<void, RgbaImage, void> {
  let work = 0;
  const is4x4 = matrix.length >= 4 && (matrix[0]?.length ?? 0) >= 4;
  if (is4x4 && !img.hasAlpha) {
    throw new Error("recomb: bands in must equal matrix width");
  }
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const r = img.data[idx]!;
    const g = img.data[idx + 1]!;
    const b = img.data[idx + 2]!;
    const a = img.data[idx + 3]!;
    const rRow = matrix[0] ?? [1, 0, 0, 0];
    const gRow = matrix[1] ?? [0, 1, 0, 0];
    const bRow = matrix[2] ?? [0, 0, 1, 0];
    out[idx] = clampFloor(
      r * (rRow[0] ?? 0) + g * (rRow[1] ?? 0) + b * (rRow[2] ?? 0) + (is4x4 ? a * (rRow[3] ?? 0) : 0)
    );
    out[idx + 1] = clampFloor(
      r * (gRow[0] ?? 0) + g * (gRow[1] ?? 0) + b * (gRow[2] ?? 0) + (is4x4 ? a * (gRow[3] ?? 0) : 0)
    );
    out[idx + 2] = clampFloor(
      r * (bRow[0] ?? 0) + g * (bRow[1] ?? 0) + b * (bRow[2] ?? 0) + (is4x4 ? a * (bRow[3] ?? 0) : 0)
    );
    if (is4x4 && matrix[3]) {
      const aRow = matrix[3]!;
      out[idx + 3] = clampFloor(
        r * (aRow[0] ?? 0) + g * (aRow[1] ?? 0) + b * (aRow[2] ?? 0) + a * (aRow[3] ?? 1)
      );
    } else {
      out[idx + 3] = a;
    }
  }
  return {
    ...img,
    data: out,
    channels: img.hasAlpha ? 4 : 3,
    space: "srgb"
  };
}

export function *toColorspaceImageSteps(img: RgbaImage, space: ColorSpace): Generator<void, RgbaImage, void> {
  if (space === "b-w") {
    return (yield* grayscaleImageSteps(img));
  }
  if (space === "grey16") {
    const g = (yield* grayscaleImageSteps(img));
    return {
      ...g,
      space: "grey16",
      depth: "ushort",
      channels: img.hasAlpha ? 2 : 1
    };
  }
  if (space === "rgb16") {
    return {
      ...img,
      space: "rgb16",
      depth: "ushort",
      channels: img.hasAlpha ? 4 : 3
    };
  }
  return {
    ...img,
    space,
    channels: img.hasAlpha ? 4 : 3
  };
}

export function *bandboolImageSteps(img: RgbaImage, op: "and" | "or" | "eor"): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data.length);
  const chCount = img.channels;
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    let acc = img.data[idx]!;
    for (let c = 1; c < chCount; c++) {
    if (++work % 16384 === 0) yield;
      const v = img.data[idx + c]!;
      if (op === "and") acc &= v;
      else if (op === "or") acc |= v;
      else acc ^= v;
    }
    out[idx] = acc;
    out[idx + 1] = acc;
    out[idx + 2] = acc;
    out[idx + 3] = 255;
  }
  const outChannels = img.channels === 1 ? 1 : 3;
  return {
    ...img,
    data: out,
    space: outChannels === 1 ? "b-w" : "srgb",
    channels: outChannels,
    hasAlpha: false
  };
}

export function *joinChannelImageSteps(img: RgbaImage, extraImages: readonly RgbaImage[]): Generator<void, RgbaImage, void> {
  let work = 0;
  const out = new Uint8Array(img.data);
  const firstExtra = extraImages[0];
  if (!firstExtra) return img;
  if (img.channels === 1 && extraImages.length >= 2) {
    const gImg = extraImages[0]!;
    const bImg = extraImages[1]!;
    const aImg = extraImages[2];
    for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
      out[i * 4 + 1] = gImg.data[i * 4] ?? 0;
      out[i * 4 + 2] = bImg.data[i * 4] ?? 0;
      out[i * 4 + 3] = aImg ? (aImg.data[i * 4] ?? 255) : 255;
    }
    return {
      ...img,
      data: out,
      space: "srgb",
      channels: aImg ? 4 : 3,
      hasAlpha: Boolean(aImg)
    };
  }
  if (img.channels === 2) {
    const bImg = extraImages[0]!;
    const aImg = extraImages[1];
    for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
      out[i * 4 + 1] = img.data[i * 4 + 3] ?? 0;
      out[i * 4 + 2] = bImg.data[i * 4] ?? 0;
      out[i * 4 + 3] = aImg ? (aImg.data[i * 4] ?? 255) : 255;
    }
    return {
      ...img,
      data: out,
      space: "srgb",
      channels: aImg ? 4 : 3,
      hasAlpha: Boolean(aImg)
    };
  }
  for (let i = 0; i < img.width * img.height; i++) {
    if (++work % 16384 === 0) yield;
    out[i * 4 + 3] = firstExtra.data[i * 4] ?? 255;
  }
  return {
    ...img,
    data: out,
    channels: img.channels === 1 ? 2 : 4,
    hasAlpha: true
  };
}

export function *claheImageSteps(
  img: RgbaImage,
  options: { readonly width: number; readonly height: number; readonly maxSlope: number }
): Generator<void, RgbaImage, void> {
  let work = 0;
  const { width, height, data } = img;
  const out = new Uint8Array(data);
  const winW = Math.max(1, options.width || 8);
  const winH = Math.max(1, options.height || 8);
  const maxSlope = options.maxSlope !== undefined ? Math.max(0, options.maxSlope) : 3;
  const halfW = Math.floor(winW / 2);
  const halfH = Math.floor(winH / 2);
  const nPixels = winW * winH;
  const threshold = maxSlope;
  const activeChannels =
    img.channels === 1
      ? [0]
      : img.channels === 2 || (img.space === "b-w" && img.channels > 1)
        ? [0, 3]
        : img.channels === 4
          ? [0, 1, 2, 3]
          : [0, 1, 2];

  const mirrorCoord = (c: number, max: number): number => {
    if (max <= 1) return 0;
    const period = max * 2;
    const m = ((c % period) + period) % period;
    return m < max ? m : period - 1 - m;
  };

  const syTable = new Int32Array(winH);
  const sxTable = new Int32Array(width + winW);
  for (let i = 0; i < width + winW; i++) {
    if (++work % 16384 === 0) yield;
    sxTable[i] = mirrorCoord(i - halfW, width);
  }

  const hist = new Int32Array(256);
  for (const ch of activeChannels) {
    if (++work % 16384 === 0) yield;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      for (let dy = 0; dy < winH; dy++) {
    if (++work % 16384 === 0) yield;
        syTable[dy] = mirrorCoord(y + dy - halfH, height) * width * 4 + ch;
      }
      hist.fill(0);
      for (let dy = 0; dy < winH; dy++) {
    if (++work % 16384 === 0) yield;
        const rowBase = syTable[dy]!;
        for (let dx = 0; dx < winW; dx++) {
    if (++work % 16384 === 0) yield;
          hist[data[rowBase + sxTable[dx]! * 4]!]!++;
        }
      }
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const pIdx = (y * width + x) * 4;
        const target = data[pIdx + ch]!;
        let sum = 0;
        if (maxSlope > 0) {
          let clipLe = 0;
          let totalClipped = 0;
          for (let i = 0; i < 256; i++) {
    if (++work % 16384 === 0) yield;
            const h = hist[i]!;
            if (h > threshold) {
              totalClipped += h - threshold;
              if (i <= target) clipLe += threshold;
            } else if (i <= target) {
              clipLe += h;
            }
          }
          sum = clipLe + Math.floor((totalClipped * (target + 1)) / 256);
        } else {
          for (let i = 0; i <= target; i++) { if (++work % 16384 === 0) yield; sum += hist[i]!; }
        }
        const outVal = Math.max(0, Math.min(255, Math.floor((255 * sum) / nPixels)));
        if (ch === 0 && (img.channels <= 2 || img.space === "b-w")) {
          out[pIdx] = outVal;
          out[pIdx + 1] = outVal;
          out[pIdx + 2] = outVal;
        } else {
          out[pIdx + ch] = outVal;
        }
        if (x + 1 < width) {
          const sxOut = sxTable[x]! * 4;
          const sxIn = sxTable[x + winW]! * 4;
          for (let dy = 0; dy < winH; dy++) {
    if (++work % 16384 === 0) yield;
            const rowBase = syTable[dy]!;
            hist[data[rowBase + sxOut]!]!--;
            hist[data[rowBase + sxIn]!]!++;
          }
        }
      }
    }
  }
  return { ...img, data: out };
}

export function *affineImageSteps(
  img: RgbaImage,
  spec: {
    readonly matrix: readonly [number, number, number, number];
    readonly background: RgbaColor;
    readonly idx?: number;
    readonly idy?: number;
    readonly odx?: number;
    readonly ody?: number;
    readonly interpolator?: string;
  }
): Generator<void, RgbaImage, void> {
  let work = 0;
  const [a, b, c, d] = spec.matrix;
  const idx = spec.idx ?? 0;
  const idy = spec.idy ?? 0;
  const odx = spec.odx ?? 0;
  const ody = spec.ody ?? 0;
  const det = a * d - b * c;
  if (Math.abs(det) < 1e-8) return img;
  const corners: Array<[number, number]> = [
    [0, 0],
    [img.width, 0],
    [0, img.height],
    [img.width, img.height]
  ];
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [cx, cy] of corners) {
    if (++work % 16384 === 0) yield;
    const x = a * cx + b * cy;
    const y = c * cx + d * cy;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const dstW = Math.max(1, Math.round(maxX - minX));
  const dstH = Math.max(1, Math.round(maxY - minY));
  const iMinX = Math.round(minX);
  const iMinY = Math.round(minY);
  const out = new Uint8Array(new ArrayBuffer(dstW * dstH * 4 + dstH), 0, dstW * dstH * 4);
  const samplePremul = (ix: number, iy: number): [number, number, number, number] => {
    if (ix < 0 || ix >= img.width || iy < 0 || iy >= img.height) {
      const ba = spec.background.a;
      return [(spec.background.r * ba) / 255, (spec.background.g * ba) / 255, (spec.background.b * ba) / 255, ba];
    }
    const sIdx = (iy * img.width + ix) * 4;
    const sa = img.data[sIdx + 3]!;
    return [(img.data[sIdx]! * sa) / 255, (img.data[sIdx + 1]! * sa) / 255, (img.data[sIdx + 2]! * sa) / 255, sa];
  };

  for (let y = 0; y < dstH; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < dstW; x++) {
    if (++work % 16384 === 0) yield;
      const ox = x + iMinX - odx;
      const oy = y + iMinY - ody;
      const sx = (d * ox - b * oy) / det - idx;
      const sy = (-c * ox + a * oy) / det - idy;
      const dIdx = (y * dstW + x) * 4;
      if (sx <= -1 || sx >= img.width || sy <= -1 || sy >= img.height) {
        const ba = spec.background.a;
        if (ba > 0) {
          const factor = Math.fround(255.0 / ba);
          out[dIdx] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * spec.background.r))));
          out[dIdx + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * spec.background.g))));
          out[dIdx + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * spec.background.b))));
          out[dIdx + 3] = ba;
        }
      } else if (spec.interpolator === "nearest") {
        const p = samplePremul(Math.floor(sx), Math.floor(sy));
        const pa = p[3];
        const outA = Math.max(0, Math.min(255, Math.round(pa)));
        out[dIdx] = pa > 0 ? Math.max(0, Math.min(255, Math.round((p[0] * 255) / pa))) : 0;
        out[dIdx + 1] = pa > 0 ? Math.max(0, Math.min(255, Math.round((p[1] * 255) / pa))) : 0;
        out[dIdx + 2] = pa > 0 ? Math.max(0, Math.min(255, Math.round((p[2] * 255) / pa))) : 0;
        out[dIdx + 3] = outA;
      } else if (spec.interpolator === "bicubic") {
        const catmull = (v: number): number => {
          const av = Math.abs(v);
          if (av < 1) return 1.5 * av * av * av - 2.5 * av * av + 1;
          if (av < 2) return -0.5 * av * av * av + 2.5 * av * av - 4 * av + 2;
          return 0;
        };
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        let pr = 0;
        let pg = 0;
        let pb = 0;
        let pa = 0;
        for (let ky = -1; ky <= 2; ky++) {
    if (++work % 16384 === 0) yield;
          const wy = catmull(sy - (y0 + ky));
          for (let kx = -1; kx <= 2; kx++) {
    if (++work % 16384 === 0) yield;
            const w = wy * catmull(sx - (x0 + kx));
            const p = samplePremul(x0 + kx, y0 + ky);
            pr += p[0] * w;
            pg += p[1] * w;
            pb += p[2] * w;
            pa += p[3] * w;
          }
        }
        const outA = Math.max(0, Math.min(255, Math.round(pa)));
        out[dIdx] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pr * 255) / pa))) : 0;
        out[dIdx + 1] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pg * 255) / pa))) : 0;
        out[dIdx + 2] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pb * 255) / pa))) : 0;
        out[dIdx + 3] = outA;
      } else {
        const x0 = Math.floor(sx);
        const y0 = Math.floor(sy);
        const fx = sx - x0;
        const fy = sy - y0;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const p00 = samplePremul(x0, y0);
        const p10 = samplePremul(x0 + 1, y0);
        const p01 = samplePremul(x0, y0 + 1);
        const p11 = samplePremul(x0 + 1, y0 + 1);
        const pa = p00[3] * w00 + p10[3] * w10 + p01[3] * w01 + p11[3] * w11;
        const pr = p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11;
        const pg = p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11;
        const pb = p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11;
        const outA = Math.max(0, Math.min(255, Math.round(pa)));
        out[dIdx] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pr * 255) / pa))) : 0;
        out[dIdx + 1] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pg * 255) / pa))) : 0;
        out[dIdx + 2] = pa > 0 ? Math.max(0, Math.min(255, Math.round((pb * 255) / pa))) : 0;
        out[dIdx + 3] = outA;
      }
    }
  }
  const hasAlpha = img.hasAlpha || spec.background.a < 255;
  return {
    ...img,
    width: dstW,
    height: dstH,
    data: out,
    hasAlpha,
    channels: hasAlpha ? (img.channels < 3 ? 2 : 4) : img.channels
  };
}

export function *computeImageStatsSteps(img: RgbaImage): Generator<void, ImageStats, void> {
  let work = 0;
  const { width, height, data } = img;
  const totalPixels = Math.max(1, width * height);
  const chIndices =
    img.channels === 1
      ? [0]
      : img.channels === 2
        ? [0, 3]
        : img.hasAlpha
          ? [0, 1, 2, 3]
          : [0, 1, 2];
  const channels: ChannelStats[] = [];

  for (const c of chIndices) {
    if (++work % 16384 === 0) yield;
    let min = 255;
    let max = 0;
    let sum = 0;
    let squaresSum = 0;
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const v = data[(y * width + x) * 4 + c]!;
        sum += v;
        squaresSum += v * v;
        if (v < min) {
          min = v;
          minX = x;
          minY = y;
        }
        if (v > max) {
          max = v;
          maxX = x;
          maxY = y;
        }
      }
    }
    const mean = sum / totalPixels;
    const variance =
      totalPixels > 1
        ? Math.max(0, (squaresSum - (sum * sum) / totalPixels) / (totalPixels - 1))
        : 0;
    channels.push({
      min,
      max,
      sum,
      squaresSum,
      mean,
      stdev: Math.sqrt(variance),
      minX,
      minY,
      maxX,
      maxY
    });
  }

  let isOpaque = true;
  const hist = new Uint32Array(256);
  const bw = new Uint8Array(totalPixels);
  const colorBins = new Uint32Array(4096);
  const binSumR = new Float64Array(4096);
  const binSumG = new Float64Array(4096);
  const binSumB = new Float64Array(4096);

  for (let i = 0; i < totalPixels; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    const r = data[idx]!;
    const g = data[idx + 1]!;
    const b = data[idx + 2]!;
    const a = data[idx + 3]!;
    if (a < 255) isOpaque = false;
    const luma = img.channels <= 2 || img.space === "b-w" ? r : srgbToBwByte(r, g, b);
    bw[i] = luma;
    hist[luma]!++;
    const bin = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
    colorBins[bin]!++;
    binSumR[bin]! += r;
    binSumG[bin]! += g;
    binSumB[bin]! += b;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    if (++work % 16384 === 0) yield;
    const count = hist[i]!;
    if (count > 0) {
      const p = count / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }

  let maxBin = 0;
  let maxBinCount = 0;
  for (let i = 0; i < 4096; i++) {
    if (++work % 16384 === 0) yield;
    if (colorBins[i]! > maxBinCount) {
      maxBinCount = colorBins[i]!;
      maxBin = i;
    }
  }
  const dominant =
    maxBinCount > 0
      ? {
          r: ((maxBin >>> 8) & 0x0f) * 16 + 8,
          g: ((maxBin >>> 4) & 0x0f) * 16 + 8,
          b: (maxBin & 0x0f) * 16 + 8
        }
      : { r: 0, g: 0, b: 0 };

  let sharpness = 0;
  if ((width > 1 || height > 1) && totalPixels > 1) {
    let lapSum = 0;
    let lapSqSum = 0;
    for (let y = 0; y < height; y++) {
    if (++work % 16384 === 0) yield;
      const ym = y > 0 ? y - 1 : 0;
      const yp = y + 1 < height ? y + 1 : height - 1;
      for (let x = 0; x < width; x++) {
    if (++work % 16384 === 0) yield;
        const xm = x > 0 ? x - 1 : 0;
        const xp = x + 1 < width ? x + 1 : width - 1;
        const lap =
          (bw[ym * width + x]! +
            bw[yp * width + x]! +
            bw[y * width + xm]! +
            bw[y * width + xp]! -
            4 * bw[y * width + x]!) /
          9.0;
        lapSum += lap;
        lapSqSum += lap * lap;
      }
    }
    sharpness = Math.sqrt(
      Math.max(0, (lapSqSum - (lapSum * lapSum) / totalPixels) / (totalPixels - 1))
    );
  }

  return {
    channels,
    isOpaque,
    entropy,
    sharpness,
    dominant
  };
}


export function *dilateImageSteps(img: RgbaImage, width = 1): Generator<void, RgbaImage, void> {
  let work = 0;
  const w = img.width;
  const h = img.height;
  const radius = Math.max(1, Math.round(width));
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < h; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < w; x++) {
    if (++work % 16384 === 0) yield;
      let r = 255, g = 255, b = 255, a = 255;
      for (let dy = -radius; dy <= radius; dy++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(h - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
    if (++work % 16384 === 0) yield;
          const sx = Math.max(0, Math.min(w - 1, x + dx));
          const sIdx = (sy * w + sx) * 4;
          r &= img.data[sIdx]!;
          g &= img.data[sIdx + 1]!;
          b &= img.data[sIdx + 2]!;
          a &= img.data[sIdx + 3]!;
        }
      }
      const dIdx = (y * w + x) * 4;
      out[dIdx] = r;
      out[dIdx + 1] = g;
      out[dIdx + 2] = b;
      out[dIdx + 3] = img.hasAlpha ? a : 255;
    }
  }
  return {
    ...img,
    data: out,
    space: "srgb",
    channels: img.hasAlpha ? 4 : 3
  };
}

export function *erodeImageSteps(img: RgbaImage, width = 1): Generator<void, RgbaImage, void> {
  let work = 0;
  const w = img.width;
  const h = img.height;
  const radius = Math.max(1, Math.round(width));
  const out = new Uint8Array(img.data.length);
  for (let y = 0; y < h; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < w; x++) {
    if (++work % 16384 === 0) yield;
      let r = 0, g = 0, b = 0, a = 0;
      for (let dy = -radius; dy <= radius; dy++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(h - 1, y + dy));
        for (let dx = -radius; dx <= radius; dx++) {
    if (++work % 16384 === 0) yield;
          const sx = Math.max(0, Math.min(w - 1, x + dx));
          const sIdx = (sy * w + sx) * 4;
          r |= img.data[sIdx]!;
          g |= img.data[sIdx + 1]!;
          b |= img.data[sIdx + 2]!;
          a |= img.data[sIdx + 3]!;
        }
      }
      const dIdx = (y * w + x) * 4;
      out[dIdx] = r;
      out[dIdx + 1] = g;
      out[dIdx + 2] = b;
      out[dIdx + 3] = img.hasAlpha ? a : 255;
    }
  }
  return {
    ...img,
    data: out,
    space: "srgb",
    channels: img.hasAlpha ? 4 : 3
  };
}

export function flipImage(
  img: RgbaImage
): RgbaImage {
  const steps = flipImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function flopImage(
  img: RgbaImage
): RgbaImage {
  const steps = flopImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function applyExifOrientation(
  img: RgbaImage
): RgbaImage {
  const steps = applyExifOrientationSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function rotateImage(
  img: RgbaImage,
  angle: number,
  background: RgbaColor = { r: 0, g: 0, b: 0, a: 255 }
): RgbaImage {
  const steps = rotateImageSteps(img, angle, background);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function extractImage(
  img: RgbaImage,
  region: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
): RgbaImage {
  const steps = extractImageSteps(img, region);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function trimImage(
  img: RgbaImage,
  options?: { readonly threshold?: number; readonly background?: RgbaColor; readonly lineArt?: boolean }
): RgbaImage {
  const steps = trimImageSteps(img, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function extendImage(
  img: RgbaImage,
  spec: {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
    readonly background: RgbaColor;
    readonly extendWith: "background" | "copy" | "repeat" | "mirror";
  }
): RgbaImage {
  const steps = extendImageSteps(img, spec);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function compositeImage(
  base: RgbaImage,
  layers: readonly CompositeLayer[],
  readFile?: (path: string) => Uint8Array
): RgbaImage {
  const steps = compositeImageSteps(base, layers, readFile);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function booleanImage(
  img: RgbaImage,
  operand: RgbaImage,
  op: "and" | "or" | "eor"
): RgbaImage {
  const steps = booleanImageSteps(img, operand, op);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function grayscaleImage(
  img: RgbaImage
): RgbaImage {
  const steps = grayscaleImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function flattenImage(
  img: RgbaImage,
  background: RgbaColor
): RgbaImage {
  const steps = flattenImageSteps(img, background);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function unflattenImage(
  img: RgbaImage
): RgbaImage {
  const steps = unflattenImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function negateImage(
  img: RgbaImage,
  options?: { readonly alpha?: boolean }
): RgbaImage {
  const steps = negateImageSteps(img, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function modulateImage(
  img: RgbaImage,
  spec: {
    readonly brightness: number;
    readonly saturation: number;
    readonly hue: number;
    readonly lightness: number;
  }
): RgbaImage {
  const steps = modulateImageSteps(img, spec);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function tintImage(
  img: RgbaImage,
  color: RgbaColor
): RgbaImage {
  const steps = tintImageSteps(img, color);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function gammaImage(
  img: RgbaImage,
  gamma = 2.2,
  gammaOut = gamma
): RgbaImage {
  const steps = gammaImageSteps(img, gamma, gammaOut);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function linearImage(
  img: RgbaImage,
  a: readonly number[],
  b: readonly number[]
): RgbaImage {
  const steps = linearImageSteps(img, a, b);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function normalizeImage(
  img: RgbaImage,
  options?: { readonly lower?: number; readonly upper?: number }
): RgbaImage {
  const steps = normalizeImageSteps(img, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function thresholdImage(
  img: RgbaImage,
  value = 128,
  grayscale = true
): RgbaImage {
  const steps = thresholdImageSteps(img, value, grayscale);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function premultiplyRgbaImage(
  img: RgbaImage
): RgbaImage {
  const steps = premultiplyRgbaImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function unpremultiplyRgbaImage(
  img: RgbaImage
): RgbaImage {
  const steps = unpremultiplyRgbaImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function blurImage(
  img: RgbaImage,
  sigma = 1.5,
  minAmplitude = 0.2,
  precision: "integer" | "float" | "approximate" = "integer"
): RgbaImage {
  const steps = blurImageSteps(img, sigma, minAmplitude, precision);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function sharpenImage(
  img: RgbaImage,
  sigma = 1.0,
  m1 = 1.0,
  m2 = 2.0,
  x1 = 2.0,
  y2 = 10.0,
  y3 = 20.0
): RgbaImage {
  const steps = sharpenImageSteps(img, sigma, m1, m2, x1, y2, y3);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function medianImage(
  img: RgbaImage,
  size = 3
): RgbaImage {
  const steps = medianImageSteps(img, size);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function convolveImage(
  img: RgbaImage,
  spec: {
    readonly width: number;
    readonly height: number;
    readonly kernel: readonly number[];
    readonly scale: number;
    readonly offset: number;
  }
): RgbaImage {
  const steps = convolveImageSteps(img, spec);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function ensureAlphaImage(
  img: RgbaImage,
  alpha = 1
): RgbaImage {
  const steps = ensureAlphaImageSteps(img, alpha);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function removeAlphaImage(
  img: RgbaImage
): RgbaImage {
  const steps = removeAlphaImageSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function extractChannelImage(
  img: RgbaImage,
  channel: 0 | 1 | 2 | 3
): RgbaImage {
  const steps = extractChannelImageSteps(img, channel);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function recombImage(
  img: RgbaImage,
  matrix: readonly (readonly number[])[]
): RgbaImage {
  const steps = recombImageSteps(img, matrix);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function toColorspaceImage(
  img: RgbaImage,
  space: ColorSpace
): RgbaImage {
  const steps = toColorspaceImageSteps(img, space);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function bandboolImage(
  img: RgbaImage,
  op: "and" | "or" | "eor"
): RgbaImage {
  const steps = bandboolImageSteps(img, op);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function joinChannelImage(
  img: RgbaImage,
  extraImages: readonly RgbaImage[]
): RgbaImage {
  const steps = joinChannelImageSteps(img, extraImages);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function claheImage(
  img: RgbaImage,
  options: { readonly width: number; readonly height: number; readonly maxSlope: number }
): RgbaImage {
  const steps = claheImageSteps(img, options);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function affineImage(
  img: RgbaImage,
  spec: {
    readonly matrix: readonly [number, number, number, number];
    readonly background: RgbaColor;
    readonly idx?: number;
    readonly idy?: number;
    readonly odx?: number;
    readonly ody?: number;
    readonly interpolator?: string;
  }
): RgbaImage {
  const steps = affineImageSteps(img, spec);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function computeImageStats(
  img: RgbaImage
): ImageStats {
  const steps = computeImageStatsSteps(img);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function dilateImage(
  img: RgbaImage,
  width = 1
): RgbaImage {
  const steps = dilateImageSteps(img, width);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}

export function erodeImage(
  img: RgbaImage,
  width = 1
): RgbaImage {
  const steps = erodeImageSteps(img, width);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
