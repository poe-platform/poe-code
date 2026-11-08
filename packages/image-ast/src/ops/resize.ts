import {EntropyHistogram} from "./resize-crop.js";
import {fmaDouble,buildVipsReduceTable,VIPS_BICUBIC_TABLE,nearestCoordinates,resizeScale,type ResizeSpec} from "./resize-math.js";
import type {
  GravityPosition,
  ResizeFit,
  ResizeKernel,
  RgbaColor,
  RgbaImage
} from "../ast.js";

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

function *regionEntropySteps(
  rgba: Uint8Array,
  imgW: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number,
  channels = 3,
  hasAlpha = false
): Generator<void, number, void> {
  let work = 0;
  const total = rw * rh;
  if (total <= 0) return 0;
  const histogram=new EntropyHistogram(channels,hasAlpha);
  for (let y = ry; y < ry + rh; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = rx; x < rx + rw; x++) {
    if (++work % 16384 === 0) yield;
      const idx = (y * imgW + x) * 4;
      histogram.add(rgba[idx]!,rgba[idx+1]!,rgba[idx+2]!,rgba[idx+3]!);
    }
  }
  return histogram.entropy();
}

function *smartcropEntropySteps(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  channels = 3,
  hasAlpha = false
): Generator<void, { readonly x: number; readonly y: number }, void> {
  let work = 0;
  let left = 0;
  let top = 0;
  let width = srcW;
  let height = srcH;
  const maxSlice = Math.max(1, Math.max(Math.ceil((srcW - dstW) / 8), Math.ceil((srcH - dstH) / 8)));
  while (width > dstW || height > dstH) {
    if (++work % 16384 === 0) yield;
    const sliceW = Math.min(width - dstW, maxSlice);
    const sliceH = Math.min(height - dstH, maxSlice);
    if (sliceW > 0) {
      const eLeft = (yield* regionEntropySteps(rgba, srcW, left, top, sliceW, height, channels, hasAlpha));
      const eRight = (yield* regionEntropySteps(rgba, srcW, left + width - sliceW, top, sliceW, height, channels, hasAlpha));
      width -= sliceW;
      if (eLeft < eRight) {
        left += sliceW;
      }
    }
    if (sliceH > 0) {
      const eTop = (yield* regionEntropySteps(rgba, srcW, left, top, width, sliceH, channels, hasAlpha));
      const eBottom = (yield* regionEntropySteps(rgba, srcW, left, top + height - sliceH, width, sliceH, channels, hasAlpha));
      height -= sliceH;
      if (eTop < eBottom) {
        top += sliceH;
      }
    }
  }
  return { x: left, y: top };
}

function *smartcropAttentionSteps(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  hasAlpha = false
): Generator<void, { readonly x: number; readonly y: number }, void> {
  const hscale = 32.0 / srcW;
  const vscale = 32.0 / srcH;
  const rgba32 = (yield* resampleRawBitmapSteps(rgba, srcW, srcH, 32, 32, "lanczos3", hscale, vscale));
  return yield* attentionCropSteps(rgba32,srcW,srcH,dstW,dstH,hasAlpha);
}

/** Scores a fixed 32 by 32 thumbnail, shared by buffered and backed crops. */
export function *attentionCropSteps(rgba32:Uint8Array,srcW:number,srcH:number,dstW:number,dstH:number,hasAlpha:boolean):Generator<void,{readonly x:number;readonly y:number},void> {
  let work=0;
  const hscale=32/srcW,vscale=32/srcH;
  const X = new Float32Array(32 * 32);
  const Y = new Float32Array(32 * 32);
  const Z = new Float32Array(32 * 32);
  const lin = (c: number): number => {
    const v = c / 255.0;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const fLab = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16.0 / 116.0);
  for (let i = 0; i < 32 * 32; i++) {
    if (++work % 16384 === 0) yield;
    const idx = i * 4;
    let r = rgba32[idx]!;
    let g = rgba32[idx + 1]!;
    let b = rgba32[idx + 2]!;
    if (hasAlpha) {
      const af = Math.fround(rgba32[idx + 3]! / 255.0);
      r = Math.trunc(Math.fround(r * af));
      g = Math.trunc(Math.fround(g * af));
      b = Math.trunc(Math.fround(b * af));
    }
    const rl = lin(r);
    const gl = lin(g);
    const bl = lin(b);
    X[i] = 41.24 * rl + 35.76 * gl + 18.05 * bl;
    Y[i] = 21.26 * rl + 71.52 * gl + 7.22 * bl;
    Z[i] = 1.93 * rl + 11.92 * gl + 95.05 * bl;
  }

  const sumMap = new Float32Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < 32; x++) {
    if (++work % 16384 === 0) yield;
      const i = y * 32 + x;
      let conv = 8.0 * Y[i]!;
      for (let ky = -1; ky <= 1; ky++) {
    if (++work % 16384 === 0) yield;
        for (let kx = -1; kx <= 1; kx++) {
    if (++work % 16384 === 0) yield;
          if (kx === 0 && ky === 0) continue;
          const sy = Math.max(0, Math.min(31, y + ky));
          const sx = Math.max(0, Math.min(31, x + kx));
          conv -= Y[sy * 32 + sx]!;
        }
      }
      const edge = Math.abs(5.0 * conv);
      const yVal = Y[i]!;
      let skin = 0;
      let sat = 0;
      if (yVal > 5.0) {
        const norm = Math.hypot(X[i]!, Y[i]!, Z[i]!);
        const dx = (norm > 0 ? X[i]! / norm : 0) - 0.78;
        const dy = (norm > 0 ? Y[i]! / norm : 0) - 0.57;
        const dz = (norm > 0 ? Z[i]! / norm : 0) - 0.44;
        skin = 100.0 - 100.0 * Math.hypot(dx, dy, dz);
        sat = 500.0 * (fLab(X[i]! / 95.047) - fLab(Y[i]! / 100.0));
      }
      sumMap[i] = edge + skin + sat;
    }
  }

  const sigma = Math.max(1.0, Math.hypot(hscale * dstW, vscale * dstH) / 10.0);
  const twoSigmaSq = 2 * sigma * sigma;
  let rIdx = 0;
  while (rIdx < 50 && Math.exp(-(rIdx * rIdx) / twoSigmaSq) >= 0.2) { if (++work % 16384 === 0) yield; rIdx++; }
  const radius = Math.max(1, rIdx) - 1;
  const size = radius * 2 + 1;
  const kernel = new Float64Array(size);
  let kSum = 0;
  for (let i = -radius; i <= radius; i++) {
    if (++work % 16384 === 0) yield;
    const w = Math.round(20.0 * Math.exp(-(i * i) / twoSigmaSq));
    kernel[i + radius] = w;
    kSum += w;
  }
  const tmp = new Float32Array(32 * 32);
  for (let y = 0; y < 32; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < 32; x++) {
    if (++work % 16384 === 0) yield;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
        const sx = Math.max(0, Math.min(31, x + k));
        acc += sumMap[y * 32 + sx]! * kernel[k + radius]!;
      }
      tmp[y * 32 + x] = acc / kSum;
    }
  }
  let maxVal = -Infinity;
  let maxX = 0;
  let maxY = 0;
  for (let y = 0; y < 32; y++) {
    if (++work % 16384 === 0) yield;
    for (let x = 0; x < 32; x++) {
    if (++work % 16384 === 0) yield;
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
    if (++work % 16384 === 0) yield;
        const sy = Math.max(0, Math.min(31, y + k));
        acc += tmp[sy * 32 + x]! * kernel[k + radius]!;
      }
      const val = acc / kSum;
      if (val > maxVal) {
        maxVal = val;
        maxX = x;
        maxY = y;
      }
    }
  }
  const attX = Math.trunc(maxX / hscale);
  const attY = Math.trunc(maxY / vscale);
  const left = Math.max(0, Math.min(srcW - dstW, attX - (dstW >> 1)));
  const top = Math.max(0, Math.min(srcH - dstH, attY - (dstH >> 1)));
  return { x: left, y: top };
}

function *computeVipsNearestIndices2DSteps(srcW:number,srcH:number,dstW:number,dstH:number,explicitHscale?:number,explicitVscale?:number):Generator<void,{readonly xs:Int32Array;readonly ys:Int32Array},void> {
  const coordinates=nearestCoordinates(srcW,srcH,dstW,dstH,explicitHscale,explicitVscale);
  const xs=new Int32Array(dstW),ys=new Int32Array(dstH);
  let work=0,index=0;
  for(const value of coordinates.x()) {if(++work%16384===0) yield;xs[index++]=value;}
  index=0;
  for(const value of coordinates.y()) {if(++work%16384===0) yield;ys[index++]=value;}
  return {xs,ys};
}

function *shrinkVBoxSteps(
  src: Uint8Array,
  w: number,
  h: number,
  vshrink: number
): Generator<void, { readonly data: Uint8Array; readonly h: number }, void> {
  let work = 0;
  const outH = Math.ceil(h / vshrink);
  const out = new Uint8Array(new ArrayBuffer(w * outH * 4 + outH), 0, w * outH * 4);
  const roundAdd = vshrink >> 1;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < w; x++) {
      if (++work % 16384 === 0) yield;
      let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
      for (let k = 0; k < vshrink; k++) {
        const sy = Math.min(h - 1, y * vshrink + k);
        const sIdx = (sy * w + x) * 4;
        sum0 += src[sIdx]!;
        sum1 += src[sIdx + 1]!;
        sum2 += src[sIdx + 2]!;
        sum3 += src[sIdx + 3]!;
      }
      const dIdx = (y * w + x) * 4;
      out[dIdx] = Math.floor((sum0 + roundAdd) / vshrink);
      out[dIdx + 1] = Math.floor((sum1 + roundAdd) / vshrink);
      out[dIdx + 2] = Math.floor((sum2 + roundAdd) / vshrink);
      out[dIdx + 3] = Math.floor((sum3 + roundAdd) / vshrink);
    }
  }
  return { data: out, h: outH };
}

function *shrinkHBoxSteps(
  src: Uint8Array,
  w: number,
  h: number,
  hshrink: number
): Generator<void, { readonly data: Uint8Array; readonly w: number }, void> {
  let work = 0;
  const outW = Math.ceil(w / hshrink);
  const out = new Uint8Array(new ArrayBuffer(outW * h * 4 + h), 0, outW * h * 4);
  const roundAdd = hshrink >> 1;
  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    const dstRowOff = y * outW * 4;
    for (let x = 0; x < outW; x++) {
      if (++work % 16384 === 0) yield;
      let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
      for (let k = 0; k < hshrink; k++) {
        const sx = Math.min(w - 1, x * hshrink + k);
        const sIdx = rowOff + sx * 4;
        sum0 += src[sIdx]!;
        sum1 += src[sIdx + 1]!;
        sum2 += src[sIdx + 2]!;
        sum3 += src[sIdx + 3]!;
      }
      const dIdx = dstRowOff + x * 4;
      out[dIdx] = Math.floor((sum0 + roundAdd) / hshrink);
      out[dIdx + 1] = Math.floor((sum1 + roundAdd) / hshrink);
      out[dIdx + 2] = Math.floor((sum2 + roundAdd) / hshrink);
      out[dIdx + 3] = Math.floor((sum3 + roundAdd) / hshrink);
    }
  }
  return { data: out, w: outW };
}

export function *resampleRawBitmapSteps(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  kernel: ResizeKernel = "lanczos3",
  explicitHscale?: number,
  explicitVscale?: number,
  alreadyPremultiplied = false
): Generator<void, Uint8Array, void> {
  let work = 0;
  if (srcW === dstW && srcH === dstH && (explicitHscale === undefined || explicitHscale === 1.0) && (explicitVscale === undefined || explicitVscale === 1.0)) {
    return new Uint8Array(src);
  }

  let hasSemiTransparentAlpha = false;
  if (!alreadyPremultiplied) {
    for (let i = 3; i < src.length; i += 4) {
    if (++work % 16384 === 0) yield;
      if (src[i]! < 255) {
        hasSemiTransparentAlpha = true;
        break;
      }
    }
  }

  let cur = src;
  if (hasSemiTransparentAlpha) {
    const pre = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
    if (++work % 16384 === 0) yield;
      const a = src[i + 3]!;
      const af = Math.fround(a / 255.0);
      pre[i] = Math.max(0, Math.min(255, Math.trunc(Math.fround(src[i]! * af))));
      pre[i + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(src[i + 1]! * af))));
      pre[i + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(src[i + 2]! * af))));
      pre[i + 3] = a;
    }
    cur = pre;
  }

  if (kernel === "nearest") {
    const out = new Uint8Array(new ArrayBuffer(dstW * dstH * 4 + dstH), 0, dstW * dstH * 4);
    const { xs, ys } = (yield* computeVipsNearestIndices2DSteps(srcW, srcH, dstW, dstH, explicitHscale, explicitVscale));
    for (let y = 0; y < dstH; y++) {
    if (++work % 16384 === 0) yield;
      const sy = ys[y]!;
      for (let x = 0; x < dstW; x++) {
    if (++work % 16384 === 0) yield;
        const sx = xs[x]!;
        const sIdx = (sy * srcW + sx) * 4;
        const dIdx = (y * dstW + x) * 4;
        out[dIdx] = cur[sIdx]!;
        out[dIdx + 1] = cur[sIdx + 1]!;
        out[dIdx + 2] = cur[sIdx + 2]!;
        out[dIdx + 3] = cur[sIdx + 3]!;
      }
    }
    cur = out;
  } else {
    let w = srcW;
    let h = srcH;
    const hscale = explicitHscale ?? 1.0 / (srcW / dstW);
    const vscale = explicitVscale ?? 1.0 / (srcH / dstH);
    const targetW = Math.trunc(fmaDouble(srcW, hscale, 0.5));
    const targetH = Math.trunc(fmaDouble(srcH, vscale, 0.5));

    let remVscale = vscale;
    if (vscale < 1.0) {
      let vshrink = 1.0 / vscale;
      let extraPixels = fmaDouble(targetH, vshrink, -h);
      const intVshrink = Math.max(1, Math.floor((h / targetH) / 2.0));
      if (intVshrink > 1) {
        const res = (yield* shrinkVBoxSteps(cur, w, h, intVshrink));
        cur = res.data;
        h = res.h;
        vshrink /= intVshrink;
        extraPixels /= intVshrink;
      }
      if (vshrink > 1.0) {
        const { nPoint, table } = buildVipsReduceTable(vshrink, kernel);
        const topPad = Math.ceil(nPoint * 0.5) - 1;
        const voffset = (extraPixels + 1.0) * 0.5 - 1.0;
        const out = new Uint8Array(new ArrayBuffer(w * targetH * 4 + targetH), 0, w * targetH * 4);
        let Y = fmaDouble(0.5, vshrink, -0.5) - voffset;
        const rowOffsets = new Int32Array(nPoint);
        for (let y = 0; y < targetH; y++) {
          const iy = Math.trunc(Y);
          const ty = ((Math.trunc(Y * 128.0) & 127) + 1) >> 1;
          const wRow = ty * nPoint;
          for (let j = 0; j < nPoint; j++) {
            rowOffsets[j] = Math.max(0, Math.min(h - 1, iy + j - topPad)) * w * 4;
          }
          const dstRowOff = y * w * 4;
          for (let x = 0; x < w; x++) {
            if (++work % 16384 === 0) yield;
            const xOff = x * 4;
            let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
            for (let j = 0; j < nPoint; j++) {
              const wt = table[wRow + j]!;
              const sIdx = rowOffsets[j]! + xOff;
              sum0 += cur[sIdx]! * wt;
              sum1 += cur[sIdx + 1]! * wt;
              sum2 += cur[sIdx + 2]! * wt;
              sum3 += cur[sIdx + 3]! * wt;
            }
            const dIdx = dstRowOff + xOff;
            out[dIdx] = Math.max(0, Math.min(255, (sum0 + 2048) >> 12));
            out[dIdx + 1] = Math.max(0, Math.min(255, (sum1 + 2048) >> 12));
            out[dIdx + 2] = Math.max(0, Math.min(255, (sum2 + 2048) >> 12));
            out[dIdx + 3] = Math.max(0, Math.min(255, (sum3 + 2048) >> 12));
          }
          Y += vshrink;
        }
        cur = out;
        h = targetH;
      }
      remVscale = 1.0;
    }

    let remHscale = hscale;
    if (hscale < 1.0) {
      let hshrink = 1.0 / hscale;
      let extraPixels = fmaDouble(targetW, hshrink, -w);
      const intHshrink = Math.max(1, Math.floor((w / targetW) / 2.0));
      if (intHshrink > 1) {
        const res = (yield* shrinkHBoxSteps(cur, w, h, intHshrink));
        cur = res.data;
        w = res.w;
        hshrink /= intHshrink;
        extraPixels /= intHshrink;
      }
      if (hshrink > 1.0) {
        const { nPoint, table } = buildVipsReduceTable(hshrink, kernel);
        const leftPad = Math.ceil(nPoint * 0.5) - 1;
        const hoffset = (extraPixels + 1.0) * 0.5 - 1.0;
        const out = new Uint8Array(new ArrayBuffer(targetW * h * 4 + h), 0, targetW * h * 4);
        const colOffsets = new Int32Array(nPoint);
        let X = fmaDouble(0.5, hshrink, -0.5) - hoffset;
        for (let x = 0; x < targetW; x++) {
          const ix = Math.trunc(X);
          const tx = ((Math.trunc(X * 128.0) & 127) + 1) >> 1;
          const wRow = tx * nPoint;
          for (let j = 0; j < nPoint; j++) {
            colOffsets[j] = Math.max(0, Math.min(w - 1, ix + j - leftPad)) * 4;
          }
          const dstColOff = x * 4;
          for (let y = 0; y < h; y++) {
            if (++work % 16384 === 0) yield;
            const srcRowOff = y * w * 4;
            let sum0 = 0, sum1 = 0, sum2 = 0, sum3 = 0;
            for (let j = 0; j < nPoint; j++) {
              const wt = table[wRow + j]!;
              const sIdx = srcRowOff + colOffsets[j]!;
              sum0 += cur[sIdx]! * wt;
              sum1 += cur[sIdx + 1]! * wt;
              sum2 += cur[sIdx + 2]! * wt;
              sum3 += cur[sIdx + 3]! * wt;
            }
            const dIdx = y * targetW * 4 + dstColOff;
            out[dIdx] = Math.max(0, Math.min(255, (sum0 + 2048) >> 12));
            out[dIdx + 1] = Math.max(0, Math.min(255, (sum1 + 2048) >> 12));
            out[dIdx + 2] = Math.max(0, Math.min(255, (sum2 + 2048) >> 12));
            out[dIdx + 3] = Math.max(0, Math.min(255, (sum3 + 2048) >> 12));
          }
          X += hshrink;
        }
        cur = out;
        w = targetW;
      }
      remHscale = 1.0;
    }

    if (remHscale > 1.0 || remVscale > 1.0) {
      const out = new Uint8Array(new ArrayBuffer(dstW * dstH * 4 + dstH), 0, dstW * dstH * 4);
      const invDet = 1.0 / (remHscale * remVscale);
      const ia = remVscale * invDet;
      const id = remHscale * invDet;
      if (kernel === "linear" || kernel === "bilinear") {
        for (let y = 0; y < dstH; y++) {
    if (++work % 16384 === 0) yield;
          const d8 = y * id + 0.5;
          const iy = Math.trunc(d8);
          const sy = Math.trunc((d8 - iy) * 4096.0);
          const y0 = Math.max(0, Math.min(h - 1, iy - 1));
          const y1 = Math.max(0, Math.min(h - 1, iy));
          let d9 = 0.5;
          for (let x = 0; x < dstW; x++) {
    if (++work % 16384 === 0) yield;
            const ix = Math.trunc(d9);
            const sx = Math.trunc((d9 - ix) * 4096.0);
            const x0 = Math.max(0, Math.min(w - 1, ix - 1));
            const x1 = Math.max(0, Math.min(w - 1, ix));
            const c3 = (sy * sx) >> 12;
            const c1 = ((4096 - sy) * sx) >> 12;
            const c2 = sy - c3;
            const c0 = 4096 - sy - c1;
            for (let c = 0; c < 4; c++) {
    if (++work % 16384 === 0) yield;
              const p00 = cur[(y0 * w + x0) * 4 + c]!;
              const p10 = cur[(y0 * w + x1) * 4 + c]!;
              const p01 = cur[(y1 * w + x0) * 4 + c]!;
              const p11 = cur[(y1 * w + x1) * 4 + c]!;
              const val = (c0 * p00 + c1 * p10 + c2 * p01 + c3 * p11 + 2048) >> 12;
              out[(y * dstW + x) * 4 + c] = Math.max(0, Math.min(255, val));
            }
            d9 += ia;
          }
        }
      } else {
        for (let y = 0; y < dstH; y++) {
    if (++work % 16384 === 0) yield;
          const d8 = y * id + 1.5;
          const iy = Math.trunc(d8);
          const ty = ((Math.trunc(d8 * 128.0) & 127) + 1) >> 1;
          const wy0 = VIPS_BICUBIC_TABLE[ty * 4]!;
          const wy1 = VIPS_BICUBIC_TABLE[ty * 4 + 1]!;
          const wy2 = VIPS_BICUBIC_TABLE[ty * 4 + 2]!;
          const wy3 = VIPS_BICUBIC_TABLE[ty * 4 + 3]!;
          const y0 = Math.max(0, Math.min(h - 1, iy - 3));
          const y1 = Math.max(0, Math.min(h - 1, iy - 2));
          const y2 = Math.max(0, Math.min(h - 1, iy - 1));
          const y3 = Math.max(0, Math.min(h - 1, iy));
          let d9 = 1.5;
          for (let x = 0; x < dstW; x++) {
    if (++work % 16384 === 0) yield;
            const ix = Math.trunc(d9);
            const tx = ((Math.trunc(d9 * 128.0) & 127) + 1) >> 1;
            const wx0 = VIPS_BICUBIC_TABLE[tx * 4]!;
            const wx1 = VIPS_BICUBIC_TABLE[tx * 4 + 1]!;
            const wx2 = VIPS_BICUBIC_TABLE[tx * 4 + 2]!;
            const wx3 = VIPS_BICUBIC_TABLE[tx * 4 + 3]!;
            const x0 = Math.max(0, Math.min(w - 1, ix - 3));
            const x1 = Math.max(0, Math.min(w - 1, ix - 2));
            const x2 = Math.max(0, Math.min(w - 1, ix - 1));
            const x3 = Math.max(0, Math.min(w - 1, ix));
            for (let c = 0; c < 4; c++) {
    if (++work % 16384 === 0) yield;
              const r0 =
                (wx0 * cur[(y0 * w + x0) * 4 + c]! +
                  wx1 * cur[(y0 * w + x1) * 4 + c]! +
                  wx2 * cur[(y0 * w + x2) * 4 + c]! +
                  wx3 * cur[(y0 * w + x3) * 4 + c]! +
                  2048) >>
                12;
              const r1 =
                (wx0 * cur[(y1 * w + x0) * 4 + c]! +
                  wx1 * cur[(y1 * w + x1) * 4 + c]! +
                  wx2 * cur[(y1 * w + x2) * 4 + c]! +
                  wx3 * cur[(y1 * w + x3) * 4 + c]! +
                  2048) >>
                12;
              const r2 =
                (wx0 * cur[(y2 * w + x0) * 4 + c]! +
                  wx1 * cur[(y2 * w + x1) * 4 + c]! +
                  wx2 * cur[(y2 * w + x2) * 4 + c]! +
                  wx3 * cur[(y2 * w + x3) * 4 + c]! +
                  2048) >>
                12;
              const r3 =
                (wx0 * cur[(y3 * w + x0) * 4 + c]! +
                  wx1 * cur[(y3 * w + x1) * 4 + c]! +
                  wx2 * cur[(y3 * w + x2) * 4 + c]! +
                  wx3 * cur[(y3 * w + x3) * 4 + c]! +
                  2048) >>
                12;
              const val = (wy0 * r0 + wy1 * r1 + wy2 * r2 + wy3 * r3 + 2048) >> 12;
              out[(y * dstW + x) * 4 + c] = Math.max(0, Math.min(255, val));
            }
            d9 += ia;
          }
        }
      }
      cur = out;
    }
  }

  if (hasSemiTransparentAlpha) {
    const unpre = new Uint8Array(cur.length);
    for (let i = 0; i < cur.length; i += 4) {
    if (++work % 16384 === 0) yield;
      const a = cur[i + 3]!;
      if (a === 0) {
        unpre[i] = 0;
        unpre[i + 1] = 0;
        unpre[i + 2] = 0;
        unpre[i + 3] = 0;
      } else {
        const factor = Math.fround(255.0 / a);
        unpre[i] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * cur[i]!))));
        unpre[i + 1] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * cur[i + 1]!))));
        unpre[i + 2] = Math.max(0, Math.min(255, Math.trunc(Math.fround(factor * cur[i + 2]!))));
        unpre[i + 3] = a;
      }
    }
    cur = unpre;
  }

  return cur;
}

export function *resizeImageSteps(
  img: RgbaImage,
  spec: ResizeSpec,
  postScaleTransform?: (scaled: RgbaImage) => RgbaImage
): Generator<void, RgbaImage, void> {
  let work = 0;
  if (img.pages && img.pages > 1 && img.pageHeight && img.height === img.pages * img.pageHeight) {
    const pages = img.pages;
    const pageH = img.pageHeight;
    const pageBytes = img.width * pageH * 4;
    const resizedPages: RgbaImage[] = [];
    for (let p = 0; p < pages; p++) {
    if (++work % 16384 === 0) yield;
      const singlePage: RgbaImage = {
        ...img,
        height: pageH,
        pages: 1,
        pageHeight: pageH,
        data: img.data.subarray(p * pageBytes, (p + 1) * pageBytes)
      };
      resizedPages.push((yield* resizeImageSteps(singlePage, spec, postScaleTransform)));
    }
    const first = resizedPages[0]!;
    const outW = first.width;
    const outPageH = first.height;
    const outData = new Uint8Array(outW * outPageH * pages * 4);
    for (let p = 0; p < pages; p++) {
    if (++work % 16384 === 0) yield;
      {
 const copySource = resizedPages[p]!.data;
 const copyTargetOffset = p * outW * outPageH * 4;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  outData.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
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

  const {reqW,reqH,hscale,vscale,width,height}=resizeScale(srcW,srcH,spec);
  let scaledW=width,scaledH=height;
  let scaledData = (yield* resampleRawBitmapSteps(
    img.data,
    srcW,
    srcH,
    scaledW,
    scaledH,
    spec.kernel,
    hscale,
    vscale,
    Boolean(img.isPremultiplied)
  ));
  if (postScaleTransform) {
    const transformed = postScaleTransform({ ...img, width: scaledW, height: scaledH, data: scaledData });
    scaledW = transformed.width;
    scaledH = transformed.height;
    scaledData = transformed.data;
  }

  if (reqW > 0 && reqH > 0 && spec.fit === "cover") {
    let targetCropW = reqW;
    let targetCropH = reqH;
    if (spec.withoutEnlargement && (targetCropW > srcW || targetCropH > srcH)) {
      targetCropW = Math.min(targetCropW, srcW);
      targetCropH = Math.min(targetCropH, srcH);
    }
    if (spec.withoutReduction && (targetCropW < srcW || targetCropH < srcH)) {
      targetCropW = Math.max(targetCropW, srcW);
      targetCropH = Math.max(targetCropH, srcH);
    }
    const cropW = Math.min(scaledW, targetCropW);
    const cropH = Math.min(scaledH, targetCropH);
    if (cropW < scaledW || cropH < scaledH) {
      const pos = typeof spec.position === "string" ? spec.position.toLowerCase() : spec.position;
      const offset =
        pos === "entropy" || pos === 16
          ? (yield* smartcropEntropySteps(scaledData, scaledW, scaledH, cropW, cropH, img.channels, img.hasAlpha))
          : pos === "attention" || pos === 17
            ? (yield* smartcropAttentionSteps(scaledData, scaledW, scaledH, cropW, cropH, img.hasAlpha))
            : resolveGravityOffset(scaledW, scaledH, cropW, cropH, spec.position, true);
      const cropped = new Uint8Array(new ArrayBuffer(cropW * cropH * 4 + cropH), 0, cropW * cropH * 4);
      for (let y = 0; y < cropH; y++) {
    if (++work % 16384 === 0) yield;
        const srcRow = ((offset.y + y) * scaledW + offset.x) * 4;
        {
 const copySource = scaledData.subarray(srcRow, srcRow + cropW * 4);
 const copyTargetOffset = y * cropW * 4;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  cropped.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
      }
      return { ...img, width: cropW, height: cropH, data: cropped };
    }
    return { ...img, width: scaledW, height: scaledH, data: scaledData };
  }

  if (reqW > 0 && reqH > 0 && spec.fit === "contain") {
    const embedW = Math.max(scaledW, reqW);
    const embedH = Math.max(scaledH, reqH);
    const bg = spec.background;
    const nextHasAlpha = img.hasAlpha || bg.a < 255;
    if (embedW > scaledW || embedH > scaledH) {
      const canvas = new Uint8Array(new ArrayBuffer(embedW * embedH * 4 + embedH), 0, embedW * embedH * 4);
      const bgR = img.isPremultiplied ? Math.trunc(Math.fround(bg.r * Math.fround(bg.a / 255.0))) : bg.r;
      const bgG = img.isPremultiplied ? Math.trunc(Math.fround(bg.g * Math.fround(bg.a / 255.0))) : bg.g;
      const bgB = img.isPremultiplied ? Math.trunc(Math.fround(bg.b * Math.fround(bg.a / 255.0))) : bg.b;
      for (let i = 0; i < embedW * embedH; i++) {
    if (++work % 16384 === 0) yield;
        canvas[i * 4] = bgR;
        canvas[i * 4 + 1] = bgG;
        canvas[i * 4 + 2] = bgB;
        canvas[i * 4 + 3] = bg.a;
      }
      const offset = resolveGravityOffset(embedW, embedH, scaledW, scaledH, spec.position, false);
      for (let y = 0; y < scaledH; y++) {
    if (++work % 16384 === 0) yield;
        const srcRow = y * scaledW * 4;
        const dstRow = ((offset.y + y) * embedW + offset.x) * 4;
        {
 const copySource = scaledData.subarray(srcRow, srcRow + scaledW * 4);
 const copyTargetOffset = dstRow;
 for (let copyOffset = 0; copyOffset < copySource.length; copyOffset += 65536) {
  const copyEnd = Math.min(copySource.length, copyOffset + 65536);
  canvas.set(copySource.subarray(copyOffset, copyEnd), copyTargetOffset + copyOffset);
  work += (copyEnd - copyOffset) / 4;
  if (work >= 16384) { work %= 16384; yield; }
 }
}
      }
      return {
        ...img,
        width: embedW,
        height: embedH,
        data: canvas,
        hasAlpha: nextHasAlpha,
        channels: nextHasAlpha ? (img.channels < 3 ? 2 : 4) : img.channels
      };
    }
    return {
      ...img,
      width: scaledW,
      height: scaledH,
      data: scaledData,
      hasAlpha: nextHasAlpha,
      channels: nextHasAlpha ? (img.channels < 3 ? 2 : 4) : img.channels
    };
  }

  return { ...img, width: scaledW, height: scaledH, data: scaledData };
}

export function resampleRawBitmap(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  kernel: ResizeKernel = "lanczos3",
  explicitHscale?: number,
  explicitVscale?: number,
  alreadyPremultiplied = false
): Uint8Array {
  const steps = resampleRawBitmapSteps(src, srcW, srcH, dstW, dstH, kernel, explicitHscale, explicitVscale, alreadyPremultiplied);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
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
  },
  postScaleTransform?: (scaled: RgbaImage) => RgbaImage
): RgbaImage {
  const steps = resizeImageSteps(img, spec, postScaleTransform);
  let next = steps.next();
  while (!next.done) next = steps.next();
  return next.value;
}
