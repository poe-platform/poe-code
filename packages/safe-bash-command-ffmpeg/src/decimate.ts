import type { MediaVideoFrame, MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

export async function decimate(
  frames: MediaVideoFrame[], cycle: number, mixed: boolean, dupthresh: number, sceneThreshold: number, chroma: boolean,
  blockx: number, blocky: number, budget: MediaBudgetTracker, signal?: AbortSignal, cleanFrames?: MediaVideoFrame[]
): Promise<MediaVideoFrame[]> {
  const output: MediaVideoFrame[] = [];
  const duration = (frames[0]?.durationSeconds ?? 0) * cycle / (cycle - 1);
  if (!(duration > 0)) throw new Error("decimate: a positive input frame rate is required");
  let previous: MediaVideoFrame["native"];
  let start = 0;
  const length = cleanFrames ? Math.min(frames.length, cleanFrames.length) : frames.length;
  for (let base = 0; base < length; base += cycle) {
    let lowest = base, lowestDifference = Infinity, scene = -1;
    const end = Math.min(base + cycle, length);
    // Native two-input EOF drops a pending singleton rather than flushing a cycle.
    if (cleanFrames && end - base === 1) break;
    for (let i = base; i < end; i++) {
      await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu();
      const frame = frames[i]!;
      const size = frame.width * frame.height;
      let native = frame.native;
      if (!native || native.rgba !== frame.data || native.width !== frame.width || native.height !== frame.height ||
          ![0, 4, 5, 12, 13, 14].includes(native.format)) {
        budget.allocateMemory(size * 3);
        const pixels = new Uint8Array(size * 3);
        for (let p = 0; p < size; p++) {
          if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
          const r = frame.data[p * 4]!, g = frame.data[p * 4 + 1]!, b = frame.data[p * 4 + 2]!;
          // Limited-range BT.601, matching swscale's RGB24 to YUV444 conversion.
          pixels[p] = (8414*r + 16519*g + 3208*b + (16<<15) + 16640) >> 15;
          pixels[size+p] = (-4865*r - 9528*g + 14392*b + (128<<15) + 16640) >> 15;
          pixels[2*size+p] = (14392*r - 12061*g - 2332*b + (128<<15) + 16640) >> 15;
        }
        native = { pixels, rgba: frame.data, width: frame.width, height: frame.height, format: 5, colorspace: 5, fullRange: 0 };
      }
      let total = Infinity, maximum = Infinity;
      if (previous && previous.width === frame.width && previous.height === frame.height && previous.format === native.format) {
        const halfWidth = blockx / 2, halfHeight = blocky / 2;
        const columns = Math.ceil(frame.width / halfWidth), rows = Math.ceil(frame.height / halfHeight);
        budget.allocateMemory(columns * rows * 8);
        const blocks = new Float64Array(columns * rows);
        const hs = [0, 4, 12, 13].includes(native.format) ? 2 : 1;
        const vs = [0, 12].includes(native.format) ? 2 : 1;
        let offset = 0;
        total = 0;
        for (let plane = 0; plane < (chroma ? 3 : 1); plane++) {
          const sx = plane ? hs : 1, sy = plane ? vs : 1;
          const width = Math.ceil(frame.width / sx), height = Math.ceil(frame.height / sy);
          for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
              const p = offset + y * width + x;
              if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
              const difference = Math.abs(native.pixels[p]! - previous.pixels[p]!);
              blocks[Math.floor(y * sy / halfHeight) * columns + Math.floor(x * sx / halfWidth)]! += difference;
              total += difference;
            }
          }
          offset += width * height;
        }
        maximum = -1;
        for (let y = 0; y < rows - 1; y++) {
          for (let x = 0; x < columns - 1; x++) {
            const p = y * columns + x;
            if (p % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
            maximum = Math.max(maximum, blocks[p]! + blocks[p+1]! + blocks[p+columns]! + blocks[p+columns+1]!);
          }
        }
      }
      if (total > Math.floor(255 * size * (sceneThreshold / 100))) scene = i;
      if (maximum < lowestDifference) { lowest = i; lowestDifference = maximum; }
      previous = native;
    }
    // Prefer a duplicate; otherwise drop the last scene change or the least changed frame.
    const drop = end - base < cycle || mixed && lowestDifference >= Math.floor(255 * blockx * blocky * dupthresh / 100) ? -1 :
      scene >= 0 && lowestDifference >= Math.floor(255 * blockx * blocky * dupthresh / 100) ? scene : lowest;
    const outputDuration = mixed && drop < 0 ? frames[0]!.durationSeconds : duration;
    for (let i = base; i < end; i++) {
      if (i === drop) continue;
      const frame = frames[i]!;
      if (output.length === 0) start = mixed ? frame.ptsSeconds : Math.round(frame.ptsSeconds / duration) * duration;
      const previousOutput = output.at(-1);
      const ptsSeconds = mixed && previousOutput
        ? previousOutput.ptsSeconds + previousOutput.durationSeconds
        : start + output.length * duration;
      output.push({ ...(cleanFrames?.[i] ?? frame), ptsSeconds, durationSeconds: outputDuration });
    }
  }
  return output;
}
