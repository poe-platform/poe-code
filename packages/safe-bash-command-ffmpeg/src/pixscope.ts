import type { MediaBudgetTracker, MediaVideoFrame } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";
// CGA ROM glyph subset from FFmpeg libavutil/xga_font_data.c (LGPL-2.1-or-later).
import glyphs from "./pixscope-font.json" with { type: "json" };

export async function pixscopeFrame(
  frame: MediaVideoFrame, budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  const { width, height } = frame;
  if (width < 640 || height < 480) throw new Error("pixscope: min supported resolution is 640x480");
  budget.allocateMemory(frame.data.byteLength);
  const data = new Uint8Array(frame.data);
  const sx = Math.trunc((width - 1) / 2), sy = Math.trunc((height - 1) / 2);
  let ox = width - 300;
  const oy = height - 480;
  if (sx + 7 >= ox && sx + 7 <= ox + 300 && sy + 7 >= oy && sy + 7 <= oy + 480) ox = 0;
  // Default window: 300×480, half-opacity black, with a magnified 7×7 sample.
  for (let y = oy; y < oy + 480; y++) {
    await yieldTurn(signal);
    signal?.throwIfAborted();
    budget.checkCpu();
    for (let x = ox; x < ox + 300; x++) for (let c = 0; c < 3; c++) {
      const offset = (y * width + x) * 4 + c;
      data[offset] = Math.floor(data[offset]! * (0x1010101 - (0x10203 * 127 + 2)) / 0x1000000);
    }
  }
  const rectangle = (x: number, y: number, w: number, h: number, color: ArrayLike<number>) => {
    for (let row = y; row < y + h; row++) for (let col = x; col < x + w; col++) {
      data.set(color, (row * width + col) * 4);
    }
  };
  const sums = [0, 0, 0], squares = [0, 0, 0], mins = [255, 255, 255], maxs = [0, 0, 0];
  for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
    const offset = ((sy + y) * width + sx + x) * 4;
    rectangle(ox + 1 + x * 42, oy + 2 + y * 42, 42, 42, frame.data.subarray(offset, offset + 3));
    for (let c = 0; c < 3; c++) {
      const v = frame.data[offset + c]!;
      sums[c]! += v; squares[c]! += v * v;
      mins[c] = Math.min(mins[c]!, v); maxs[c] = Math.max(maxs[c]!, v);
    }
  }
  const black = [0, 0, 0], white = [255, 255, 255];
  rectangle(sx - 2, sy - 2, 11, 1, black);
  rectangle(sx - 1, sy - 1, 9, 1, white);
  rectangle(sx - 1, sy - 1, 1, 9, white);
  rectangle(sx - 2, sy - 2, 1, 11, black);
  rectangle(sx - 1, sy + 8, 10, 1, white);
  rectangle(sx - 2, sy + 9, 11, 1, black);
  rectangle(sx + 8, sy - 1, 1, 9, white);
  rectangle(sx + 9, sy - 2, 1, 12, black);
  const text = (value: string, y: number, color: ArrayLike<number>) => {
    for (const [i, char] of [...value].entries()) {
      const glyph = glyphs[char as keyof typeof glyphs];
      for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
        if (glyph[row]! & (128 >> col)) rectangle(ox + 28 + i * 8 + col, y + row, 1, 1, color);
      }
    }
  };
  text("CH   AVG    MIN    MAX    RMS", oy + 305, white);
  text("CH   STD", oy + 375, white);
  for (let c = 0; c < 3; c++) {
    const average = Math.fround(sums[c]! / 49);
    let variance = 0;
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) {
      const delta = Math.fround(frame.data[((sy + y) * width + sx + x) * 4 + c]! - average);
      variance += Math.fround(delta * delta);
    }
    const color = [0, 0, 0]; color[c] = 255;
    text(`${"RGB"[c]}  ${average.toFixed(1).padStart(7, "0")} ${String(mins[c]).padStart(5, "0")} ${String(maxs[c]).padStart(5, "0")} ${Math.sqrt(squares[c]! / 49).toFixed(1).padStart(7, "0")}`, oy + 315 + c * 15, color);
    text(`${"RGB"[c]}  ${Math.sqrt(variance / 49).toFixed(2).padStart(7, "0")}`, oy + 390 + c * 15, color);
  }
  const { native: ignoredNative, ...rest } = frame;
  return { ...rest, data };
}
