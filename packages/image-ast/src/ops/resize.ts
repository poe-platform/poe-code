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
    case "bilinear":
      return ax < 1 ? 1 - ax : 0;
    case "cubic":
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
  position: GravityPosition = "center"
): { readonly x: number; readonly y: number } {
  const dx = outerW - innerW;
  const dy = outerH - innerH;
  const p = position.toLowerCase();
  let x = Math.floor(dx / 2);
  let y = Math.floor(dy / 2);

  if (p.includes("west") || p.includes("left")) x = 0;
  else if (p.includes("east") || p.includes("right")) x = dx;

  if (p.includes("north") || p.includes("top")) y = 0;
  else if (p.includes("south") || p.includes("bottom")) y = dy;

  return { x, y };
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
    for (let y = 0; y < dstH; y++) {
      const sy = Math.min(srcH - 1, Math.floor(((y + 0.5) * srcH) / dstH));
      for (let x = 0; x < dstW; x++) {
        const sx = Math.min(srcW - 1, Math.floor(((x + 0.5) * srcW) / dstW));
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
  const filterScaleX = Math.max(1, scaleX);
  const supportX = radius * filterScaleX;

  for (let x = 0; x < dstW; x++) {
    const center = (x + 0.5) * scaleX - 0.5;
    const left = Math.max(0, Math.floor(center - supportX));
    const right = Math.min(srcW - 1, Math.ceil(center + supportX));
    const count = right - left + 1;
    const weights = new Float32Array(count);
    let wSum = 0;
    for (let i = 0; i < count; i++) {
      const w = kernelWeight((left + i - center) / filterScaleX, kernel);
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
        const sIdx = (rowBase + left + i) * 4;
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
  const filterScaleY = Math.max(1, scaleY);
  const supportY = radius * filterScaleY;

  for (let y = 0; y < dstH; y++) {
    const center = (y + 0.5) * scaleY - 0.5;
    const top = Math.max(0, Math.floor(center - supportY));
    const bottom = Math.min(srcH - 1, Math.ceil(center + supportY));
    const count = bottom - top + 1;
    const weights = new Float32Array(count);
    let wSum = 0;
    for (let i = 0; i < count; i++) {
      const w = kernelWeight((top + i - center) / filterScaleY, kernel);
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
        const tIdx = ((top + i) * dstW + x) * 4;
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
  const srcW = img.width;
  const srcH = img.height;
  if (spec.width === null && spec.height === null) {
    return img;
  }

  let targetW = spec.width ?? Math.max(1, Math.round((srcW * spec.height!) / srcH));
  let targetH = spec.height ?? Math.max(1, Math.round((srcH * spec.width!) / srcW));
  const bothSpecified = spec.width !== null && spec.height !== null;
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
    const [rw, rh] = clampScale(targetW, targetH);
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
    const scale = Math.max(targetW / srcW, targetH / srcH);
    const scaledW = Math.max(targetW, Math.round(srcW * scale));
    const scaledH = Math.max(targetH, Math.round(srcH * scale));
    const scaledData = resampleRawBitmap(img.data, srcW, srcH, scaledW, scaledH, spec.kernel);
    const offset = resolveGravityOffset(scaledW, scaledH, targetW, targetH, spec.position);
    const cropped = new Uint8Array(targetW * targetH * 4);
    for (let y = 0; y < targetH; y++) {
      const srcRow = ((offset.y + y) * scaledW + offset.x) * 4;
      cropped.set(scaledData.subarray(srcRow, srcRow + targetW * 4), y * targetW * 4);
    }
    return { ...img, width: targetW, height: targetH, data: cropped };
  }

  // fit === "contain"
  if (spec.withoutEnlargement && (targetW > srcW || targetH > srcH)) {
    targetW = Math.min(targetW, srcW);
    targetH = Math.min(targetH, srcH);
  }
  if (spec.withoutReduction && (targetW < srcW || targetH < srcH)) {
    targetW = Math.max(targetW, srcW);
    targetH = Math.max(targetH, srcH);
  }
  const scale = Math.min(targetW / srcW, targetH / srcH);
  const [innerW, innerH] = clampScale(
    Math.max(1, Math.round(srcW * scale)),
    Math.max(1, Math.round(srcH * scale))
  );
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
    for (let x = 0; x < innerW; x++) {
      const sIdx = (y * innerW + x) * 4;
      const dIdx = ((offset.y + y) * targetW + (offset.x + x)) * 4;
      const srcA = scaledData[sIdx + 3]! / 255;
      const dstA = canvas[dIdx + 3]! / 255;
      const outA = srcA + dstA * (1 - srcA);
      if (outA > 0) {
        canvas[dIdx] = Math.round(
          (scaledData[sIdx]! * srcA + canvas[dIdx]! * dstA * (1 - srcA)) / outA
        );
        canvas[dIdx + 1] = Math.round(
          (scaledData[sIdx + 1]! * srcA + canvas[dIdx + 1]! * dstA * (1 - srcA)) / outA
        );
        canvas[dIdx + 2] = Math.round(
          (scaledData[sIdx + 2]! * srcA + canvas[dIdx + 2]! * dstA * (1 - srcA)) / outA
        );
        canvas[dIdx + 3] = Math.round(outA * 255);
      }
    }
  }
  return {
    ...img,
    width: targetW,
    height: targetH,
    data: canvas,
    hasAlpha: img.hasAlpha || bg.a < 255
  };
}
