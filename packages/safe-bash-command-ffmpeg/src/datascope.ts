import { type MediaVideoFrame, type MediaBudgetTracker } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

// CGA ROM hexadecimal glyphs, eight bitmap rows per character (0–9, A–F).
const hexGlyphs = [
  [0x7c, 0xc6, 0xce, 0xde, 0xf6, 0xe6, 0x7c, 0],
  [0x30, 0x70, 0x30, 0x30, 0x30, 0x30, 0xfc, 0],
  [0x78, 0xcc, 0x0c, 0x38, 0x60, 0xcc, 0xfc, 0],
  [0x78, 0xcc, 0x0c, 0x38, 0x0c, 0xcc, 0x78, 0],
  [0x1c, 0x3c, 0x6c, 0xcc, 0xfe, 0x0c, 0x1e, 0],
  [0xfc, 0xc0, 0xf8, 0x0c, 0x0c, 0xcc, 0x78, 0],
  [0x38, 0x60, 0xc0, 0xf8, 0xcc, 0xcc, 0x78, 0],
  [0xfc, 0xcc, 0x0c, 0x18, 0x30, 0x30, 0x30, 0],
  [0x78, 0xcc, 0xcc, 0x78, 0xcc, 0xcc, 0x78, 0],
  [0x78, 0xcc, 0xcc, 0x7c, 0x0c, 0x18, 0x70, 0],
  [0x30, 0x78, 0xcc, 0xcc, 0xfc, 0xcc, 0xcc, 0],
  [0xfc, 0x66, 0x66, 0x7c, 0x66, 0x66, 0xfc, 0],
  [0x3c, 0x66, 0xc0, 0xc0, 0xc0, 0x66, 0x3c, 0],
  [0xf8, 0x6c, 0x66, 0x66, 0x66, 0x6c, 0xf8, 0],
  [0xfe, 0x62, 0x68, 0x78, 0x68, 0x62, 0xfe, 0],
  [0xfe, 0x62, 0x68, 0x78, 0x68, 0x60, 0xf0, 0]
];

export async function datascopeFrame(
  frame: MediaVideoFrame, width: number, height: number,
  budget: MediaBudgetTracker, signal?: AbortSignal
): Promise<MediaVideoFrame> {
  budget.recordFrame(width, height);
  budget.allocateMemory(width * height * 4);
  const data = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    if (pixel % 4096 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
    data[pixel * 4 + 3] = 255;
  }
  // Each source RGB pixel occupies a 20×36 cell with three two-digit readouts.
  for (let y = 0; y < Math.min(frame.height, Math.floor(height / 36)); y++) {
    for (let x = 0; x < Math.min(frame.width, Math.floor(width / 20)); x++) {
      if (x % 64 === 0) { await yieldTurn(signal); signal?.throwIfAborted(); budget.checkCpu(); }
      for (let channel = 0; channel < 3; channel++) {
        const value = frame.data[(y * frame.width + x) * 4 + channel]!;
        for (let digit = 0; digit < 2; digit++) {
          const glyph = hexGlyphs[(value >> (digit === 0 ? 4 : 0)) & 15]!;
          for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
            if (!(glyph[row]! & (128 >> col))) continue;
            const offset = ((y * 36 + channel * 10 + 2 + row) * width + x * 20 + 2 + digit * 8 + col) * 4;
            data[offset] = data[offset + 1] = data[offset + 2] = 255;
          }
        }
      }
    }
  }
  const { native: ignoredNative, ...rest } = frame;
  return { ...rest, width, height, data };
}
