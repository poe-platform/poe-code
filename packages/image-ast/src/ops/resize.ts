import type {
  GravityPosition,
  ResizeFit,
  ResizeKernel,
  RgbaColor,
  RgbaImage
} from "../ast.js";

function sinc(x: number): number {
  if (Math.abs(x) < 1e-7) return 1;
  const px = Math.PI * x;
  return Math.sin(px) / px;
}

function kernelWeight(x: number, kernel: ResizeKernel): number {
  const ax = Math.abs(x);
  switch (kernel) {
    case "nearest":
      return ax < 0.5 ? 1 : 0;
    case "linear":
    case "bilinear":
      return ax < 1 ? 1 - ax : 0;
    case "cubic": {
      // Catmull-Rom (B = 0, C = 0.5)
      if (ax < 1) {
        return 1.5 * ax * ax * ax - 2.5 * ax * ax + 1;
      }
      if (ax < 2) {
        return -0.5 * ax * ax * ax + 2.5 * ax * ax - 4 * ax + 2;
      }
      return 0;
    }
    case "mitchell": {
      // Mitchell-Netravali (B = 1/3, C = 1/3)
      const B = 1 / 3;
      const C = 1 / 3;
      if (ax < 1) {
        return ((12 - 9 * B - 6 * C) * ax * ax * ax + (-18 + 12 * B + 6 * C) * ax * ax + (6 - 2 * B)) / 6;
      }
      if (ax < 2) {
        return (
          ((-B - 6 * C) * ax * ax * ax +
            (6 * B + 30 * C) * ax * ax +
            (-12 * B - 48 * C) * ax +
            (8 * B + 24 * C)) /
          6
        );
      }
      return 0;
    }
    case "lanczos2":
      return ax < 2 ? sinc(x) * sinc(x / 2) : 0;
    case "lanczos3":
    default:
      return ax < 3 ? sinc(x) * sinc(x / 3) : 0;
  }
}

function kernelRadius(kernel: ResizeKernel): number {
  switch (kernel) {
    case "nearest":
      return 0.5;
    case "linear":
    case "bilinear":
      return 1;
    case "cubic":
    case "mitchell":
    case "lanczos2":
      return 2;
    case "lanczos3":
    default:
      return 3;
  }
}

export function resolveGravityOffset(
  outerW: number,
  outerH: number,
  innerW: number,
  innerH: number,
  position: GravityPosition = "center",
  isCrop = false
): { readonly x: number; readonly y: number } {
  const dx = outerW - innerW;
  const dy = outerH - innerH;
  const posStr =
    typeof position === "number"
      ? (["center", "north", "east", "south", "west", "northeast", "southeast", "southwest", "northwest"][
          position
        ] ?? "center")
      : position;
  const p = posStr.toLowerCase();
  let x = isCrop ? Math.floor((dx + 1) / 2) : Math.floor(dx / 2);
  let y = isCrop ? Math.floor((dy + 1) / 2) : Math.floor(dy / 2);

  if (p.includes("west") || p.includes("left")) x = 0;
  else if (p.includes("east") || p.includes("right")) x = dx;

  if (p.includes("north") || p.includes("top")) y = 0;
  else if (p.includes("south") || p.includes("bottom")) y = dy;

  return { x, y };
}

function regionEntropy(
  rgba: Uint8Array,
  imgW: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): number {
  const total = rw * rh;
  if (total <= 0) return 0;
  const hist = new Int32Array(256);
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      const idx = (y * imgW + x) * 4;
      const lum = Math.round(0.299 * rgba[idx]! + 0.587 * rgba[idx + 1]! + 0.114 * rgba[idx + 2]!);
      hist[lum < 0 ? 0 : lum > 255 ? 255 : lum]!++;
    }
  }
  let h = 0;
  for (let i = 0; i < 256; i++) {
    const c = hist[i]!;
    if (c > 0) {
      const p = c / total;
      h -= p * Math.log2(p);
    }
  }
  return h;
}

function smartcropEntropy(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { readonly x: number; readonly y: number } {
  let left = 0;
  let top = 0;
  let width = srcW;
  let height = srcH;
  const widthSlice = Math.max(1, Math.ceil((srcW - dstW) / 8));
  const heightSlice = Math.max(1, Math.ceil((srcH - dstH) / 8));
  while (width > dstW) {
    const sliceW = Math.min(width - dstW, widthSlice);
    const eLeft = regionEntropy(rgba, srcW, left, top, sliceW, height);
    const eRight = regionEntropy(rgba, srcW, left + width - sliceW, top, sliceW, height);
    if (eLeft < eRight) {
      left += sliceW;
    }
    width -= sliceW;
  }
  while (height > dstH) {
    const sliceH = Math.min(height - dstH, heightSlice);
    const eTop = regionEntropy(rgba, srcW, left, top, width, sliceH);
    const eBottom = regionEntropy(rgba, srcW, left, top + height - sliceH, width, sliceH);
    if (eTop < eBottom) {
      top += sliceH;
    }
    height -= sliceH;
  }
  return { x: left, y: top };
}

function smartcropAttention(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { readonly x: number; readonly y: number } {
  const att = new Float32Array(srcW * srcH);
  for (let y = 0; y < srcH; y++) {
    for (let x = 0; x < srcW; x++) {
      const idx = (y * srcW + x) * 4;
      const r = rgba[idx]!;
      const g = rgba[idx + 1]!;
      const b = rgba[idx + 2]!;
      const a = rgba[idx + 3]! / 255;
      const sat = Math.max(r, g, b) - Math.min(r, g, b);
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;
      const lIdx = (y * srcW + Math.max(0, x - 1)) * 4;
      const rIdx = (y * srcW + Math.min(srcW - 1, x + 1)) * 4;
      const tIdx = (Math.max(0, y - 1) * srcW + x) * 4;
      const bIdx = (Math.min(srcH - 1, y + 1) * srcW + x) * 4;
      const edge =
        Math.abs(4 * r - rgba[lIdx]! - rgba[rIdx]! - rgba[tIdx]! - rgba[bIdx]!) +
        Math.abs(4 * g - rgba[lIdx + 1]! - rgba[rIdx + 1]! - rgba[tIdx + 1]! - rgba[bIdx + 1]!) +
        Math.abs(4 * b - rgba[lIdx + 2]! - rgba[rIdx + 2]! - rgba[tIdx + 2]! - rgba[bIdx + 2]!);
      att[y * srcW + x] = (sat * 2 + lum * 0.5 + edge) * a;
    }
  }
  let bestX = 0;
  let bestY = 0;
  let bestScore = -1;
  for (let cy = 0; cy <= srcH - dstH; cy++) {
    for (let cx = 0; cx <= srcW - dstW; cx++) {
      let sum = 0;
      for (let y = cy; y < cy + dstH; y++) {
        const row = y * srcW;
        for (let x = cx; x < cx + dstW; x++) sum += att[row + x]!;
      }
      if (sum > bestScore) {
        bestScore = sum;
        bestX = cx;
        bestY = cy;
      }
    }
  }
  return { x: bestX, y: bestY };
}

function fmaDouble(a: number, b: number, c: number): number {
  const splitter = 134217729;
  const p = a * b;
  const ca = splitter * a;
  const ah = ca - (ca - a);
  const al = a - ah;
  const cb = splitter * b;
  const bh = cb - (cb - b);
  const bl = b - bh;
  const err = ((ah * bh - p) + ah * bl + al * bh) + al * bl;
  return (p + c) + err;
}

function computeVipsNearestIndices2D(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): { readonly xs: Int32Array; readonly ys: Int32Array } {
  let hscale = 1.0 / (srcW / dstW);
  let vscale = 1.0 / (srcH / dstH);
  const targetW = Math.trunc(fmaDouble(srcW, hscale, 0.5));
  const targetH = Math.trunc(fmaDouble(srcH, vscale, 0.5));
  const intHshrink = Math.max(1, Math.floor((srcW / targetW) / 2.0));
  const intVshrink = Math.max(1, Math.floor((srcH / targetH) / 2.0));
  let subW = srcW;
  let subH = srcH;
  let xshrink = 1;
  let yshrink = 1;
  if (intHshrink > 1 || intVshrink > 1) {
    xshrink = intHshrink;
    yshrink = intVshrink;
    subW = Math.floor(srcW / xshrink);
    subH = Math.floor(srcH / yshrink);
    hscale *= xshrink;
    vscale *= yshrink;
  }
  hscale = Math.max(hscale, 1.0 / subW);
  vscale = Math.max(vscale, 1.0 / subH);

  let remVscale = vscale;
  const ys = new Int32Array(dstH);
  if (vscale < 1.0) {
    const vshrink = 1.0 / vscale;
    const outH = Math.trunc(subH / vshrink + 0.5);
    const extraPixels = fmaDouble(outH, vshrink, -subH);
    const voffset = (extraPixels + 1.0) * 0.5 - 1.0;
    let pos = fmaDouble(0.5, vshrink, -0.5) - voffset;
    for (let y = 0; y < dstH; y++) {
      const subIdx = Math.max(0, Math.min(subH - 1, Math.trunc(pos)));
      ys[y] = subIdx * yshrink;
      pos += vshrink;
    }
    remVscale = 1.0;
  }

  let remHscale = hscale;
  const xs = new Int32Array(dstW);
  if (hscale < 1.0) {
    const hshrink = 1.0 / hscale;
    const outW = Math.trunc(subW / hshrink + 0.5);
    const extraPixels = fmaDouble(outW, hshrink, -subW);
    const hoffset = (extraPixels + 1.0) * 0.5 - 1.0;
    let pos = fmaDouble(0.5, hshrink, -0.5) - hoffset;
    for (let x = 0; x < dstW; x++) {
      const subIdx = Math.max(0, Math.min(subW - 1, Math.trunc(pos)));
      xs[x] = subIdx * xshrink;
      pos += hshrink;
    }
    remHscale = 1.0;
  }

  if (remHscale > 1.0 || remVscale > 1.0) {
    const isIntZoom = remHscale === Math.floor(remHscale) && remVscale === Math.floor(remVscale);
    if (isIntZoom) {
      if (hscale >= 1.0) {
        const zoomX = Math.floor(remHscale);
        for (let x = 0; x < dstW; x++) {
          xs[x] = Math.max(0, Math.min(subW - 1, Math.floor(x / zoomX))) * xshrink;
        }
      }
      if (vscale >= 1.0) {
        const zoomY = Math.floor(remVscale);
        for (let y = 0; y < dstH; y++) {
          ys[y] = Math.max(0, Math.min(subH - 1, Math.floor(y / zoomY))) * yshrink;
        }
      }
    } else {
      const invDet = 1.0 / (remHscale * remVscale);
      const ia = remVscale * invDet;
      const id = remHscale * invDet;
      if (hscale >= 1.0) {
        let d9 = 1.0;
        for (let x = 0; x < dstW; x++) {
          const subIdx = Math.max(0, Math.min(subW - 1, Math.trunc(d9) - 1));
          xs[x] = subIdx * xshrink;
          d9 += ia;
        }
      }
      if (vscale >= 1.0) {
        for (let y = 0; y < dstH; y++) {
          const d8 = y * id + 1.0;
          const subIdx = Math.max(0, Math.min(subH - 1, Math.trunc(d8) - 1));
          ys[y] = subIdx * yshrink;
        }
      }
    }
  } else {
    if (hscale === 1.0) {
      for (let x = 0; x < dstW; x++) xs[x] = Math.min(subW - 1, x) * xshrink;
    }
    if (vscale === 1.0) {
      for (let y = 0; y < dstH; y++) ys[y] = Math.min(subH - 1, y) * yshrink;
    }
  }
  return { xs, ys };
}

export function resampleRawBitmap(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  kernel: ResizeKernel = "lanczos3"
): Uint8Array {
  if (srcW === dstW && srcH === dstH) {
    return new Uint8Array(src);
  }
  if (kernel === "nearest") {
    const out = new Uint8Array(dstW * dstH * 4);
    const { xs, ys } = computeVipsNearestIndices2D(srcW, srcH, dstW, dstH);
    for (let y = 0; y < dstH; y++) {
      const sy = ys[y]!;
      for (let x = 0; x < dstW; x++) {
        const sx = xs[x]!;
        const sIdx = (sy * srcW + sx) * 4;
        const dIdx = (y * dstW + x) * 4;
        out[dIdx] = src[sIdx]!;
        out[dIdx + 1] = src[sIdx + 1]!;
        out[dIdx + 2] = src[sIdx + 2]!;
        out[dIdx + 3] = src[sIdx + 3]!;
      }
    }
    return out;
  }

  const radius = kernelRadius(kernel);
  // Pass 1: Horizontal resample (srcW x srcH -> dstW x srcH) in premultiplied float
  const temp = new Float32Array(dstW * srcH * 4);
  const scaleX = srcW / dstW;
  const isUpscaleX = dstW > srcW;
  const effKernelX: ResizeKernel =
    isUpscaleX && (kernel === "mitchell" || kernel === "lanczos2" || kernel === "lanczos3")
      ? "cubic"
      : kernel;
  const radiusX = kernelRadius(effKernelX);
  const filterScaleX = Math.max(1, scaleX);
  const supportX = radiusX * filterScaleX;

  for (let x = 0; x < dstW; x++) {
    const center = isUpscaleX ? x * scaleX - 0.5 : (x + 0.5) * scaleX - 0.5;
    const left = Math.floor(center - supportX);
    const right = Math.ceil(center + supportX);
    const count = right - left + 1;
    const weights = new Float32Array(count);
    let wSum = 0;
    for (let i = 0; i < count; i++) {
      const w = kernelWeight((left + i - center) / filterScaleX, effKernelX);
      weights[i] = w;
      wSum += w;
    }
    if (wSum !== 0) {
      for (let i = 0; i < count; i++) weights[i]! /= wSum;
    }
    for (let y = 0; y < srcH; y++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      const rowBase = y * srcW;
      for (let i = 0; i < count; i++) {
        const w = weights[i]!;
        const sx = Math.max(0, Math.min(srcW - 1, left + i));
        const sIdx = (rowBase + sx) * 4;
        const a = src[sIdx + 3]! / 255;
        pr += src[sIdx]! * a * w;
        pg += src[sIdx + 1]! * a * w;
        pb += src[sIdx + 2]! * a * w;
        pa += src[sIdx + 3]! * w;
      }
      const tIdx = (y * dstW + x) * 4;
      temp[tIdx] = pr;
      temp[tIdx + 1] = pg;
      temp[tIdx + 2] = pb;
      temp[tIdx + 3] = pa;
    }
  }

  // Pass 2: Vertical resample (dstW x srcH -> dstW x dstH)
  const out = new Uint8Array(dstW * dstH * 4);
  const scaleY = srcH / dstH;
  const isUpscaleY = dstH > srcH;
  const effKernelY: ResizeKernel =
    isUpscaleY && (kernel === "mitchell" || kernel === "lanczos2" || kernel === "lanczos3")
      ? "cubic"
      : kernel;
  const radiusY = kernelRadius(effKernelY);
  const filterScaleY = Math.max(1, scaleY);
  const supportY = radiusY * filterScaleY;

  for (let y = 0; y < dstH; y++) {
    const center = isUpscaleY ? y * scaleY - 0.5 : (y + 0.5) * scaleY - 0.5;
    const top = Math.floor(center - supportY);
    const bottom = Math.ceil(center + supportY);
    const count = bottom - top + 1;
    const weights = new Float32Array(count);
    let wSum = 0;
    for (let i = 0; i < count; i++) {
      const w = kernelWeight((top + i - center) / filterScaleY, effKernelY);
      weights[i] = w;
      wSum += w;
    }
    if (wSum !== 0) {
      for (let i = 0; i < count; i++) weights[i]! /= wSum;
    }
    for (let x = 0; x < dstW; x++) {
      let pr = 0;
      let pg = 0;
      let pb = 0;
      let pa = 0;
      for (let i = 0; i < count; i++) {
        const w = weights[i]!;
        const sy = Math.max(0, Math.min(srcH - 1, top + i));
        const tIdx = (sy * dstW + x) * 4;
        pr += temp[tIdx]! * w;
        pg += temp[tIdx + 1]! * w;
        pb += temp[tIdx + 2]! * w;
        pa += temp[tIdx + 3]! * w;
      }
      const dIdx = (y * dstW + x) * 4;
      const aByte = pa < 0 ? 0 : pa > 255 ? 255 : Math.round(pa);
      if (aByte === 0) {
        out[dIdx] = 0;
        out[dIdx + 1] = 0;
        out[dIdx + 2] = 0;
        out[dIdx + 3] = 0;
      } else {
        const alphaNorm = aByte / 255;
        const r = Math.round(pr / alphaNorm);
        const g = Math.round(pg / alphaNorm);
        const b = Math.round(pb / alphaNorm);
        out[dIdx] = r < 0 ? 0 : r > 255 ? 255 : r;
        out[dIdx + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
        out[dIdx + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
        out[dIdx + 3] = aByte;
      }
    }
  }
  return out;
}

export function resizeImage(
  img: RgbaImage,
  spec: {
    readonly width: number | null;
    readonly height: number | null;
    readonly fit: ResizeFit;
    readonly position: GravityPosition;
    readonly kernel: ResizeKernel;
    readonly background: RgbaColor;
    readonly withoutEnlargement: boolean;
    readonly withoutReduction: boolean;
  }
): RgbaImage {
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight) {
    const pages = img.pages;
    const pageH = img.pageHeight;
    const pageBytes = img.width * pageH * 4;
    const resizedPages: RgbaImage[] = [];
    for (let p = 0; p < pages; p++) {
      const singlePage: RgbaImage = {
        ...img,
        height: pageH,
        pages: 1,
        pageHeight: pageH,
        data: img.data.subarray(p * pageBytes, (p + 1) * pageBytes)
      };
      resizedPages.push(resizeImage(singlePage, spec));
    }
    const first = resizedPages[0]!;
    const outW = first.width;
    const outPageH = first.height;
    const outData = new Uint8Array(outW * outPageH * pages * 4);
    for (let p = 0; p < pages; p++) {
      outData.set(resizedPages[p]!.data, p * outW * outPageH * 4);
    }
    return {
      ...first,
      width: outW,
      height: outPageH * pages,
      pages,
      pageHeight: outPageH,
      data: outData
    };
  }
  const srcW = img.width;
  const srcH = img.height;
  if (spec.width === null && spec.height === null) {
    return img;
  }

  const isFill = spec.fit === "fill";
  let targetW =
    spec.width ?? (isFill ? srcW : Math.max(1, Math.round((srcW * spec.height!) / srcH)));
  let targetH =
    spec.height ?? (isFill ? srcH : Math.max(1, Math.round((srcH * spec.width!) / srcW)));
  const bothSpecified = (spec.width !== null && spec.height !== null) || isFill;
  const fit: ResizeFit = bothSpecified ? spec.fit : "inside";

  const clampScale = (w: number, h: number): [number, number] => {
    let rw = w;
    let rh = h;
    if (spec.withoutEnlargement && (rw > srcW || rh > srcH)) {
      const ratio = Math.min(srcW / rw, srcH / rh, 1);
      rw = Math.max(1, Math.round(rw * ratio));
      rh = Math.max(1, Math.round(rh * ratio));
    }
    if (spec.withoutReduction && (rw < srcW || rh < srcH)) {
      const ratio = Math.max(srcW / rw, srcH / rh, 1);
      rw = Math.max(1, Math.round(rw * ratio));
      rh = Math.max(1, Math.round(rh * ratio));
    }
    return [rw, rh];
  };

  if (fit === "fill") {
    let rw = targetW;
    let rh = targetH;
    if (spec.withoutEnlargement) {
      rw = Math.min(rw, srcW);
      rh = Math.min(rh, srcH);
    }
    if (spec.withoutReduction) {
      rw = Math.max(rw, srcW);
      rh = Math.max(rh, srcH);
    }
    const data = resampleRawBitmap(img.data, srcW, srcH, rw, rh, spec.kernel);
    return { ...img, width: rw, height: rh, data };
  }

  if (fit === "inside" || fit === "outside") {
    const scaleX = targetW / srcW;
    const scaleY = targetH / srcH;
    const scale = fit === "inside" ? Math.min(scaleX, scaleY) : Math.max(scaleX, scaleY);
    const [rw, rh] = clampScale(
      Math.max(1, Math.round(srcW * scale)),
      Math.max(1, Math.round(srcH * scale))
    );
    const data = resampleRawBitmap(img.data, srcW, srcH, rw, rh, spec.kernel);
    return { ...img, width: rw, height: rh, data };
  }

  if (fit === "cover") {
    if (spec.withoutEnlargement && (targetW > srcW || targetH > srcH)) {
      targetW = Math.min(targetW, srcW);
      targetH = Math.min(targetH, srcH);
    }
    if (spec.withoutReduction && (targetW < srcW || targetH < srcH)) {
      targetW = Math.max(targetW, srcW);
      targetH = Math.max(targetH, srcH);
    }
    let scale = Math.max(targetW / srcW, targetH / srcH);
    if (spec.withoutEnlargement) scale = Math.min(1, scale);
    if (spec.withoutReduction) scale = Math.max(1, scale);
    const scaledW = Math.max(targetW, Math.round(srcW * scale));
    const scaledH = Math.max(targetH, Math.round(srcH * scale));
    const scaledData = resampleRawBitmap(img.data, srcW, srcH, scaledW, scaledH, spec.kernel);
    const pos = typeof spec.position === "string" ? spec.position.toLowerCase() : spec.position;
    const offset =
      pos === "entropy" || pos === 16
        ? smartcropEntropy(scaledData, scaledW, scaledH, targetW, targetH)
        : pos === "attention" || pos === 17
          ? smartcropAttention(scaledData, scaledW, scaledH, targetW, targetH)
          : resolveGravityOffset(scaledW, scaledH, targetW, targetH, spec.position, true);
    const cropped = new Uint8Array(targetW * targetH * 4);
    for (let y = 0; y < targetH; y++) {
      const srcRow = ((offset.y + y) * scaledW + offset.x) * 4;
      cropped.set(scaledData.subarray(srcRow, srcRow + targetW * 4), y * targetW * 4);
    }
    return { ...img, width: targetW, height: targetH, data: cropped };
  }

  // fit === "contain"
  if (spec.withoutReduction && (targetW < srcW || targetH < srcH)) {
    targetW = Math.max(targetW, srcW);
    targetH = Math.max(targetH, srcH);
  }
  let scale = Math.min(targetW / srcW, targetH / srcH);
  if (spec.withoutEnlargement) scale = Math.min(1, scale);
  if (spec.withoutReduction) scale = Math.max(1, scale);
  const innerW = Math.min(targetW, Math.max(1, Math.round(srcW * scale)));
  const innerH = Math.min(targetH, Math.max(1, Math.round(srcH * scale)));
  const scaledData = resampleRawBitmap(img.data, srcW, srcH, innerW, innerH, spec.kernel);
  const canvas = new Uint8Array(targetW * targetH * 4);
  const bg = spec.background;
  for (let i = 0; i < targetW * targetH; i++) {
    canvas[i * 4] = bg.r;
    canvas[i * 4 + 1] = bg.g;
    canvas[i * 4 + 2] = bg.b;
    canvas[i * 4 + 3] = bg.a;
  }
  const offset = resolveGravityOffset(targetW, targetH, innerW, innerH, spec.position);
  for (let y = 0; y < innerH; y++) {
    const srcRow = y * innerW * 4;
    const dstRow = ((offset.y + y) * targetW + offset.x) * 4;
    canvas.set(scaledData.subarray(srcRow, srcRow + innerW * 4), dstRow);
  }
  const nextHasAlpha = img.hasAlpha || bg.a < 255;
  return {
    ...img,
    width: targetW,
    height: targetH,
    data: canvas,
    hasAlpha: nextHasAlpha,
    channels: nextHasAlpha ? (img.channels < 3 ? 2 : 4) : img.channels
  };
}
