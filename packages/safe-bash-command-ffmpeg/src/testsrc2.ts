import { yuv420pToRgba, type MediaBudgetTracker, type MediaVideoFrame } from "@poe-code/mp4-ast";

// VGA ROM timestamp glyphs: the ten occupied rows start two rows below the top.
const glyphs: Record<string, readonly number[]> = {
  "0": [0x3c, 0x66, 0xc3, 0xc3, 0xdb, 0xdb, 0xc3, 0xc3, 0x66, 0x3c],
  "1": [0x18, 0x38, 0x78, 0x18, 0x18, 0x18, 0x18, 0x18, 0x18, 0x7e],
  "2": [0x7c, 0xc6, 0x06, 0x0c, 0x18, 0x30, 0x60, 0xc0, 0xc6, 0xfe],
  "3": [0x7c, 0xc6, 0x06, 0x06, 0x3c, 0x06, 0x06, 0x06, 0xc6, 0x7c],
  "4": [0x0c, 0x1c, 0x3c, 0x6c, 0xcc, 0xfe, 0x0c, 0x0c, 0x0c, 0x1e],
  "5": [0xfe, 0xc0, 0xc0, 0xc0, 0xfc, 0x06, 0x06, 0x06, 0xc6, 0x7c],
  "6": [0x38, 0x60, 0xc0, 0xc0, 0xfc, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c],
  "7": [0xfe, 0xc6, 0x06, 0x06, 0x0c, 0x18, 0x30, 0x30, 0x30, 0x30],
  "8": [0x7c, 0xc6, 0xc6, 0xc6, 0x7c, 0xc6, 0xc6, 0xc6, 0xc6, 0x7c],
  "9": [0x7c, 0xc6, 0xc6, 0xc6, 0x7e, 0x06, 0x06, 0x06, 0x0c, 0x78],
  ":": [0, 0, 0x18, 0x18, 0, 0, 0, 0x18, 0x18, 0],
  ".": [0, 0, 0, 0, 0, 0, 0, 0, 0x18, 0x18]
};

/** Render the animated testsrc2 pattern in its native limited-range BT.601 YUV420 planes. */
export function* renderTestsrc2(
  width: number, height: number, frame: number, fps: number, budget: MediaBudgetTracker
): Generator<void, MediaVideoFrame> {
  const lumaSize = width * height;
  budget.allocateMemory(lumaSize * 5.5);
  const pixels = new Uint8Array(lumaSize * 1.5);
  const time = frame / fps;
  let work = 0;

  // Solid rectangles are aligned to the chroma grid. Masks average coverage
  // within each chroma sample before blending, including clipped edge samples.
  function* draw(
    rgb: number, left: number, top: number, w: number, h: number,
    opacity?: number, mask?: (x: number, y: number) => number
  ): Generator<void> {
    const r = (rgb >> 16) & 255, g = (rgb >> 8) & 255, b = rgb & 255;
    const luma = 0.299 * r + 0.587 * g + 0.114 * b;
    const color = [Math.round(16 + luma * 219 / 255),
      Math.round(128 + (b - luma) / 1.772 * 224 / 255),
      Math.round(128 + (r - luma) / 1.402 * 224 / 255)];
    let offset = 0;
    for (let plane = 0; plane < 3; plane++) {
      const sub = plane === 0 ? 1 : 2;
      const stride = width / sub;
      const right = Math.min(width, left + w), bottom = Math.min(height, top + h);
      for (let y = Math.max(0, Math.floor(top / sub)); y < Math.ceil(bottom / sub); y++) {
        if (y % 16 === 0) { budget.checkCpu(); yield; }
        for (let x = Math.max(0, Math.floor(left / sub)); x < Math.ceil(right / sub); x++) {
          if (++work % 4096 === 0) { budget.checkCpu(); yield; }
          const index = offset + y * stride + x;
          const value = color[plane]!;
          if (opacity === undefined) {
            pixels[index] = value;
            continue;
          }
          let coverage = 0;
          for (let dy = 0; dy < sub; dy++) for (let dx = 0; dx < sub; dx++) {
            const sx = x * sub + dx, sy = y * sub + dy;
            if (sx >= left && sx < right && sy >= top && sy < bottom) {
              coverage += mask ? mask(sx - left, sy - top) : 255;
            }
          }
          const alpha = mask
            ? Math.floor(coverage / (sub * sub)) * ((0x10307 * opacity + 3) >> 8)
            : Math.floor((0x10203 * opacity + 2) * coverage / (255 * sub * sub));
          pixels[index] = Math.floor(((0x1010101 - alpha) * pixels[index]! + alpha * value) / 0x1000000);
        }
      }
      offset += lumaSize / (sub * sub);
    }
  }

  let left = 0;
  for (let bar = 1; bar <= 6; bar++) {
    const right = (Math.round(bar * width / 6) + 1) & ~1;
    const color = (bar & 1 ? 0xff0000 : 0) | (bar & 2 ? 0x00ff00 : 0) | (bar & 4 ? 0x0000ff : 0);
    yield* draw(color, left, 0, right - left, height);
    left = right;
  }

  if (height >= 64) {
    const startY = Math.round(time * (height - 16) / 2);
    const startColor = Math.round(time * 128);
    for (let x = 0; x < width; x += 2) {
      const gradient = (Math.round(x * 1536 / width) + startColor) % 1536;
      const ramp = gradient & 255;
      const colors = [0xff0000 + (ramp << 8), 0x00ff00 + ((255 - ramp) << 16),
        0x00ff00 + ramp, 0x0000ff + ((255 - ramp) << 8),
        0x0000ff + (ramp << 16), 0xff0000 + 255 - ramp];
      let y = (startY + Math.round(x * Math.floor(height / 2) / width)) % (2 * (height - 16));
      if (y > height - 16) y = 2 * (height - 16) - y;
      yield* draw(colors[gradient >> 8]!, x, (y + 1) & ~1, 2, 16);
    }
  }

  if (width >= 64 && height >= 64) {
    const length = (Math.min(width, height) - 32) >> 1;
    const steps = Math.max(4, length >> 5);
    for (let hand = 0; hand < 3; hand++) {
      const pos = Math.round(time * length * 4 / (64 >> (hand * 2))) % (length * 4);
      const dx = (pos < length ? pos : pos < 2 * length ? length : pos < 3 * length ? 3 * length - pos : 0) - (length >> 1);
      const dy = (pos < length ? 0 : pos < 2 * length ? pos - length : pos < 3 * length ? length : 4 * length - pos) - (length >> 1);
      for (let step = 1; step <= steps; step++) {
        // av_rescale rounds halfway cases away from zero, including negative offsets.
        const x = Math.sign(dx) * Math.round(Math.abs(dx) * step / steps) + (width >> 2) + (width >> 1);
        const y = Math.sign(dy) * Math.round(Math.abs(dy) * step / steps) + (height >> 2);
        yield* draw(0xbbbbbb ^ (255 << (hand * 8)), x & ~1, y & ~1, 8, 8);
      }
    }
    const length2 = (Math.min(width, height) - 16) >> 2;
    const phase = Math.round(time * length2 * 2);
    const step = Math.floor(phase / length2);
    const size = step & 1 ? length2 - phase % length2 : phase % length2;
    const shape = (step >> 1) & 3;
    const xc = width >> 2, yc = (height >> 2) + (height >> 1);
    const x1 = (xc - 4 - size) & ~1, x2 = (xc + 4 + size + 1) & ~1;
    const y1 = (yc - 4 - size) & ~1, y2 = (yc + 4 + size + 1) & ~1;
    const xm1 = (xc - 8) & ~1, xm2 = (xc + 9) & ~1;
    const ym1 = (yc - 8) & ~1, ym2 = (yc + 9) & ~1;
    if (shape === 0 || shape === 2) yield* draw(0x808080, x1, ym1, x2 - x1, ym2 - ym1);
    if (shape === 1 || shape === 2) yield* draw(0x808080, xm1, y1, xm2 - xm1, y2 - y1);
    if (shape === 3) yield* draw(0x808080, x1, y1, x2 - x1, y2 - y1);
  }

  let random = frame >>> 0;
  const noise = new Uint8Array(256);
  for (let y = Math.round(5 * height / 8); y + 15 < Math.round(7 * height / 8); y += 16) {
    for (let x = Math.round(5 * width / 8); x + 15 < Math.round(7 * width / 8); x += 16) {
      if ((x ^ y) & 16) continue;
      for (let i = 0; i < noise.length; i++) {
        random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
        noise[i] = random >>> 24;
      }
      yield* draw(0x00ff80, x, y, 16, 16, 255, (mx, my) => noise[my * 16 + mx]!);
    }
  }

  if (width >= 16 && height >= 16) {
    const w = width - 8, h = height - 8;
    let x = Math.round(time * 55 * w / 233) % (2 * w);
    let y = Math.round(time * 89 * h / 233) % (2 * h);
    if (x > w) x = 2 * w - x;
    if (y > h) y = 2 * h - y;
    yield* draw(0x8000ff, x & ~1, y & ~1, 8, 8);
  }

  yield* draw(0, 2, 2, 100, 36, 192);
  const ms = Math.round(time * 1000) % 86400000;
  const clock = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60]
    .map(value => String(value).padStart(2, "0")).join(":") + "." + String(ms % 1000).padStart(3, "0");
  for (const [row, text] of [clock, String(frame).padStart(12, " ")].entries()) {
    for (const [column, character] of [...text].entries()) {
      const glyph = glyphs[character];
      if (glyph) yield* draw(0xff8000, 4 + column * 8, 6 + row * 16, 8, 10, 255,
        (x, y) => glyph[y]! & (128 >> x) ? 255 : 0);
    }
  }

  budget.checkCpu();
  yield;
  const data = yuv420pToRgba(pixels.subarray(0, lumaSize), pixels.subarray(lumaSize, lumaSize * 1.25),
    pixels.subarray(lumaSize * 1.25), width, height);
  return { width, height, data, ptsSeconds: time, durationSeconds: 1 / fps, keyframe: true,
    native: { rgba: data, pixels, width, height, format: 0, colorspace: 5, fullRange: 0 } };
}
