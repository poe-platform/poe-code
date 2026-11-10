import { scaleVideoPicture, type MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

/** Convert to limited-range BT.601 planes before subsequent filters see RGBA. */
export async function formatYuv(
  frame: MediaVideoFrame, format: "yuv420p" | "yuv422p" | "yuv444p", signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const { width, height, data } = frame;
  const nativeFormat = format === "yuv420p" ? 0 : format === "yuv422p" ? 4 : 5;
  if (frame.native?.format === nativeFormat && frame.native.rgba === data &&
      frame.native.width === width && frame.native.height === height) return frame;
  const hsub = format === "yuv444p" ? 1 : 2;
  const vsub = format === "yuv420p" ? 2 : 1;
  const chromaWidth = Math.ceil(width / hsub);
  const chromaHeight = Math.ceil(height / vsub);
  const lumaSize = width * height;
  const chromaSize = chromaWidth * chromaHeight;
  const pixels = new Uint8Array(lumaSize + chromaSize * 2);
  for (let y = 0; y < height; y++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      // swscale rounds RGB luma to 14 bits before rounding to an 8-bit plane.
      const luma = (8414 * data[offset]! + 16519 * data[offset + 1]! +
        3208 * data[offset + 2]! + (16 << 15) + 256) >> 9;
      pixels[y * width + x] = (luma + 32) >> 6;
    }
  }
  for (let y = 0; y < chromaHeight; y++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    for (let x = 0; x < chromaWidth; x++) {
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < vsub; dy++) {
        for (let dx = 0; dx < hsub; dx++) {
          const offset = (Math.min(height - 1, y * vsub + dy) * width + Math.min(width - 1, x * hsub + dx)) * 4;
          r += data[offset]!;
          g += data[offset + 1]!;
          b += data[offset + 2]!;
        }
      }
      const count = hsub * vsub;
      const offset = lumaSize + y * chromaWidth + x;
      pixels[offset] = Math.floor((-4857 * r - 9535 * g + 14392 * b) / (32768 * count) + 128.5);
      pixels[offset + chromaSize] = Math.floor((14392 * r - 12052 * g - 2340 * b) / (32768 * count) + 128.5);
    }
  }
  const native = { rgba: data, pixels, width, height, format: nativeFormat, colorspace: 5, fullRange: 0 };
  const rgba = scaleVideoPicture({ ...frame, native }, width, height)!;
  return { ...frame, data: rgba, native: { ...native, rgba } };
}
