import { yieldTurn } from "safe-bash-contracts/yield";

export function scaleWeights(source: number, target: number, algorithm: "bicubic" | "bilinear" | "area" | "lanczos") {
  const step = Math.round(source * 65536 / target);
  // swscale limits kernel support on small inputs rather than extending a
  // full kernel beyond both edges.
  const support = algorithm === "lanczos" ? 6 : algorithm === "bicubic" ? 4 : 2;
  const size = source === target ? 1 : Math.max(1, Math.min(source - 2, 1 + Math.ceil(support * Math.max(1, source / target))));
  return Array.from({ length: target }, (_, destination) => {
    const center = (destination + 0.5) * step / 65536 - 0.5;
    if (algorithm === "area" && source > target) {
      const left = destination * source / target;
      const right = (destination + 1) * source / target;
      return Array.from({ length: Math.ceil(right) - Math.floor(left) }, (_, tap) => {
        const index = Math.floor(left) + tap;
        return { index, weight: (Math.min(right, index + 1) - Math.max(left, index)) / (right - left) };
      });
    }
    const start = Math.trunc(center - (size - 2) / 2);
    const weights = Array.from({ length: size }, (_, tap) => {
      const distance = Math.abs(start + tap - center) * Math.min(1, target / source);
      // FFmpeg's default bicubic parameters are B=0, C=0.6.
      const weight = algorithm === "bilinear" || algorithm === "area" ? Math.max(0, 1 - distance)
        : algorithm === "lanczos" ? (distance === 0 ? 1 : distance < 3
          ? Math.sin(Math.PI * distance) * Math.sin(Math.PI * distance / 3) / (Math.PI * Math.PI * distance * distance / 3) : 0)
        : distance < 1
        ? 1 + distance * distance * (1.4 * distance - 2.4)
        : distance < 2 ? 0.6 * (4 + distance * (-8 + distance * (5 - distance))) : 0;
      return { index: Math.max(0, Math.min(source - 1, start + tap)), weight };
    });
    const sum = weights.reduce((total, tap) => total + tap.weight, 0);
    for (const tap of weights) tap.weight /= sum;
    return weights;
  });
}

export async function scaleFrame(
  data: Uint8Array, width: number, height: number,
  targetWidth: number, targetHeight: number, signal?: AbortSignal, algorithm: "bicubic" | "bilinear" | "area" | "lanczos" = "bicubic"
): Promise<Uint8Array> {
  if (width === targetWidth && height === targetHeight) return data;
  const horizontal = scaleWeights(width, targetWidth, algorithm);
  const vertical = scaleWeights(height, targetHeight, algorithm);
  const output = new Uint8Array(targetWidth * targetHeight * 4);
  let work = 0;
  for (let y = 0; y < targetHeight; y++) {
    for (let x = 0; x < targetWidth; x++) {
      const pixel = [0, 0, 0, 0];
      for (const row of vertical[y]!) {
        for (const column of horizontal[x]!) {
          if (++work % 1024 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); }
          const offset = (row.index * width + column.index) * 4;
          const weight = row.weight * column.weight;
          for (let channel = 0; channel < 4; channel++) pixel[channel]! += data[offset + channel]! * weight;
        }
      }
      for (let channel = 0; channel < 4; channel++) {
        output[(y * targetWidth + x) * 4 + channel] = Math.max(0, Math.min(255, Math.round(pixel[channel]!)));
      }
    }
  }
  return output;
}
