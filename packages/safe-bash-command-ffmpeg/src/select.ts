import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function meanFrameDifference(
  frame: MediaVideoFrame, previous: MediaVideoFrame, pixelFormat: string | undefined,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<number> {
  const native = frame.native;
  const previousNative = previous.native;
  const useNative = native && previousNative && native.rgba === frame.data &&
    previousNative.rgba === previous.data && native.width === frame.width && native.height === frame.height &&
    previousNative.width === previous.width && previousNative.height === previous.height &&
    native.format === previousNative.format && [0, 4, 5, 8, 12, 13, 14, 29, 34, 49, 68, 104].includes(native.format);
  const depth = useNative ? native.format === 68 ? 10 : [29, 34, 49, 104].includes(native.format) ? 16 : 8 : 8;
  const littleEndian = useNative && (native.format === 49 || native.format === 68);
  const components = useNative ? native.format === 34 ? 3 : native.format === 104 ? 4 : 1 :
    pixelFormat === "gray" || pixelFormat === "gray8" || pixelFormat === "gray16be" ? 1 :
    pixelFormat === "ya8" ? 2 : ["rgb24", "bgr24", "rgb48be"].includes(pixelFormat ?? "") ? 3 : 4;
  const count = frame.width * frame.height * components;
  const pixels = useNative ? native.pixels : frame.data;
  const previousPixels = useNative ? previousNative.pixels : previous.data;
  let difference = 0;
  for (let i = 0; i < count; i++) {
    if (i % 65536 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    if (depth > 8) {
      const low = i * 2 + (littleEndian ? 0 : 1), high = i * 2 + (littleEndian ? 1 : 0);
      difference += Math.abs((pixels[low]! + pixels[high]! * 256) -
        (previousPixels[low]! + previousPixels[high]! * 256));
    } else {
      const offset = useNative ? i : Math.floor(i / components) * 4 +
        (components === 2 && i % 2 === 1 ? 3 : i % components);
      difference += Math.abs(pixels[offset]! - previousPixels[offset]!);
    }
  }
  // Planar YUV compares only luma, normalized to 8-bit sample units.
  return difference / count / 2 ** (depth - 8);
}
