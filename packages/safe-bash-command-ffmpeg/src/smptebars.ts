import { yuv420pToRgba, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";

// SD SMPTE levels in limited-range BT.601 YUV, including the below-black PLUGE pulse.
const top = [[180, 128, 128], [162, 44, 142], [131, 156, 44], [112, 72, 58], [84, 184, 198], [65, 100, 212], [35, 212, 114]];
const middle = [top[6]!, [19, 128, 128], top[4]!, [19, 128, 128], top[2]!, [19, 128, 128], top[0]!];
const lower = [[57, 156, 97], [235, 128, 128], [44, 171, 147], [16, 128, 128], [7, 128, 128], [16, 128, 128], [24, 128, 128], [16, 128, 128]];

export function* renderSmptebars(width: number, height: number, budget: MediaBudgetTracker): Generator<void, Pick<MediaVideoFrame, "data" | "native">> {
  const lumaSize = width * height;
  const chromaWidth = Math.ceil(width / 2);
  const chromaSize = chromaWidth * Math.ceil(height / 2);
  budget.allocateMemory(lumaSize + chromaSize * 2);
  const pixels = new Uint8Array(lumaSize + chromaSize * 2);
  // Native bars align their dimensions to the source's 2x2 chroma grid.
  const barWidth = (Math.floor((width + 6) / 7) + 1) & ~1;
  const topHeight = (Math.floor(height * 2 / 3) + 1) & ~1;
  const middleHeight = (Math.floor(height * 3 / 4) - topHeight + 1) & ~1;
  const patchWidth = (Math.floor(barWidth * 5 / 4) + 1) & ~1;
  const pulseWidth = (Math.floor(barWidth / 3) + 1) & ~1;

  function* draw(color: number[], x: number, y: number, w: number, h: number): Generator<void> {
    x = Math.min(x, width - 1);
    y = Math.min(y, height - 1);
    w = Math.max(0, Math.min(w, width - x));
    h = Math.max(0, Math.min(h, height - y));
    for (let plane = 0; plane < 3; plane++) {
      const stride = plane === 0 ? width : chromaWidth;
      const offset = plane === 0 ? 0 : lumaSize + (plane - 1) * chromaSize;
      const px = plane === 0 ? x : Math.floor(x / 2);
      const py = plane === 0 ? y : Math.floor(y / 2);
      const pw = plane === 0 ? w : Math.ceil(w / 2);
      const ph = plane === 0 ? h : Math.ceil(h / 2);
      for (let row = 0; row < ph; row++) {
        if (row % 16 === 0) yield;
        const start = offset + (py + row) * stride + px;
        pixels.fill(color[plane]!, start, start + pw);
      }
    }
  }

  for (let bar = 0; bar < 7; bar++) {
    yield* draw(top[bar]!, bar * barWidth, 0, barWidth, topHeight);
    yield* draw(middle[bar]!, bar * barWidth, topHeight, barWidth, middleHeight);
  }
  let x = 0;
  for (let patch = 0; patch < lower.length; patch++) {
    const w = patch < 3 ? patchWidth : patch === 3 ? barWidth * 5 - x : patch < 7 ? pulseWidth : width - x;
    yield* draw(lower[patch]!, x, topHeight + middleHeight, w, height - topHeight - middleHeight);
    x += w;
  }
  budget.checkCpu();
  const data = yuv420pToRgba(pixels.subarray(0, lumaSize), pixels.subarray(lumaSize, lumaSize + chromaSize),
    pixels.subarray(lumaSize + chromaSize), width, height);
  return { data, native: { rgba: data, pixels, width, height, format: 0, colorspace: 5, fullRange: 0 } };
}
