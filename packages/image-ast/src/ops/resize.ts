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
  dstH: number,
  explicitHscale?: number,
  explicitVscale?: number
): { readonly xs: Int32Array; readonly ys: Int32Array } {
  let hscale = explicitHscale ?? 1.0 / (srcW / dstW);
  let vscale = explicitVscale ?? 1.0 / (srcH / dstH);
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

function rintEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - r) === 0.5) return r % 2 === 0 ? r : r - 1;
  return r;
}

function buildVipsReduceTable(
  shrink: number,
  kernel: ResizeKernel
): { readonly nPoint: number; readonly table: Int32Array } {
  const mult =
    kernel === "linear" || kernel === "bilinear" ? 1.0 : kernel === "lanczos3" ? 3.0 : 2.0;
  const nPoint = 2 * rintEven(mult * shrink) + 1;
  const table = new Int32Array(65 * nPoint);
  const wf = new Float64Array(nPoint);
  for (let k = 0; k < 65; k++) {
    const s = Math.fround(k * Math.fround(1.0 / 64.0));
    const d15 = nPoint * 0.5 + s - 1.0;
    let sum = 0.0;
    for (let j = 0; j < nPoint; j++) {
      const x = (j - d15) / shrink;
      const v = kernelWeight(x, kernel);
      wf[j] = v;
      sum += v;
    }
    for (let j = 0; j < nPoint; j++) {
      table[k * nPoint + j] = Math.trunc((wf[j]! / sum) * 4096.0);
    }
  }
  return { nPoint, table };
}

const VIPS_BICUBIC_TABLE = (() => {
  const t = new Int32Array(65 * 4);
  for (let k = 0; k < 64; k++) {
    const s = Math.fround(k * Math.fround(1.0 / 64.0));
    const u = Math.fround(1.0 - s);
    const t0 = Math.fround(Math.fround(-0.5 * s) * u);
    const c0 = Math.fround(t0 * u);
    const c3 = Math.fround(t0 * s);
    const diff = Math.fround(c3 - c0);
    const c1 = Math.fround(Math.fround(u - c0) + diff);
    const c2 = Math.fround(Math.fround(s - c3) - diff);
    t[k * 4] = Math.trunc(c0 * 4096.0);
    t[k * 4 + 1] = Math.trunc(c1 * 4096.0);
    t[k * 4 + 2] = Math.trunc(c2 * 4096.0);
    t[k * 4 + 3] = Math.trunc(c3 * 4096.0);
  }
  t[64 * 4] = 0;
  t[64 * 4 + 1] = 0;
  t[64 * 4 + 2] = 4096;
  t[64 * 4 + 3] = 0;
  return t;
})();

function shrinkVBox(
  src: Uint8Array,
  w: number,
  h: number,
  vshrink: number
): { readonly data: Uint8Array; readonly h: number } {
  const outH = Math.ceil(h / vshrink);
  const out = new Uint8Array(w * outH * 4);
  const roundAdd = vshrink >> 1;
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < w; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < vshrink; k++) {
          const sy = Math.min(h - 1, y * vshrink + k);
          sum += src[(sy * w + x) * 4 + c]!;
        }
        out[(y * w + x) * 4 + c] = Math.floor((sum + roundAdd) / vshrink);
      }
    }
  }
  return { data: out, h: outH };
}

function shrinkHBox(
  src: Uint8Array,
  w: number,
  h: number,
  hshrink: number
): { readonly data: Uint8Array; readonly w: number } {
  const outW = Math.ceil(w / hshrink);
  const out = new Uint8Array(outW * h * 4);
  const roundAdd = hshrink >> 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < outW; x++) {
      for (let c = 0; c < 4; c++) {
        let sum = 0;
        for (let k = 0; k < hshrink; k++) {
          const sx = Math.min(w - 1, x * hshrink + k);
          sum += src[(y * w + sx) * 4 + c]!;
        }
        out[(y * outW + x) * 4 + c] = Math.floor((sum + roundAdd) / hshrink);
      }
    }
  }
  return { data: out, w: outW };
}

export function resampleRawBitmap(
  src: Uint8Array,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
  kernel: ResizeKernel = "lanczos3",
  explicitHscale?: number,
  explicitVscale?: number
): Uint8Array {
  if (srcW === dstW && srcH === dstH && (explicitHscale === undefined || explicitHscale === 1.0) && (explicitVscale === undefined || explicitVscale === 1.0)) {
    return new Uint8Array(src);
  }

  let hasSemiTransparentAlpha = false;
  for (let i = 3; i < src.length; i += 4) {
    if (src[i]! < 255) {
      hasSemiTransparentAlpha = true;
      break;
    }
  }

  let cur = src;
  if (hasSemiTransparentAlpha) {
    const pre = new Uint8Array(src.length);
    for (let i = 0; i < src.length; i += 4) {
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
    const out = new Uint8Array(dstW * dstH * 4);
    const { xs, ys } = computeVipsNearestIndices2D(srcW, srcH, dstW, dstH, explicitHscale, explicitVscale);
    for (let y = 0; y < dstH; y++) {
      const sy = ys[y]!;
      for (let x = 0; x < dstW; x++) {
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
        const res = shrinkVBox(cur, w, h, intVshrink);
        cur = res.data;
        h = res.h;
        vshrink /= intVshrink;
        extraPixels /= intVshrink;
      }
      if (vshrink > 1.0) {
        const { nPoint, table } = buildVipsReduceTable(vshrink, kernel);
        const topPad = Math.ceil(nPoint * 0.5) - 1;
        const voffset = (extraPixels + 1.0) * 0.5 - 1.0;
        const out = new Uint8Array(w * targetH * 4);
        let Y = fmaDouble(0.5, vshrink, -0.5) - voffset;
        for (let y = 0; y < targetH; y++) {
          const iy = Math.trunc(Y);
          const ty = ((Math.trunc(Y * 128.0) & 127) + 1) >> 1;
          const wRow = ty * nPoint;
          for (let x = 0; x < w; x++) {
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              for (let j = 0; j < nPoint; j++) {
                const sy = Math.max(0, Math.min(h - 1, iy + j - topPad));
                sum += cur[(sy * w + x) * 4 + c]! * table[wRow + j]!;
              }
              out[(y * w + x) * 4 + c] = Math.max(0, Math.min(255, (sum + 2048) >> 12));
            }
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
        const res = shrinkHBox(cur, w, h, intHshrink);
        cur = res.data;
        w = res.w;
        hshrink /= intHshrink;
        extraPixels /= intHshrink;
      }
      if (hshrink > 1.0) {
        const { nPoint, table } = buildVipsReduceTable(hshrink, kernel);
        const leftPad = Math.ceil(nPoint * 0.5) - 1;
        const hoffset = (extraPixels + 1.0) * 0.5 - 1.0;
        const out = new Uint8Array(targetW * h * 4);
        let X = fmaDouble(0.5, hshrink, -0.5) - hoffset;
        for (let x = 0; x < targetW; x++) {
          const ix = Math.trunc(X);
          const tx = ((Math.trunc(X * 128.0) & 127) + 1) >> 1;
          const wRow = tx * nPoint;
          for (let y = 0; y < h; y++) {
            for (let c = 0; c < 4; c++) {
              let sum = 0;
              for (let j = 0; j < nPoint; j++) {
                const sx = Math.max(0, Math.min(w - 1, ix + j - leftPad));
                sum += cur[(y * w + sx) * 4 + c]! * table[wRow + j]!;
              }
              out[(y * targetW + x) * 4 + c] = Math.max(0, Math.min(255, (sum + 2048) >> 12));
            }
          }
          X += hshrink;
        }
        cur = out;
        w = targetW;
      }
      remHscale = 1.0;
    }

    if (remHscale > 1.0 || remVscale > 1.0) {
      const out = new Uint8Array(dstW * dstH * 4);
      const invDet = 1.0 / (remHscale * remVscale);
      const ia = remVscale * invDet;
      const id = remHscale * invDet;
      if (kernel === "linear" || kernel === "bilinear") {
        for (let y = 0; y < dstH; y++) {
          const d8 = y * id + 0.5;
          const iy = Math.trunc(d8);
          const sy = Math.trunc((d8 - iy) * 4096.0);
          const y0 = Math.max(0, Math.min(h - 1, iy - 1));
          const y1 = Math.max(0, Math.min(h - 1, iy));
          let d9 = 0.5;
          for (let x = 0; x < dstW; x++) {
            const ix = Math.trunc(d9);
            const sx = Math.trunc((d9 - ix) * 4096.0);
            const x0 = Math.max(0, Math.min(w - 1, ix - 1));
            const x1 = Math.max(0, Math.min(w - 1, ix));
            const c3 = (sy * sx) >> 12;
            const c1 = ((4096 - sy) * sx) >> 12;
            const c2 = sy - c3;
            const c0 = 4096 - sy - c1;
            for (let c = 0; c < 4; c++) {
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

  const reqW = spec.width ?? 0;
  const reqH = spec.height ?? 0;
  let xShrink = 1.0;
  let yShrink = 1.0;
  if (reqW > 0 && reqH > 0) {
    xShrink = srcW / reqW;
    yShrink = srcH / reqH;
    if (spec.fit === "cover" || spec.fit === "outside") {
      if (xShrink < yShrink) yShrink = xShrink;
      else xShrink = yShrink;
    } else if (spec.fit === "contain" || spec.fit === "inside") {
      if (xShrink > yShrink) yShrink = xShrink;
      else xShrink = yShrink;
    }
  } else if (reqW > 0) {
    xShrink = srcW / reqW;
    if (spec.fit !== "fill") yShrink = xShrink;
  } else if (reqH > 0) {
    yShrink = srcH / reqH;
    if (spec.fit !== "fill") xShrink = yShrink;
  }
  if (spec.withoutEnlargement) {
    xShrink = Math.max(1.0, xShrink);
    yShrink = Math.max(1.0, yShrink);
  }
  if (spec.withoutReduction) {
    xShrink = Math.min(1.0, xShrink);
    yShrink = Math.min(1.0, yShrink);
  }
  xShrink = Math.min(srcW, xShrink);
  yShrink = Math.min(srcH, yShrink);

  const hscale = 1.0 / xShrink;
  const vscale = 1.0 / yShrink;
  const scaledW = Math.max(1, Math.trunc(fmaDouble(srcW, hscale, 0.5)));
  const scaledH = Math.max(1, Math.trunc(fmaDouble(srcH, vscale, 0.5)));
  const scaledData = resampleRawBitmap(
    img.data,
    srcW,
    srcH,
    scaledW,
    scaledH,
    spec.kernel,
    hscale,
    vscale
  );

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
          ? smartcropEntropy(scaledData, scaledW, scaledH, cropW, cropH)
          : pos === "attention" || pos === 17
            ? smartcropAttention(scaledData, scaledW, scaledH, cropW, cropH)
            : resolveGravityOffset(scaledW, scaledH, cropW, cropH, spec.position, true);
      const cropped = new Uint8Array(cropW * cropH * 4);
      for (let y = 0; y < cropH; y++) {
        const srcRow = ((offset.y + y) * scaledW + offset.x) * 4;
        cropped.set(scaledData.subarray(srcRow, srcRow + cropW * 4), y * cropW * 4);
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
      const canvas = new Uint8Array(embedW * embedH * 4);
      for (let i = 0; i < embedW * embedH; i++) {
        canvas[i * 4] = bg.r;
        canvas[i * 4 + 1] = bg.g;
        canvas[i * 4 + 2] = bg.b;
        canvas[i * 4 + 3] = bg.a;
      }
      const offset = resolveGravityOffset(embedW, embedH, scaledW, scaledH, spec.position, false);
      for (let y = 0; y < scaledH; y++) {
        const srcRow = y * scaledW * 4;
        const dstRow = ((offset.y + y) * embedW + offset.x) * 4;
        canvas.set(scaledData.subarray(srcRow, srcRow + scaledW * 4), dstRow);
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
