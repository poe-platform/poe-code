/** Alpha plane of FFmpeg's YUVA420P testsrc2, independent of its RGB pattern. */
export function* renderTestsrc2Alpha(data: Uint8Array, width: number, height: number, time: number, alpha: number): Generator<void> {
  for (let offset = 3; offset < data.length; offset += 4) {
    if (offset % 4096 === 3) yield;
    data[offset] = alpha;
  }
  const rectangles: number[][] = [];
  if (width >= 64 && height >= 64) {
    const length = (Math.min(width, height) - 16) >> 2;
    const phase = Math.round(time * (length << 3) / 4);
    const step = Math.floor(phase / length);
    const size = step & 1 ? length - phase % length : phase % length;
    const mode = (step >> 1) & 3;
    const xc = width >> 2;
    const yc = (height >> 2) + (height >> 1);
    if (mode === 0 || mode === 2) rectangles.push([xc - 4 - size, yc - 8, xc + 4 + size, yc + 8]);
    if (mode === 1 || mode === 2) rectangles.push([xc - 8, yc - 4 - size, xc + 8, yc + 4 + size]);
    if (mode === 3) rectangles.push([xc - 4 - size, yc - 4 - size, xc + 4 + size, yc + 4 + size]);
  }
  if (width >= 16 && height >= 16) {
    const w = width - 8;
    const h = height - 8;
    let x = Math.round(time * 55 * w / 233) % (2 * w);
    let y = Math.round(time * 89 * h / 233) % (2 * h);
    if (x > w) x = 2 * w - x;
    if (y > h) y = 2 * h - y;
    x &= ~1;
    y &= ~1;
    rectangles.push([x, y, x + 8, y + 8]);
  }
  // Rectangle coordinates follow the source's 2x2 chroma grid. Blended
  // text and noise affect color only; filled rectangles overwrite alpha.
  for (const [left, top, right, bottom] of rectangles) {
    for (let y = top! & ~1; y < Math.min(height, (bottom! + 1) & ~1); y++) {
      yield;
      for (let x = left! & ~1; x < Math.min(width, (right! + 1) & ~1); x++) data[(y * width + x) * 4 + 3] = 255;
    }
  }
}
