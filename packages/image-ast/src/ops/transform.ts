import type {
  BlendMode,
  ChannelStats,
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
  const dstW = Math.max(1, Math.ceil(img.width * absCos + img.height * absSin - 1e-6));
  const dstH = Math.max(1, Math.ceil(img.width * absSin + img.height * absCos - 1e-6));
  const out = new Uint8Array(dstW * dstH * 4);

  const cxSrc = (img.width - 1) / 2;
  const cySrc = (img.height - 1) / 2;
  const cxDst = (dstW - 1) / 2;
  const cyDst = (dstH - 1) / 2;

  for (let y = 0; y < dstH; y++) {
    const dy = y - cyDst;
    for (let x = 0; x < dstW; x++) {
      const dx = x - cxDst;
      const sx = dx * cos + dy * sin + cxSrc;
      const sy = -dx * sin + dy * cos + cySrc;
      const dIdx = (y * dstW + x) * 4;
      if (sx < 0 || sy < 0 || sx >= img.width - 1 || sy >= img.height - 1) {
        if (sx >= -0.5 && sy >= -0.5 && sx < img.width - 0.5 && sy < img.height - 0.5) {
          const ix = Math.max(0, Math.min(img.width - 1, Math.round(sx)));
          const iy = Math.max(0, Math.min(img.height - 1, Math.round(sy)));
          const sIdx = (iy * img.width + ix) * 4;
          out[dIdx] = img.data[sIdx]!;
          out[dIdx + 1] = img.data[sIdx + 1]!;
          out[dIdx + 2] = img.data[sIdx + 2]!;
          out[dIdx + 3] = img.data[sIdx + 3]!;
        } else {
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
        const i00 = (y0 * img.width + x0) * 4;
        const i10 = (y0 * img.width + (x0 + 1)) * 4;
        const i01 = ((y0 + 1) * img.width + x0) * 4;
        const i11 = ((y0 + 1) * img.width + (x0 + 1)) * 4;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;
        const a00 = img.data[i00 + 3]! / 255;
        const a10 = img.data[i10 + 3]! / 255;
        const a01 = img.data[i01 + 3]! / 255;
        const a11 = img.data[i11 + 3]! / 255;
        const outA = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
        if (outA > 1e-6) {
          for (let c = 0; c < 3; c++) {
            const pm =
              img.data[i00 + c]! * a00 * w00 +
              img.data[i10 + c]! * a10 * w10 +
              img.data[i01 + c]! * a01 * w01 +
              img.data[i11 + c]! * a11 * w11;
            out[dIdx + c] = Math.max(0, Math.min(255, Math.round(pm / outA)));
          }
          out[dIdx + 3] = Math.max(0, Math.min(255, Math.round(outA * 255)));
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

  const isBg = (x: number, y: number): boolean => {
    const idx = (y * img.width + x) * 4;
    const dr = Math.abs(img.data[idx]! - ref.r);
    const dg = Math.abs(img.data[idx + 1]! - ref.g);
    const db = Math.abs(img.data[idx + 2]! - ref.b);
    const da = Math.abs(img.data[idx + 3]! - ref.a);
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
    return extractImage(img, { left: 0, top: 0, width: 1, height: 1 });
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

  return extractImage(img, {
    left,
    top,
    width: right - left + 1,
    height: bottom - top + 1
  });
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

function blendChannel(s: number, d: number, mode: BlendMode): number {
  switch (mode) {
    case "multiply":
      return s * d;
    case "screen":
      return s + d - s * d;
    case "overlay":
      return d < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case "darken":
      return Math.min(s, d);
    case "lighten":
      return Math.max(s, d);
    case "color-dodge":
    case "colour-dodge":
      return d === 0 ? 0 : s === 1 ? 1 : Math.min(1, d / (1 - s));
    case "color-burn":
    case "colour-burn":
      return d === 1 ? 1 : s === 0 ? 0 : 1 - Math.min(1, (1 - d) / s);
    case "hard-light":
      return s < 0.5 ? 2 * s * d : 1 - 2 * (1 - s) * (1 - d);
    case "soft-light":
      return s < 0.5
        ? d - (1 - 2 * s) * d * (1 - d)
        : d + (2 * s - 1) * (d <= 0.25 ? ((16 * d - 12) * d + 4) * d : Math.sqrt(d) - d);
    case "difference":
      return Math.abs(d - s);
    case "exclusion":
      return s + d - 2 * s * d;
    case "add":
      return Math.min(1, s + d);
    default:
      return s;
  }
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

    const iterW = layer.tile ? baseW : overlay.width;
    const iterH = layer.tile ? baseH : overlay.height;

    for (let ty = 0; ty < 1; ty++) {
      for (let tx = 0; tx < 1; tx++) {
        for (let y = 0; y < iterH; y++) {
          const dy = layer.tile ? y : startY + y;
          if (dy < 0 || dy >= baseH) continue;
          const sy = layer.tile
            ? (((dy - startY) % overlay.height) + overlay.height) % overlay.height
            : y;
          for (let x = 0; x < iterW; x++) {
            const dx = layer.tile ? x : startX + x;
            if (dx < 0 || dx >= baseW) continue;
            const sx = layer.tile
              ? (((dx - startX) % overlay.width) + overlay.width) % overlay.width
              : x;
            const sIdx = (sy * overlay.width + sx) * 4;
            const dIdx = (dy * baseW + dx) * 4;

            const sr = overlay.data[sIdx]! / 255;
            const sg = overlay.data[sIdx + 1]! / 255;
            const sb = overlay.data[sIdx + 2]! / 255;
            const sa = overlay.data[sIdx + 3]! / 255;

            const dr = out[dIdx]! / 255;
            const dg = out[dIdx + 1]! / 255;
            const db = out[dIdx + 2]! / 255;
            const da = out[dIdx + 3]! / 255;

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

export function grayscaleImage(img: RgbaImage): RgbaImage {
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const luma = Math.round(
      0.2126 * img.data[idx]! + 0.7152 * img.data[idx + 1]! + 0.0722 * img.data[idx + 2]!
    );
    out[idx] = luma;
    out[idx + 1] = luma;
    out[idx + 2] = luma;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "b-w", channels: img.hasAlpha ? 2 : 1 };
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
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const [h, s, l] = rgbToHsl(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    const nh = h + spec.hue;
    const ns = Math.max(0, Math.min(1, s * spec.saturation));
    const nl = Math.max(0, Math.min(1, l * spec.brightness + spec.lightness / 100));
    const [r, g, b] = hslToRgb(nh, ns, nl);
    out[idx] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out };
}

export function tintImage(img: RgbaImage, color: RgbaColor): RgbaImage {
  const [th, ts] = rgbToHsl(color.r, color.g, color.b);
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    const [, , l] = rgbToHsl(img.data[idx]!, img.data[idx + 1]!, img.data[idx + 2]!);
    const [r, g, b] = hslToRgb(th, ts, l);
    out[idx] = r;
    out[idx + 1] = g;
    out[idx + 2] = b;
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, space: "srgb", channels: img.hasAlpha ? 4 : 3 };
}

export function gammaImage(img: RgbaImage, gamma = 2.2, gammaOut = gamma): RgbaImage {
  const out = new Uint8Array(img.data.length);
  const exp = gamma / gammaOut;
  const lut = new Uint8Array(256);
  for (let i = 0; i < 256; i++) {
    lut[i] = Math.max(0, Math.min(255, Math.round(Math.pow(i / 255, exp) * 255)));
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
  const totalSamples = img.width * img.height * 3;
  if (totalSamples === 0) return img;

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
  if (lowerPct > 1 || upperPct < 99) {
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
      const luma =
        0.2126 * img.data[idx]! + 0.7152 * img.data[idx + 1]! + 0.0722 * img.data[idx + 2]!;
      const bit = luma >= value ? 255 : 0;
      out[idx] = bit;
      out[idx + 1] = bit;
      out[idx + 2] = bit;
    } else {
      out[idx] = img.data[idx]! >= value ? 255 : 0;
      out[idx + 1] = img.data[idx + 1]! >= value ? 255 : 0;
      out[idx + 2] = img.data[idx + 2]! >= value ? 255 : 0;
    }
    out[idx + 3] = img.data[idx + 3]!;
  }
  return { ...img, data: out, ...(grayscale ? { space: "b-w" as const } : {}) };
}

export function blurImage(img: RgbaImage, sigma = 1.5): RgbaImage {
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
  amount = 1.0
): RgbaImage {
  const blurred = blurImage(img, sigma);
  const out = new Uint8Array(img.data.length);
  for (let i = 0; i < img.width * img.height; i++) {
    const idx = i * 4;
    for (let c = 0; c < 3; c++) {
      const orig = img.data[idx + c]!;
      const blur = blurred.data[idx + c]!;
      const val = Math.round(orig + amount * (orig - blur));
      out[idx + c] = val < 0 ? 0 : val > 255 ? 255 : val;
    }
    out[idx + 3] = img.data[idx + 3]!;
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
          p++;
        }
      }
      rWin.sort();
      gWin.sort();
      bWin.sort();
      const dIdx = (y * width + x) * 4;
      out[dIdx] = rWin[mid]!;
      out[dIdx + 1] = gWin[mid]!;
      out[dIdx + 2] = bWin[mid]!;
      out[dIdx + 3] = data[dIdx + 3]!;
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

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let ky = 0; ky < kh; ky++) {
        const sy = Math.max(0, Math.min(height - 1, y + ky - ry));
        for (let kx = 0; kx < kw; kx++) {
          const sx = Math.max(0, Math.min(width - 1, x + kx - rx));
          const w = spec.kernel[ky * kw + kx] ?? 0;
          const sIdx = (sy * width + sx) * 4;
          r += data[sIdx]! * w;
          g += data[sIdx + 1]! * w;
          b += data[sIdx + 2]! * w;
        }
      }
      const dIdx = (y * width + x) * 4;
      out[dIdx] = Math.max(0, Math.min(255, Math.round(r / scale + spec.offset)));
      out[dIdx + 1] = Math.max(0, Math.min(255, Math.round(g / scale + spec.offset)));
      out[dIdx + 2] = Math.max(0, Math.min(255, Math.round(b / scale + spec.offset)));
      out[dIdx + 3] = data[dIdx + 3]!;
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

export function toColorspaceImage(img: RgbaImage, space: "srgb" | "b-w" | "cmyk"): RgbaImage {
  if (space === "b-w") {
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
  return { ...img, data: out, space: "b-w", channels: 1, hasAlpha: false };
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
  const out = new Uint8Array(img.data.length);
  const tileW = Math.max(1, options.width || 8);
  const tileH = Math.max(1, options.height || 8);
  const maxSlope = options.maxSlope > 0 ? options.maxSlope : 3;

  for (let ty = 0; ty < img.height; ty += tileH) {
    for (let tx = 0; tx < img.width; tx += tileW) {
      const xEnd = Math.min(img.width, tx + tileW);
      const yEnd = Math.min(img.height, ty + tileH);
      const count = (xEnd - tx) * (yEnd - ty);
      if (count <= 0) continue;
      const hist = new Float64Array(256);
      for (let y = ty; y < yEnd; y++) {
        for (let x = tx; x < xEnd; x++) {
          const idx = (y * img.width + x) * 4;
          const luma = Math.round(
            0.299 * img.data[idx]! + 0.587 * img.data[idx + 1]! + 0.114 * img.data[idx + 2]!
          );
          hist[luma]!++;
        }
      }
      const clipLimit = Math.max(1, (maxSlope * count) / 256);
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i]! > clipLimit) {
          excess += hist[i]! - clipLimit;
          hist[i] = clipLimit;
        }
      }
      const addPerBin = excess / 256;
      const cdf = new Uint8Array(256);
      let cum = 0;
      for (let i = 0; i < 256; i++) {
        cum += hist[i]! + addPerBin;
        cdf[i] = clamp((cum * 255) / count);
      }
      for (let y = ty; y < yEnd; y++) {
        for (let x = tx; x < xEnd; x++) {
          const idx = (y * img.width + x) * 4;
          const r = img.data[idx]!;
          const g = img.data[idx + 1]!;
          const b = img.data[idx + 2]!;
          const luma = Math.max(1, Math.round(0.299 * r + 0.587 * g + 0.114 * b));
          const scale = cdf[luma]! / luma;
          out[idx] = clamp(r * scale);
          out[idx + 1] = clamp(g * scale);
          out[idx + 2] = clamp(b * scale);
          out[idx + 3] = img.data[idx + 3]!;
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
    readonly idx: number;
    readonly idy: number;
    readonly odx: number;
    readonly ody: number;
  }
): RgbaImage {
  const [a, b, c, d] = spec.matrix;
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
    const x = a * (cx - spec.idx) + b * (cy - spec.idy) + spec.odx;
    const y = c * (cx - spec.idx) + d * (cy - spec.idy) + spec.ody;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const dstW = Math.max(1, Math.round(maxX - minX));
  const dstH = Math.max(1, Math.round(maxY - minY));
  const out = new Uint8Array(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    for (let x = 0; x < dstW; x++) {
      const ox = x + minX - spec.odx;
      const oy = y + minY - spec.ody;
      const sx = (d * ox - b * oy) / det + spec.idx;
      const sy = (-c * ox + a * oy) / det + spec.idy;
      const dIdx = (y * dstW + x) * 4;
      const ix = Math.round(sx);
      const iy = Math.round(sy);
      if (ix >= 0 && ix < img.width && iy >= 0 && iy < img.height) {
        const sIdx = (iy * img.width + ix) * 4;
        out[dIdx] = img.data[sIdx]!;
        out[dIdx + 1] = img.data[sIdx + 1]!;
        out[dIdx + 2] = img.data[sIdx + 2]!;
        out[dIdx + 3] = img.data[sIdx + 3]!;
      } else {
        out[dIdx] = spec.background.r;
        out[dIdx + 1] = spec.background.g;
        out[dIdx + 2] = spec.background.b;
        out[dIdx + 3] = spec.background.a;
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
    const variance = Math.max(0, squaresSum / totalPixels - mean * mean);
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
          r: Math.round(binSumR[maxBin]! / maxBinCount),
          g: Math.round(binSumG[maxBin]! / maxBinCount),
          b: Math.round(binSumB[maxBin]! / maxBinCount)
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
