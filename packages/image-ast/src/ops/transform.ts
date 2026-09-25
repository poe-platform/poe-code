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

export function flipImage(img: RgbaImage): RgbaImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const rowBytes = width * 4;
  for (let y = 0; y < height; y++) {
    const srcOffset = y * rowBytes;
    const dstOffset = (height - 1 - y) * rowBytes;
    out.set(data.subarray(srcOffset, srcOffset + rowBytes), dstOffset);
  }
  return { ...img, data: out };
}

export function flopImage(img: RgbaImage): RgbaImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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

function rotate90CW(img: RgbaImage): RgbaImage {
  const { width, height, data } = img;
  const dstW = height;
  const dstH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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

function rotate180(img: RgbaImage): RgbaImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const total = width * height;
  for (let i = 0; i < total; i++) {
    const srcIdx = i * 4;
    const dstIdx = (total - 1 - i) * 4;
    out[dstIdx] = data[srcIdx]!;
    out[dstIdx + 1] = data[srcIdx + 1]!;
    out[dstIdx + 2] = data[srcIdx + 2]!;
    out[dstIdx + 3] = data[srcIdx + 3]!;
  }
  return { ...img, data: out };
}

function rotate270CW(img: RgbaImage): RgbaImage {
  const { width, height, data } = img;
  const dstW = height;
  const dstH = width;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
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

export function applyExifOrientation(img: RgbaImage): RgbaImage {
  const orientation = img.orientation;
  if (!orientation || orientation === 1) {
    return { ...img, orientation: 1 };
  }
  let result = img;
  switch (orientation) {
    case 2:
      result = flopImage(img);
      break;
    case 3:
      result = rotate180(img);
      break;
    case 4:
      result = flipImage(img);
      break;
    case 5:
      result = flopImage(rotate90CW(img));
      break;
    case 6:
      result = rotate90CW(img);
      break;
    case 7:
      result = flipImage(rotate90CW(img));
      break;
    case 8:
      result = rotate270CW(img);
      break;
    default:
      break;
  }
  return { ...result, orientation: 1 };
}

export function rotateImage(
  img: RgbaImage,
  angle: number,
  background: RgbaColor = { r: 0, g: 0, b: 0, a: 255 }
): RgbaImage {
  const norm = ((angle % 360) + 360) % 360;
  if (Math.abs(norm) < 1e-6) return img;
  if (Math.abs(norm - 90) < 1e-6) return rotate90CW(img);
  if (Math.abs(norm - 180) < 1e-6) return rotate180(img);
  if (Math.abs(norm - 270) < 1e-6) return rotate270CW(img);

  const rad = (norm * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const absCos = Math.abs(cos);
  const absSin = Math.abs(sin);
  const dstW = Math.max(1, Math.round(img.width * absCos + img.height * absSin));
  const dstH = Math.max(1, Math.round(img.width * absSin + img.height * absCos));
  const out = new Uint8Array(dstW * dstH * 4);

  const cxSrc = (img.width - 1) / 2;
  const cySrc = (img.height - 1) / 2;
  const cxDst = (dstW - 1) / 2;
  const cyDst = (dstH - 1) / 2;
  const samplePremul = (ix: number, iy: number): [number, number, number, number] => {
    if (ix < 0 || ix >= img.width || iy < 0 || iy >= img.height) {
      const ba = background.a;
      return [(background.r * ba) / 255, (background.g * ba) / 255, (background.b * ba) / 255, ba];
    }
    const sIdx = (iy * img.width + ix) * 4;
    const sa = img.data[sIdx + 3]!;
    return [
      (img.data[sIdx]! * sa) / 255,
      (img.data[sIdx + 1]! * sa) / 255,
      (img.data[sIdx + 2]! * sa) / 255,
      sa
    ];
  };

  for (let y = 0; y < dstH; y++) {
    const dy = y - cyDst;
    for (let x = 0; x < dstW; x++) {
      const dx = x - cxDst;
      const sx = dx * cos + dy * sin + cxSrc;
      const sy = -dx * sin + dy * cos + cySrc;
      const dIdx = (y * dstW + x) * 4;
      if (sx <= -1 || sx >= img.width || sy <= -1 || sy >= img.height) {
        if (background.a > 0) {
          out[dIdx] = background.r;
          out[dIdx + 1] = background.g;
          out[dIdx + 2] = background.b;
          out[dIdx + 3] = background.a;
        }
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
        const outA = p00[3] * w00 + p10[3] * w10 + p01[3] * w01 + p11[3] * w11;
        if (outA > 1e-6) {
          for (let c = 0; c < 3; c++) {
            const pm =
              p00[c]! * w00 +
              p10[c]! * w10 +
              p01[c]! * w01 +
              p11[c]! * w11;
            out[dIdx + c] = Math.max(0, Math.min(255, Math.round((pm * 255) / outA)));
          }
          out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(outA)));
        } else {
          out[dIdx] = 0;
          out[dIdx + 1] = 0;
          out[dIdx + 2] = 0;
          out[dIdx + 3] = 0;
        }
      }
    }
  }
  const nextHasAlpha = img.hasAlpha || background.a < 255;
  return {
    ...img,
    width: dstW,
    height: dstH,
    data: out,
    hasAlpha: nextHasAlpha,
    channels: nextHasAlpha ? (img.channels < 3 ? 2 : 4) : img.channels
  };
}

export function extractImage(
  img: RgbaImage,
  region: { readonly left: number; readonly top: number; readonly width: number; readonly height: number }
): RgbaImage {
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
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const srcStart = ((top + y) * img.width + left) * 4;
    out.set(img.data.subarray(srcStart, srcStart + width * 4), y * width * 4);
  }
  return { ...img, width, height, data: out };
}

export function trimImage(
  img: RgbaImage,
  options?: { readonly threshold?: number; readonly background?: RgbaColor }
): RgbaImage {
  const threshold = options?.threshold ?? 10;
  const ref: RgbaColor = options?.background ?? {
    r: img.data[0] ?? 0,
    g: img.data[1] ?? 0,
    b: img.data[2] ?? 0,
    a: img.data[3] ?? 255
  };
  const refAlpha = ref.a / 255;
  const refRP = ref.r * refAlpha;
  const refGP = ref.g * refAlpha;
  const refBP = ref.b * refAlpha;

  const isBg = (x: number, y: number): boolean => {
    const idx = (y * img.width + x) * 4;
    const pa = img.data[idx + 3]!;
    const pAlpha = pa / 255;
    const dr = Math.abs(img.data[idx]! * pAlpha - refRP);
    const dg = Math.abs(img.data[idx + 1]! * pAlpha - refGP);
    const db = Math.abs(img.data[idx + 2]! * pAlpha - refBP);
    const da = Math.abs(pa - ref.a);
    return dr <= threshold && dg <= threshold && db <= threshold && da <= threshold;
  };

  let top = 0;
  while (top < img.height) {
    let allBg = true;
    for (let x = 0; x < img.width; x++) {
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
      ...extractImage(img, { left: 0, top: 0, width: 1, height: 1 }),
      trimOffsetLeft: 0,
      trimOffsetTop: 0
    };
  }

  let bottom = img.height - 1;
  while (bottom > top) {
    let allBg = true;
    for (let x = 0; x < img.width; x++) {
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
    let allBg = true;
    for (let y = top; y <= bottom; y++) {
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
    let allBg = true;
    for (let y = top; y <= bottom; y++) {
      if (!isBg(right, y)) {
        allBg = false;
        break;
      }
    }
    if (!allBg) break;
    right--;
  }

  const extracted = extractImage(img, {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  });
  return {
    ...extracted,
    trimOffsetLeft: -left,
    trimOffsetTop: -top
  };
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
  const top = Math.max(0, Math.round(spec.top));
  const bottom = Math.max(0, Math.round(spec.bottom));
  const left = Math.max(0, Math.round(spec.left));
  const right = Math.max(0, Math.round(spec.right));
  const dstW = img.width + left + right;
  const dstH = img.height + top + bottom;
  const out = new Uint8Array(dstW * dstH * 4);

  const mapCoord = (c: number, size: number): number => {
    if (c >= 0 && c < size) return c;
    if (spec.extendWith === "copy") {
      return Math.max(0, Math.min(size - 1, c));
    }
    if (spec.extendWith === "repeat") {
      return ((c % size) + size) % size;
    }
    if (spec.extendWith === "mirror") {
      const period = size * 2;
      const m = ((c % period) + period) % period;
      return m < size ? m : period - 1 - m;
    }
    return -1;
  };

  for (let y = 0; y < dstH; y++) {
    const sy = mapCoord(y - top, img.height);
    for (let x = 0; x < dstW; x++) {
      const sx = mapCoord(x - left, img.width);
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
    hasAlpha: img.hasAlpha || spec.background.a < 255,
    channels:
      img.hasAlpha || spec.background.a < 255 ? (img.channels < 3 ? 2 : 4) : img.channels
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

export function compositeImage(
  base: RgbaImage,
  layers: readonly CompositeLayer[]
): RgbaImage {
  const out = new Uint8Array(base.data);
  const baseW = base.width;
  const baseH = base.height;

  for (const layer of layers) {
    let overlay: RgbaImage;
    if (typeof layer.input === "string") {
      overlay = decodeImage(
        new TextEncoder().encode(layer.input),
        layer.density !== undefined ? { density: layer.density } : undefined
      );
    } else if (layer.input instanceof Uint8Array) {
      overlay = decodeImage(layer.input, {
        ...(layer.density !== undefined ? { density: layer.density } : {}),
        ...(layer.raw !== undefined
          ? {
              raw: {
                ...layer.raw,
                ...(layer.premultiplied !== undefined ? { premultiplied: layer.premultiplied } : {})
              }
            }
          : {})
      });
      if (layer.premultiplied && !layer.raw) {
        const unpremul = new Uint8Array(overlay.data.length);
        for (let i = 0; i < overlay.width * overlay.height; i++) {
          const a = overlay.data[i * 4 + 3]!;
          if (a > 0 && a < 255) {
            const scale = 255 / a;
            unpremul[i * 4] = Math.min(255, Math.round(overlay.data[i * 4]! * scale));
            unpremul[i * 4 + 1] = Math.min(255, Math.round(overlay.data[i * 4 + 1]! * scale));
            unpremul[i * 4 + 2] = Math.min(255, Math.round(overlay.data[i * 4 + 2]! * scale));
          } else {
            unpremul[i * 4] = overlay.data[i * 4]!;
            unpremul[i * 4 + 1] = overlay.data[i * 4 + 1]!;
            unpremul[i * 4 + 2] = overlay.data[i * 4 + 2]!;
          }
          unpremul[i * 4 + 3] = a;
        }
        overlay = { ...overlay, data: unpremul };
      }
    } else {
      overlay = decodeImage(undefined, {
        create: layer.input.create,
        ...(layer.density !== undefined ? { density: layer.density } : {})
      });
    }

    const blend: BlendMode = layer.blend ?? "over";
    const grav = resolveGravityOffset(
      baseW,
      baseH,
      overlay.width,
      overlay.height,
      layer.gravity ?? "center"
    );
    const startX =
      layer.left !== undefined
        ? Math.round(layer.left)
        : layer.top !== undefined
          ? 0
          : grav.x;
    const startY =
      layer.top !== undefined
        ? Math.round(layer.top)
        : layer.left !== undefined
          ? 0
          : grav.y;

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
          const sy = dy - startY;
          const sRowOff = (sy * overlay.width + srcOffX) * 4;
          const dRowOff = (dy * baseW + copyStartX) * 4;
          out.set(overlay.data.subarray(sRowOff, sRowOff + copyW * 4), dRowOff);
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

    for (let ty = 0; ty < 1; ty++) {
      for (let tx = 0; tx < 1; tx++) {
        for (let y = yStart; y < yEnd; y++) {
          const dy = layer.tile ? y : startY + y;
          const sy = layer.tile
            ? (((dy - startY) % ovH) + ovH) % ovH
            : y;
          const syRow = sy * ovW;
          const dyRow = dy * baseW;
          for (let x = xStart; x < xEnd; x++) {
            const dx = layer.tile ? x : startX + x;
            const sx = layer.tile
              ? (((dx - startX) % ovW) + ovW) % ovW
              : x;
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
            if (isOver && daByte === 255) {
              const invSa = 255 - saByte;
              out[dIdx] = ((ovData[sIdx]! * saByte + out[dIdx]! * invSa + 128) * 257) >>> 16;
              out[dIdx + 1] = ((ovData[sIdx + 1]! * saByte + out[dIdx + 1]! * invSa + 128) * 257) >>> 16;
              out[dIdx + 2] = ((ovData[sIdx + 2]! * saByte + out[dIdx + 2]! * invSa + 128) * 257) >>> 16;
              continue;
            }

            const sr = ovData[sIdx]! * inv255;
            const sg = ovData[sIdx + 1]! * inv255;
            const sb = ovData[sIdx + 2]! * inv255;
            const sa = saByte * inv255;

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
                const srP = sr * sa;
                const sgP = sg * sa;
                const sbP = sb * sa;
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
                const rOut = ((invDa * srP + invSa * drP + saDa * br) * invOutA255 + 0.5) | 0;
                const gOut = ((invDa * sgP + invSa * dgP + saDa * bg) * invOutA255 + 0.5) | 0;
                const bOut = ((invDa * sbP + invSa * dbP + saDa * bb) * invOutA255 + 0.5) | 0;
                out[dIdx] = rOut < 0 ? 0 : rOut > 255 ? 255 : rOut;
                out[dIdx + 1] = gOut < 0 ? 0 : gOut > 255 ? 255 : gOut;
                out[dIdx + 2] = bOut < 0 ? 0 : bOut > 255 ? 255 : bOut;
                out[dIdx + 3] = daByte === 255 ? 255 : ((outA * 255 + 0.5) | 0);
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
              out[dIdx] = Math.round(sr * 255);
              out[dIdx + 1] = Math.round(sg * 255);
              out[dIdx + 2] = Math.round(sb * 255);
              out[dIdx + 3] = Math.round(sa * 255);
              continue;
            }
            if (blend === "dest") continue;
            if (blend === "over") {
              const outA = sa + da * (1 - sa);
              if (outA > 0) {
                out[dIdx] = Math.max(0, Math.min(255, Math.round(((sr * sa + dr * da * (1 - sa)) / outA) * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(((sg * sa + dg * da * (1 - sa)) / outA) * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(((sb * sa + db * da * (1 - sa)) / outA) * 255)));
                out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(outA * 255)));
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
                out[dIdx] = Math.round(((dr * da + sr * sa * (1 - da)) / outA) * 255);
                out[dIdx + 1] = Math.round(((dg * da + sg * sa * (1 - da)) / outA) * 255);
                out[dIdx + 2] = Math.round(((db * da + sb * sa * (1 - da)) / outA) * 255);
                out[dIdx + 3] = Math.round(outA * 255);
              }
              continue;
            }
            if (blend === "in") {
              const outA = sa * da;
              out[dIdx] = Math.round(sr * 255);
              out[dIdx + 1] = Math.round(sg * 255);
              out[dIdx + 2] = Math.round(sb * 255);
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "out") {
              const outA = sa * (1 - da);
              out[dIdx] = Math.round(sr * 255);
              out[dIdx + 1] = Math.round(sg * 255);
              out[dIdx + 2] = Math.round(sb * 255);
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "dest-in") {
              out[dIdx] = dstBuf[dIdx]!;
              out[dIdx + 1] = dstBuf[dIdx + 1]!;
              out[dIdx + 2] = dstBuf[dIdx + 2]!;
              out[dIdx + 3] = Math.round(da * sa * 255);
              continue;
            }
            if (blend === "dest-out") {
              out[dIdx + 3] = Math.round(da * (1 - sa) * 255);
              continue;
            }
            if (blend === "atop") {
              const outA = da;
              if (outA > 0) {
                const cr = (sr * sa + dr * da * (1 - sa)) / outA;
                const cg = (sg * sa + dg * da * (1 - sa)) / outA;
                const cb = (sb * sa + db * da * (1 - sa)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              }
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "dest-atop") {
              const outA = sa;
              if (outA > 0) {
                const cr = (dr * da + sr * sa * (1 - da)) / outA;
                const cg = (dg * da + sg * sa * (1 - da)) / outA;
                const cb = (db * da + sb * sa * (1 - da)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              }
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "xor") {
              const outA = sa * (1 - da) + da * (1 - sa);
              if (outA > 0) {
                const cr = (sr * sa * (1 - da) + dr * da * (1 - sa)) / outA;
                const cg = (sg * sa * (1 - da) + dg * da * (1 - sa)) / outA;
                const cb = (sb * sa * (1 - da) + db * da * (1 - sa)) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              } else {
                out[dIdx] = 0;
                out[dIdx + 1] = 0;
                out[dIdx + 2] = 0;
              }
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "saturate") {
              const outA = Math.min(1, sa + da);
              if (outA > 0) {
                const f = Math.min(sa, 1 - da);
                const cr = (sr * sa * f + dr * da) / outA;
                const cg = (sg * sa * f + dg * da) / outA;
                const cb = (sb * sa * f + db * da) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              }
              out[dIdx + 3] = Math.round(outA * 255);
              continue;
            }
            if (blend === "add") {
              const outA = Math.min(1, sa + da);
              if (outA > 0) {
                const cr = (sr * sa + dr * da) / outA;
                const cg = (sg * sa + dg * da) / outA;
                const cb = (sb * sa + db * da) / outA;
                out[dIdx] = Math.max(0, Math.min(255, Math.round(cr * 255)));
                out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(cg * 255)));
                out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(cb * 255)));
              }
              out[dIdx + 3] = Math.round(outA * 255);
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

export function booleanImage(
  img: RgbaImage,
  operand: RgbaImage,
  op: "and" | "or" | "eor"
): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const w = img.width;
  const h = img.height;
  const opW = operand.width;
  const opH = operand.height;
  for (let y = 0; y < h; y++) {
    const oy = Math.min(opH - 1, y);
    for (let x = 0; x < w; x++) {
      const ox = Math.min(opW - 1, x);
      const idx = (y * w + x) * 4;
      const oIdx = (oy * opW + ox) * 4;
      for (let c = 0; c < 4; c++) {
        const a = img.data[idx + c]!;
        const b = operand.data[oIdx + c]!;
        out[idx + c] = op === "and" ? a & b : op === "or" ? a | b : a ^ b;
      }
      if (!img.hasAlpha && !operand.hasAlpha) {
        out[idx + 3] = 255;
      }
    }
  }
  const hasAlpha = img.hasAlpha || operand.hasAlpha;
  return {
    ...img,
    data: out,
    hasAlpha,
    channels: hasAlpha ? 4 : img.channels
  };
}

const SRGB_TO_LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR_LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function linearToSrgbByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(c * 255)));
}

function srgbToBwByte(r: number, g: number, b: number): number {
  if (r === g && g === b) return r;
  const y =
    0.2126729 * SRGB_TO_LINEAR_LUT[r]! +
    0.7151522 * SRGB_TO_LINEAR_LUT[g]! +
    0.0721750 * SRGB_TO_LINEAR_LUT[b]!;
  return linearToSrgbByte(y);
}

function srgbToLab(r: number, g: number, b: number): [number, number, number] {
  const lr = SRGB_TO_LINEAR_LUT[r]!;
  const lg = SRGB_TO_LINEAR_LUT[g]!;
  const lb = SRGB_TO_LINEAR_LUT[b]!;
  const x = (0.4124564 * lr + 0.3575761 * lg + 0.1804375 * lb) / 0.95047;
  const y = (0.2126729 * lr + 0.7151522 * lg + 0.0721750 * lb) / 1.0;
  const z = (0.0193339 * lr + 0.1191920 * lg + 0.9503041 * lb) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (Math.max(0, L) + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const finv = (t: number): number => {
    const t3 = t * t * t;
    return t3 > 0.008856 ? t3 : Math.max(0, (t - 16 / 116) / 7.787);
  };
  const x = finv(fx) * 0.95047;
  const y = L <= 0 ? 0 : finv(fy) * 1.0;
  const z = finv(fz) * 1.08883;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgbByte(lr), linearToSrgbByte(lg), linearToSrgbByte(lb)];
}

export function grayscaleImage(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const luma = srgbToBwByte(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    out[idx] = luma;
    out[idx + 1] = luma;
    out[idx + 2] = luma;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "b-w", channels: 1 };
}

export function flattenImage(img: RgbaImage, background: RgbaColor): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const a = img.data[idx + 3]! / 255;
    out[idx] = Math.round(img.data[idx]! * a + background.r * (1 - a));
    out[idx + 1] = Math.round(img.data[idx + 1]! * a + background.g * (1 - a));
    out[idx + 2] = Math.round(img.data[idx + 2]! * a + background.b * (1 - a));
    out[idx + 3] = 255;
  }
  return {
    ...img,
    data: out,
    hasAlpha: false,
    channels: img.channels === 4 ? 3 : img.channels === 2 ? 1 : img.channels
  };
}

export function unflattenImage(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
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

export function negateImage(img: RgbaImage, options?: { readonly alpha?: boolean }): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const negAlpha = options?.alpha ?? false;
  for (let i = 0; i < img.width * img.height; i++) {
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

export function modulateImage(
  img: RgbaImage,
  spec: {
    readonly brightness: number;
    readonly saturation: number;
    readonly hue: number;
    readonly lightness: number;
  }
): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const hueRadOffset = (spec.hue * Math.PI) / 180;
  for (let i = 0; i < img.width * img.height; i++) {
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
  return { ...img, data: out };
}

export function tintImage(img: RgbaImage, color: RgbaColor): RgbaImage {
  const [, ta, tb] = srgbToLab(color.r, color.g, color.b);
  const lut = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
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
    const idx = i * 4;
    const bw = srgbToBwByte(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    out[idx] = lut[bw * 3]!;
    out[idx + 1] = lut[bw * 3 + 1]!;
    out[idx + 2] = lut[bw * 3 + 2]!;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "srgb", channels: img.hasAlpha ? 4 : 3 };
}

export function gammaImage(img: RgbaImage, gamma = 2.2, gammaOut = gamma): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const gIn = Math.max(0.1, gamma);
  const gOut = Math.max(0.1, gammaOut);
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    const v1 = Math.min(255, Math.max(0, Math.floor(255 * Math.pow(i / 255, gIn))));
    lut[i] = Math.min(255, Math.max(0, Math.floor(255 * Math.pow(v1 / 255, 1 / gOut))));
  }
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    out[idx] = lut[img.data[idx]!]!;
    out[idx + 1] = lut[img.data[idx + 1]!]!;
    out[idx + 2] = lut[img.data[idx + 2]!]!;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function linearImage(
  img: RgbaImage,
  a: readonly number[],
  b: readonly number[]
): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const mul = a[c] ?? a[0] ?? 1;
      const off = b[c] ?? b[0] ?? 0;
      const v = Math.round(img.data[idx + c]! * mul + off);
      out[idx + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function normalizeImage(
  img: RgbaImage,
  options?: { readonly lower?: number; readonly upper?: number }
): RgbaImage {
  const lowerPct = Math.max(0, Math.min(100, options?.lower ?? 1));
  const upperPct = Math.max(lowerPct, Math.min(100, options?.upper ?? 99));
  const numPixels = img.width * img.height;
  if (numPixels === 0) return img;

  if (img.channels >= 3 && img.space !== "b-w") {
    const labs = new Float64Array(numPixels * 3);
    const sortedL = new Float64Array(numPixels);
    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const [L, a, b] = srgbToLab(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
      labs[p * 3] = L;
      labs[p * 3 + 1] = a;
      labs[p * 3 + 2] = b;
      sortedL[p] = L;
    }
    sortedL.sort();
    const lowIdx = Math.min(numPixels - 1, Math.max(0, Math.floor((numPixels * lowerPct) / 100)));
    const highIdx = Math.min(numPixels - 1, Math.max(lowIdx, Math.floor((numPixels * upperPct) / 100)));
    const minL = lowerPct <= 0 ? sortedL[0]! : Math.trunc(sortedL[lowIdx]!);
    const maxL = upperPct >= 100 ? sortedL[numPixels - 1]! : Math.trunc(sortedL[highIdx]!);
    const range = maxL - minL;
    if (Math.abs(range) < 2) return img;
    const out = new Uint8Array(img.data.length);
    for (let p = 0; p < numPixels; p++) {
      const idx = p * 4;
      const L = ((labs[p * 3]! - minL) * 100) / range;
      const [r, g, b] = labToSrgb(L, labs[p * 3 + 1]!, labs[p * 3 + 2]!);
      out[idx] = r;
      out[idx + 1] = g;
      out[idx + 2] = b;
      out[idx + 3] = img.data[idx + 3]!;
    }
    return { ...img, data: out };
  }

  const totalSamples = numPixels * 3;
  const hist = new Uint32Array(256);
  let min = 255;
  let max = 0;
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const v = img.data[idx + c]!;
      hist[v]!++;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }

  let lowBound = min;
  let highBound = max;
  if (lowerPct > 0 || upperPct < 100) {
    const lowTarget = Math.floor((totalSamples * lowerPct) / 100);
    const highTarget = Math.ceil((totalSamples * upperPct) / 100);
    let cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v]!;
      if (cum > lowTarget) {
        lowBound = v;
        break;
      }
    }
    cum = 0;
    for (let v = 0; v < 256; v++) {
      cum += hist[v]!;
      if (cum >= highTarget) {
        highBound = v;
        break;
      }
    }
  }

  const range = highBound - lowBound;
  if (range <= 0) return img;
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const scaled = Math.round(((img.data[idx + c]! - lowBound) * 255) / range);
      out[idx + c] = scaled < 0 ? 0 : scaled > 255 ? 255 : scaled;
    }
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function thresholdImage(
  img: RgbaImage,
  value = 128,
  grayscale = true
): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
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

export function blurImage(img: RgbaImage, sigma = 1.5): RgbaImage {
  if (sigma < 0) {
    return convolveImage(img, {
      width: 3,
      height: 3,
      kernel: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      scale: 9,
      offset: 0
    });
  }
  if (sigma <= 0.3) return img;
  const radius = Math.max(1, Math.min(25, Math.ceil(sigma * 3)));
  const size = radius * 2 + 1;
  const kernel = new Float32Array(size);
  let sum = 0;
  const twoSigmaSq = 2 * sigma * sigma;
  for (let i = -radius; i <= radius; i++) {
    const w = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = w;
    sum += w;
  }
  for (let i = 0; i < size; i++) kernel[i]! /= sum;

  const { width, height, data } = img;
  const temp = new Float32Array(data.length);
  const out = new Uint8Array(data.length);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = Math.max(0, Math.min(width - 1, x + k));
        const sIdx = (y * width + sx) * 4;
        const w = kernel[k + radius]!;
        const sa = data[sIdx + 3]! / 255;
        r += data[sIdx]! * sa * w;
        g += data[sIdx + 1]! * sa * w;
        b += data[sIdx + 2]! * sa * w;
        a += sa * w;
      }
      const dIdx = (y * width + x) * 4;
      temp[dIdx] = r;
      temp[dIdx + 1] = g;
      temp[dIdx + 2] = b;
      temp[dIdx + 3] = a;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = Math.max(0, Math.min(height - 1, y + k));
        const sIdx = (sy * width + x) * 4;
        const w = kernel[k + radius]!;
        r += temp[sIdx]! * w;
        g += temp[sIdx + 1]! * w;
        b += temp[sIdx + 2]! * w;
        a += temp[sIdx + 3]! * w;
      }
      const dIdx = (y * width + x) * 4;
      if (a > 1e-6) {
        out[dIdx] = Math.max(0, Math.min(255, Math.round(r / a)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(g / a)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(b / a)));
        out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      } else {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      }
    }
  }
  return { ...img, data: out };
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
  if (sigma < 0) {
    return convolveImage(img, {
      width: 3,
      height: 3,
      kernel: [-1, -1, -1, -1, 32, -1, -1, -1, -1],
      scale: 24,
      offset: 0
    });
  }
  const { width, height, data } = img;
  const L = new Float64Array(width * height);
  const A = new Float64Array(width * height);
  const B = new Float64Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const [lVal, aVal, bVal] = srgbToLab(data[idx]!, data[idx + 1]!, data[idx + 2]!);
    L[i] = lVal;
    A[i] = aVal;
    B[i] = bVal;
  }
  const radius = Math.max(1, Math.ceil(sigma * 3));
  const kernel = new Float64Array(radius * 2 + 1);
  let ksum = 0;
  for (let k = -radius; k <= radius; k++) {
    const v = Math.exp(-(k * k) / (2 * sigma * sigma));
    kernel[k + radius] = v;
    ksum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i]! /= ksum;
  const tmpL = new Float64Array(width * height);
  const blurL = new Float64Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        s += L[y * width + Math.max(0, Math.min(width - 1, x + k))]! * kernel[k + radius]!;
      }
      tmpL[y * width + x] = s;
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        s += tmpL[Math.max(0, Math.min(height - 1, y + k)) * width + x]! * kernel[k + radius]!;
      }
      blurL[y * width + x] = s;
    }
  }
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const d = L[i]! - blurL[i]!;
    const absD = Math.abs(d);
    let boost = absD <= x1 ? d * m1 : Math.sign(d) * (x1 * m1 + (absD - x1) * m2);
    if (boost > y2) boost = y2;
    if (boost < -y3) boost = -y3;
    const newL = Math.max(0, Math.min(100, L[i]! + boost));
    const [nr, ng, nb] = labToSrgb(newL, A[i]!, B[i]!);
    out[idx] = nr;
    out[idx + 1] = ng;
    out[idx + 2] = nb;
    out[idx + 3] = data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function medianImage(img: RgbaImage, size = 3): RgbaImage {
  const radius = Math.max(1, Math.floor(size / 2));
  const { width, height, data } = img;
  const out = new Uint8Array(data.length);
  const windowLen = (radius * 2 + 1) * (radius * 2 + 1);
  const rWin = new Uint8Array(windowLen);
  const gWin = new Uint8Array(windowLen);
  const bWin = new Uint8Array(windowLen);
  const aWin = new Uint8Array(windowLen);
  const mid = windowLen >>> 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let p = 0;
      for (let ky = -radius; ky <= radius; ky++) {
        const sy = Math.max(0, Math.min(height - 1, y + ky));
        for (let kx = -radius; kx <= radius; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx));
          const sIdx = (sy * width + sx) * 4;
          rWin[p] = data[sIdx]!;
          gWin[p] = data[sIdx + 1]!;
          bWin[p] = data[sIdx + 2]!;
          aWin[p] = data[sIdx + 3]!;
          p++;
        }
      }
      rWin.sort();
      gWin.sort();
      bWin.sort();
      aWin.sort();
      const dIdx = (y * width + x) * 4;
      out[dIdx] = rWin[mid]!;
      out[dIdx + 1] = gWin[mid]!;
      out[dIdx + 2] = bWin[mid]!;
      out[dIdx + 3] = aWin[mid]!;
    }
  }
  return { ...img, data: out };
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
  const { width, height, data } = img;
  const kw = spec.width;
  const kh = spec.height;
  const rx = Math.floor(kw / 2);
  const ry = Math.floor(kh / 2);
  const scale = spec.scale === 0 ? 1 : spec.scale;
  const out = new Uint8Array(data.length);
  const usePremul = img.hasAlpha || img.channels === 4 || img.channels === 2;
  const premul = usePremul ? new Float64Array(width * height * 4) : undefined;
  if (premul) {
    for (let i = 0; i < width * height; i++) {
      const idx = i * 4;
      const a = data[idx + 3]!;
      premul[idx] = (data[idx]! * a) / 255;
      premul[idx + 1] = (data[idx + 1]! * a) / 255;
      premul[idx + 2] = (data[idx + 2]! * a) / 255;
      premul[idx + 3] = a;
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let ky = 0; ky < kh; ky++) {
        const sy = Math.max(0, Math.min(height - 1, y + ky - ry));
        for (let kx = 0; kx < kw; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx - rx));
          const w = spec.kernel[ky * kw + kx] ?? 0;
          const sIdx = (sy * width + sx) * 4;
          if (premul) {
            r += premul[sIdx]! * w;
            g += premul[sIdx + 1]! * w;
            b += premul[sIdx + 2]! * w;
            a += premul[sIdx + 3]! * w;
          } else {
            r += data[sIdx]! * w;
            g += data[sIdx + 1]! * w;
            b += data[sIdx + 2]! * w;
          }
        }
      }
      const dIdx = (y * width + x) * 4;
      if (premul) {
        const fR = r / scale + spec.offset;
        const fG = g / scale + spec.offset;
        const fB = b / scale + spec.offset;
        const fA = a / scale + spec.offset;
        out[dIdx] = fA > 0 ? Math.max(0, Math.min(255, Math.round((fR * 255) / fA))) : 0;
        out[dIdx + 1] = fA > 0 ? Math.max(0, Math.min(255, Math.round((fG * 255) / fA))) : 0;
        out[dIdx + 2] = fA > 0 ? Math.max(0, Math.min(255, Math.round((fB * 255) / fA))) : 0;
        out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(fA)));
      } else {
        out[dIdx] = Math.max(0, Math.min(255, Math.round(r / scale + spec.offset)));
        out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(g / scale + spec.offset)));
        out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(b / scale + spec.offset)));
        out[dIdx + 3] = data[dIdx + 3]!;
      }
    }
  }
  return { ...img, data: out };
}

export function ensureAlphaImage(img: RgbaImage, alpha = 1): RgbaImage {
  if (img.hasAlpha) return img;
  const aByte = alpha <= 1 ? Math.round(alpha * 255) : Math.round(alpha);
  const out = new Uint8Array(img.data);
  for (let i = 3; i < out.length; i += 4) {
    out[i] = aByte;
  }
  return { ...img, data: out, hasAlpha: true, channels: 4 };
}

export function removeAlphaImage(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.data);
  for (let i = 3; i < out.length; i += 4) {
    out[i] = 255;
  }
  return {
    ...img,
    data: out,
    hasAlpha: false,
    channels: img.channels === 4 ? 3 : img.channels === 2 ? 1 : img.channels
  };
}

export function extractChannelImage(img: RgbaImage, channel: 0 | 1 | 2 | 3): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
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

export function recombImage(
  img: RgbaImage,
  matrix: readonly (readonly number[])[]
): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const is4x4 = matrix.length >= 4 && (matrix[0]?.length ?? 0) >= 4;
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const r = img.data[idx]!;
    const g = img.data[idx + 1]!;
    const b = img.data[idx + 2]!;
    const a = img.data[idx + 3]!;
    const rRow = matrix[0] ?? [1, 0, 0, 0];
    const gRow = matrix[1] ?? [0, 1, 0, 0];
    const bRow = matrix[2] ?? [0, 0, 1, 0];
    out[idx] = clamp(
      r * (rRow[0] ?? 0) + g * (rRow[1] ?? 0) + b * (rRow[2] ?? 0) + (is4x4 ? a * (rRow[3] ?? 0) : 0)
    );
    out[idx + 1] = clamp(
      r * (gRow[0] ?? 0) + g * (gRow[1] ?? 0) + b * (gRow[2] ?? 0) + (is4x4 ? a * (gRow[3] ?? 0) : 0)
    );
    out[idx + 2] = clamp(
      r * (bRow[0] ?? 0) + g * (bRow[1] ?? 0) + b * (bRow[2] ?? 0) + (is4x4 ? a * (bRow[3] ?? 0) : 0)
    );
    if (is4x4 && matrix[3]) {
      const aRow = matrix[3]!;
      out[idx + 3] = clamp(
        r * (aRow[0] ?? 0) + g * (aRow[1] ?? 0) + b * (aRow[2] ?? 0) + a * (aRow[3] ?? 1)
      );
    } else {
      out[idx + 3] = a;
    }
  }
  return { ...img, data: out };
}

export function toColorspaceImage(img: RgbaImage, space: ColorSpace): RgbaImage {
  if (space === "b-w" || space === "grey16") {
    return grayscaleImage(img);
  }
  return {
    ...img,
    space,
    channels: img.hasAlpha ? 4 : 3
  };
}

export function bandboolImage(img: RgbaImage, op: "and" | "or" | "eor"): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const chCount = img.channels;
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    let acc = img.data[idx]!;
    for (let c = 1; c < chCount; c++) {
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

export function joinChannelImage(img: RgbaImage, extraImages: readonly RgbaImage[]): RgbaImage {
  const out = new Uint8Array(img.data);
  const firstExtra = extraImages[0];
  if (!firstExtra) return img;
  if (img.channels === 1 && extraImages.length >= 2) {
    const gImg = extraImages[0]!;
    const bImg = extraImages[1]!;
    const aImg = extraImages[2];
    for (let i = 0; i < img.width * img.height; i++) {
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
  for (let i = 0; i < img.width * img.height; i++) {
    out[i * 4 + 3] = firstExtra.data[i * 4] ?? 255;
  }
  return {
    ...img,
    data: out,
    channels: img.channels === 1 ? 2 : 4,
    hasAlpha: true
  };
}

export function claheImage(
  img: RgbaImage,
  options: { readonly width: number; readonly height: number; readonly maxSlope: number }
): RgbaImage {
  const { width, height, data } = img;
  const out = new Uint8Array(data);
  const winW = Math.max(1, options.width || 8);
  const winH = Math.max(1, options.height || 8);
  const maxSlope = options.maxSlope !== undefined ? Math.max(0, options.maxSlope) : 3;
  const halfW = Math.floor(winW / 2);
  const halfH = Math.floor(winH / 2);
  const nPixels = winW * winH;
  const threshold = maxSlope > 0 ? Math.floor((maxSlope * nPixels) / 256) : nPixels;
  const numCh = img.channels === 1 || img.space === "b-w" ? 1 : 3;

  const mirrorCoord = (c: number, max: number): number => {
    if (max <= 1) return 0;
    let cur = c;
    while (cur < 0 || cur >= max) {
      if (cur < 0) cur = -cur;
      if (cur >= max) cur = 2 * max - 2 - cur;
    }
    return cur;
  };

  const syTable = new Int32Array(winH);
  const sxTable = new Int32Array(width + winW);
  for (let i = 0; i < width + winW; i++) {
    sxTable[i] = mirrorCoord(i - halfW, width);
  }

  const hist = new Int32Array(256);
  for (let ch = 0; ch < numCh; ch++) {
    for (let y = 0; y < height; y++) {
      for (let dy = 0; dy < winH; dy++) {
        syTable[dy] = mirrorCoord(y + dy - halfH, height) * width * 4 + ch;
      }
      hist.fill(0);
      for (let dy = 0; dy < winH; dy++) {
        const rowBase = syTable[dy]!;
        for (let dx = 0; dx < winW; dx++) {
          hist[data[rowBase + sxTable[dx]! * 4]!]!++;
        }
      }
      for (let x = 0; x < width; x++) {
        const pIdx = (y * width + x) * 4;
        const target = data[pIdx + ch]!;
        let sum = 0;
        if (maxSlope > 0) {
          let clipLe = 0;
          let clipTot = 0;
          for (let i = 0; i < 256; i++) {
            const h = hist[i]!;
            const c = h > threshold ? threshold : h;
            clipTot += c;
            if (i <= target) clipLe += c;
          }
          sum = clipLe + Math.floor((target * (nPixels - clipTot)) / 256);
        } else {
          for (let i = 0; i <= target; i++) sum += hist[i]!;
        }
        const outVal = Math.max(0, Math.min(255, Math.floor((255 * sum) / nPixels + 0.5)));
        if (numCh === 1) {
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

export function affineImage(
  img: RgbaImage,
  spec: {
    readonly matrix: readonly [number, number, number, number];
    readonly background: RgbaColor;
    readonly idx?: number;
    readonly idy?: number;
    readonly odx?: number;
    readonly ody?: number;
  }
): RgbaImage {
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
    const x = a * (cx - idx) + b * (cy - idy) + idx + odx;
    const y = c * (cx - idx) + d * (cy - idy) + idy + ody;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const dstW = Math.max(1, Math.round(maxX - minX));
  const dstH = Math.max(1, Math.round(maxY - minY));
  const iMinX = Math.round(minX);
  const iMinY = Math.round(minY);
  const out = new Uint8Array(dstW * dstH * 4);
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
    for (let x = 0; x < dstW; x++) {
      const ox = x + iMinX - idx - odx;
      const oy = y + iMinY - idy - ody;
      const sx = (d * ox - b * oy) / det + idx;
      const sy = (-c * ox + a * oy) / det + idy;
      const dIdx = (y * dstW + x) * 4;
      if (sx <= -1 || sx >= img.width || sy <= -1 || sy >= img.height) {
        if (spec.background.a > 0) {
          out[dIdx] = spec.background.r;
          out[dIdx + 1] = spec.background.g;
          out[dIdx + 2] = spec.background.b;
          out[dIdx + 3] = spec.background.a;
        }
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
  return {
    ...img,
    width: dstW,
    height: dstH,
    data: out
  };
}

export function computeImageStats(img: RgbaImage): ImageStats {
  const { width, height, data } = img;
  const totalPixels = Math.max(1, width * height);
  const numCh = img.hasAlpha ? 4 : img.channels === 1 ? 1 : 3;
  const channels: ChannelStats[] = [];

  for (let c = 0; c < numCh; c++) {
    let min = 255;
    let max = 0;
    let sum = 0;
    let squaresSum = 0;
    let minX = 0;
    let minY = 0;
    let maxX = 0;
    let maxY = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
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
  const colorBins = new Uint32Array(4096);
  const binSumR = new Float64Array(4096);
  const binSumG = new Float64Array(4096);
  const binSumB = new Float64Array(4096);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx]!;
    const g = data[idx + 1]!;
    const b = data[idx + 2]!;
    const a = data[idx + 3]!;
    if (a < 255) isOpaque = false;
    const luma = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    hist[luma]!++;
    const bin = ((r >>> 4) << 8) | ((g >>> 4) << 4) | (b >>> 4);
    colorBins[bin]!++;
    binSumR[bin]! += r;
    binSumG[bin]! += g;
    binSumB[bin]! += b;
  }

  let entropy = 0;
  for (let i = 0; i < 256; i++) {
    const count = hist[i]!;
    if (count > 0) {
      const p = count / totalPixels;
      entropy -= p * Math.log2(p);
    }
  }

  let maxBin = 0;
  let maxBinCount = 0;
  for (let i = 0; i < 4096; i++) {
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

  // Laplacian variance sharpness estimate
  let lapSum = 0;
  let lapSqSum = 0;
  let lapCount = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const c = data[(y * width + x) * 4]!;
      const n = data[((y - 1) * width + x) * 4]!;
      const s = data[((y + 1) * width + x) * 4]!;
      const w = data[(y * width + (x - 1)) * 4]!;
      const e = data[(y * width + (x + 1)) * 4]!;
      const lap = n + s + w + e - 4 * c;
      lapSum += lap;
      lapSqSum += lap * lap;
      lapCount++;
    }
  }
  const lapMean = lapCount > 0 ? lapSum / lapCount : 0;
  const sharpness = lapCount > 0 ? Math.sqrt(Math.max(0, lapSqSum / lapCount - lapMean * lapMean)) : 0;

  return {
    channels,
    isOpaque,
    entropy,
    sharpness,
    dominant
  };
}
