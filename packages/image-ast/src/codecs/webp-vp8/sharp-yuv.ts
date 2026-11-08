// Adapted from libwebp SharpYUV. Copyright 2022 Google Inc. All Rights Reserved.
// BSD license: ../../../LICENSE.webp.

const toLinear = Uint32Array.from({ length: 1024 }, (_, v) => {
  const g = v / 1024;
  return Math.round(65536 * (g <= 0.018053968510807 * 4.5 ? g / 4.5 : ((g + 0.09929682680944) / 1.09929682680944) ** (1 / 0.45)));
});
const toGamma = Uint16Array.from({ length: 514 }, (_, v) => {
  const g = Math.min(v, 512) / 512;
  return Math.round(65536 * (g <= 0.018053968510807 ? 4.5 * g : 1.09929682680944 * g ** 0.45 - 0.09929682680944)) >> 6;
});
function gamma(v: number): number {
  const at = v >> 7;
  return Math.min(1023, toGamma[at]! + (((toGamma[at + 1]! - toGamma[at]!) * (v & 127) + 64) >> 7));
}
function gray(r: number, g: number, b: number): number {
  return Math.floor((13933 * r + 46871 * g + 4732 * b + 32768) / 65536);
}
function clip(v: number, max: number): number { return Math.max(0, Math.min(max, v)); }

/** Four bounded refinement passes preserve linear-light luma under 4:2:0 subsampling. */
export function sharpRgbToYuv420(rgba: Uint8Array, width: number, height: number, paddedW: number, paddedH: number, Y: Uint8Array, U: Uint8Array, V: Uint8Array): void {
  const w = (width + 1) & ~1, h = (height + 1) & ~1, uw = w / 2, uh = h / 2;
  const bestY = new Uint16Array(w * h), targetY = new Uint16Array(w * h);
  const bestUV = new Int16Array(uw * uh * 3), targetUV = new Int16Array(uw * uh * 3);
  const rows = new Uint16Array(w * 6), rowY = new Uint16Array(w * 2), rowUV = new Int16Array(uw * 3);
  function measure(): void {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < w; x++) {
        const at = y * w * 3 + x;
        rowY[y * w + x] = gamma(gray(toLinear[rows[at]!]!, toLinear[rows[at + w]!]!, toLinear[rows[at + w * 2]!]!));
      }
    }
    for (let x = 0; x < uw; x++) {
      for (let c = 0; c < 3; c++) {
        const at = c * w + 2 * x;
        rowUV[c * uw + x] = gamma((toLinear[rows[at]!]! + toLinear[rows[at + 1]!]! + toLinear[rows[at + 3 * w]!]! + toLinear[rows[at + 3 * w + 1]!]! + 2) >> 2);
      }
      const W = gray(rowUV[x]!, rowUV[uw + x]!, rowUV[2 * uw + x]!);
      for (let c = 0; c < 3; c++) rowUV[c * uw + x] = rowUV[c * uw + x]! - W;
    }
  }
  for (let y = 0; y < h; y += 2) {
    for (let dy = 0; dy < 2; dy++) {
      for (let x = 0; x < w; x++) {
        const at = (Math.min(y + dy, height - 1) * width + Math.min(x, width - 1)) * 4;
        for (let c = 0; c < 3; c++) rows[dy * w * 3 + c * w + x] = rgba[at + c]! * 4;
        bestY[(y + dy) * w + x] = gray(rgba[at]! * 4, rgba[at + 1]! * 4, rgba[at + 2]! * 4);
      }
    }
    measure();
    targetY.set(rowY, y * w);
    targetUV.set(rowUV, y / 2 * uw * 3);
  }
  bestUV.set(targetUV);
  let previousDiff = Infinity;
  for (let iteration = 0; iteration < 4; iteration++) {
    let diff = 0;
    for (let y = 0; y < h; y += 2) {
      const uvRow = y / 2;
      for (let dy = 0; dy < 2; dy++) {
        const neighbor = Math.max(0, Math.min(uh - 1, uvRow + (dy === 0 ? -1 : 1)));
        for (let c = 0; c < 3; c++) {
          const current = (uvRow * 3 + c) * uw, other = (neighbor * 3 + c) * uw;
          for (let x = 0; x < w; x++) {
            const ux = x >> 1, nx = Math.max(0, Math.min(uw - 1, ux + ((x & 1) ? 1 : -1)));
            const chroma = (9 * bestUV[current + ux]! + 3 * bestUV[current + nx]! + 3 * bestUV[other + ux]! + bestUV[other + nx]! + 8) >> 4;
            rows[dy * w * 3 + c * w + x] = clip(bestY[(y + dy) * w + x]! + chroma, 1023);
          }
        }
      }
      measure();
      for (let i = 0; i < rowY.length; i++) {
        const at = y * w + i, delta = targetY[at]! - rowY[i]!;
        bestY[at] = clip(bestY[at]! + delta, 1023);
        diff += Math.abs(delta);
      }
      for (let i = 0; i < rowUV.length; i++) {
        const at = uvRow * uw * 3 + i;
        bestUV[at] = bestUV[at]! + targetUV[at]! - rowUV[i]!;
      }
    }
    if (iteration > 0 && (diff < 3 * w * h || diff > previousDiff)) break;
    previousDiff = diff;
  }
  // WebP's BT.601 matrix, including the two extra bits of working precision.
  for (let y = 0; y < paddedH; y++) {
    const sy = Math.min(y, height - 1);
    for (let x = 0; x < paddedW; x++) {
      const sx = Math.min(x, width - 1), uv = ((sy >> 1) * 3) * uw + (sx >> 1), W = bestY[sy * w + sx]!;
      const r = bestUV[uv]!, g = bestUV[uv + uw]!, b = bestUV[uv + 2 * uw]!;
      Y[y * paddedW + x] = clip(Math.floor((16839 * (r + W) + 33059 * (g + W) + 6420 * (b + W) + 16 * 262144 + 131072) / 262144), 255);
      if ((y & 1) === 0 && (x & 1) === 0) {
        const at = (y >> 1) * (paddedW >> 1) + (x >> 1);
        U[at] = clip(Math.floor((-9719 * r - 19081 * g + 28800 * b + 128 * 262144 + 131072) / 262144), 255);
        V[at] = clip(Math.floor((28800 * r - 24116 * g - 4684 * b + 128 * 262144 + 131072) / 262144), 255);
      }
    }
  }
}
