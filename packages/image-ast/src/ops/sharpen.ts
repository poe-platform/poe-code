import {SRGB_TO_LINEAR_LUT,linearToSrgbByte} from "./color.js";

function rintEven(x: number): number {
  const r = Math.round(x);
  if (Math.abs(x - r) === 0.5) return r % 2 === 0 ? r : r - 1;
  return r;
}

export function buildVipsGaussmat(
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

export function vipsSrgbToLabForSharpenInto(r: number, g: number, b: number, out: Float64Array): void {
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

export function vipsLabToSrgbForSharpenInto(L: number, a: number, b: number, out: Uint8Array): void {
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

export function sharpenLuminance(luminance:number,blurred:number,m1:number,m2:number,x1:number,y2:number,y3:number):number {
    const diffIdx = luminance - blurred;
    const d5 = diffIdx / 327.67;
    let v: number;
    if (d5 < -x1) v = (d5 + x1) * m2 - x1 * m1;
    else if (d5 < x1) v = d5 * m1;
    else v = (d5 - x1) * m2 + x1 * m1;
    if (v < -y3) v = -y3;
    if (v > y2) v = y2;
    const boostS = rintEven(v * 327.67);
    return Math.max(0, Math.min(32767, luminance + boostS));
}
