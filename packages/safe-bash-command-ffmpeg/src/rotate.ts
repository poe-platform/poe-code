import { scaleVideoPicture, type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

// FFmpeg's rotate filter computes its sampling grid with 16-bit fixed point.
function fixedSin(angle: number): number {
  const pi = 3294199;
  if (angle < 0) angle = pi - angle;
  angle %= 2 * pi;
  if (angle >= Math.trunc(pi * 3 / 2)) angle -= 2 * pi;
  if (angle >= Math.trunc(pi / 2)) angle = pi - angle;
  const squared = Math.trunc(angle * angle / 1048576);
  let sum = 0;
  for (let i = 2; i < 11; i += 2) {
    sum += angle;
    angle = Math.trunc(-angle * squared / (1048576 * i * (i + 1)));
  }
  return Math.floor((sum + 8) / 16);
}

export async function rotateYuvFrame(
  frame: MediaVideoFrame, angle: number, outputWidth: number, outputHeight: number, bilinear: boolean, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame | undefined> {
  const source = frame.native;
  if (!source || source.rgba !== frame.data || source.width !== frame.width || source.height !== frame.height) return undefined;
  // AVPixelFormat's planar 8-bit YUV and full-range YUV layouts.
  const subsampling: Record<number, readonly [number, number]> = {
    0: [2, 2], 4: [2, 1], 5: [1, 1], 12: [2, 2], 13: [2, 1], 14: [1, 1]
  };
  const sampling = subsampling[source.format];
  if (!sampling) return undefined;
  const chromaWidth = Math.ceil(frame.width / sampling[0]);
  const chromaHeight = Math.ceil(frame.height / sampling[1]);
  const outputChromaWidth = Math.ceil(outputWidth / sampling[0]);
  const outputChromaHeight = Math.ceil(outputHeight / sampling[1]);
  const pixels = new Uint8Array(outputWidth * outputHeight + 2 * outputChromaWidth * outputChromaHeight);
  const fixedAngle = Math.trunc(angle * 1048576);
  const sin = fixedSin(fixedAngle);
  const cos = fixedSin(fixedAngle + Math.trunc(3294199 / 2));
  let offset = 0;
  let outputOffset = 0;
  for (let plane = 0; plane < 3; plane++) {
    const width = plane === 0 ? frame.width : chromaWidth;
    const height = plane === 0 ? frame.height : chromaHeight;
    const destWidth = plane === 0 ? outputWidth : outputChromaWidth;
    const destHeight = plane === 0 ? outputHeight : outputChromaHeight;
    pixels.fill(plane === 0 ? (source.fullRange ? 0 : 16) : 128, outputOffset, outputOffset + destWidth * destHeight);
    const xi = Math.trunc(-(destWidth - 1) * cos / 2);
    const yi = Math.trunc((destWidth - 1) * sin / 2);
    const xprime = Math.trunc(-(destHeight - 1) * sin / 2);
    const yprime = Math.trunc(-(destHeight - 1) * cos / 2);
    for (let y = 0; y < destHeight; y++) {
      await yieldTurn(signal);
      signal?.throwIfAborted();
      budget.checkCpu();
      for (let x = 0; x < destWidth; x++) {
        const sx = xprime + y * sin + xi + 65536 * (width - 1) / 2 + x * cos;
        const sy = yprime + y * cos + yi + 65536 * (height - 1) / 2 - x * sin;
        const ix = Math.floor(sx / 65536);
        const iy = Math.floor(sy / 65536);
        if (ix < -1 || ix > width || iy < -1 || iy > height) continue;
        const x0 = Math.max(0, Math.min(width - 1, ix));
        const y0 = Math.max(0, Math.min(height - 1, iy));
        if (!bilinear) {
          pixels[outputOffset + y * destWidth + x] = source.pixels[offset + y0 * width + x0]!;
          continue;
        }
        const x1 = Math.min(x0 + 1, width - 1);
        const y1 = Math.min(y0 + 1, height - 1);
        const dx = sx - ix * 65536;
        const dy = sy - iy * 65536;
        const top = (65536 - dx) * source.pixels[offset + y0 * width + x0]! + dx * source.pixels[offset + y0 * width + x1]!;
        const bottom = (65536 - dx) * source.pixels[offset + y1 * width + x0]! + dx * source.pixels[offset + y1 * width + x1]!;
        pixels[outputOffset + y * destWidth + x] = Math.floor(((65536 - dy) * top + dy * bottom) / 4294967296);
      }
    }
    offset += width * height;
    outputOffset += destWidth * destHeight;
  }
  const native = { ...source, width: outputWidth, height: outputHeight, pixels };
  const data = scaleVideoPicture({ ...frame, width: outputWidth, height: outputHeight, native }, outputWidth, outputHeight)!;
  return { ...frame, width: outputWidth, height: outputHeight, data, native: { ...native, rgba: data } };
}
