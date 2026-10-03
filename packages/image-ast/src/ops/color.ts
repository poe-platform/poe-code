export const SRGB_TO_LINEAR_LUT = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const v = i / 255;
  SRGB_TO_LINEAR_LUT[i] = v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

const VIPS_Y2V_8 = new Int32Array(257);
for (let i = 0; i <= 256; i++) {
  const y = i / 255;
  const v = y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055;
  VIPS_Y2V_8[i] = Math.min(255, Math.max(0, Math.round(v * 255)));
}

export function linearToSrgbByte(v: number): number {
  if (v <= 0) return 0;
  if (v >= 1) return 255;
  const s0 = v * 255;
  const idx = s0 | 0;
  const frac = s0 - idx;
  return Math.round(VIPS_Y2V_8[idx]! + (VIPS_Y2V_8[idx + 1]! - VIPS_Y2V_8[idx]!) * frac);
}

export function srgbToBwByte(r: number, g: number, b: number): number {
  if (r === g && g === b) return r;
  const y = Math.fround(
    Math.fround(0.2126) * Math.fround(SRGB_TO_LINEAR_LUT[r]!) +
    Math.fround(0.7152) * Math.fround(SRGB_TO_LINEAR_LUT[g]!) +
    Math.fround(0.0722) * Math.fround(SRGB_TO_LINEAR_LUT[b]!)
  );
  return linearToSrgbByte(y);
}

export function srgbToLab(r: number, g: number, b: number): [number, number, number] {
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

export function labToSrgb(L: number, a: number, b: number): [number, number, number] {
  let Y: number;
  let fy: number;
  if (L < 8.0) {
    Y = Math.fround((L * 100.0) / 903.3);
    fy = (Y / 100.0) * 7.787 + 16.0 / 116.0;
  } else {
    fy = (L + 16.0) / 116.0;
    Y = Math.fround(fy * fy * fy * 100.0);
  }
  const fx = a / 500.0 + fy;
  const X = Math.fround(95.047 * (fx > 0.206893 ? fx * fx * fx : (fx - 16.0 / 116.0) / 7.787));
  const fz = fy - b / 200.0;
  const Z = Math.fround(108.883 * (fz > 0.206893 ? fz * fz * fz : (fz - 16.0 / 116.0) / 7.787));
  const x = X / 100.0;
  const y = Y / 100.0;
  const z = Z / 100.0;
  const lr = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const lg = -0.9692660 * x + 1.8760108 * y + 0.0415560 * z;
  const lb = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  return [linearToSrgbByte(lr), linearToSrgbByte(lg), linearToSrgbByte(lb)];
}
