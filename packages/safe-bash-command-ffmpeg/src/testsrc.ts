/** Render FFmpeg's RGB testsrc calibration pattern into a budgeted RGBA frame. */
export function* renderTestsrc(data: Uint8Array, width: number, height: number, frame: number, fps: number, decimals: number): Generator<void> {
  const time = frame / fps;
  const radius = Math.floor((width + height) / 4);
  const origin = Math.floor(width * width / 4) + Math.floor(height * height / 4) - radius * radius;
  for (let y = 0; y < height; y++) {
    let color = 0;
    let remainder = 0;
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      if (offset % 4096 === 0) yield;
      const inside = origin + x * (x - width) + y * (y - height) < 0;
      const pixel = color ^ (inside ? 7 : 0);
      data[offset] = pixel & 1 ? 255 : 0;
      data[offset + 1] = pixel & 2 ? 255 : 0;
      data[offset + 2] = pixel & 4 ? 255 : 0;
      data[offset + 3] = 255;
      remainder += 8;
      if (remainder >= width) {
        remainder -= width;
        color++;
      }
    }
  }

  const gradientRow = Math.floor(height * 3 / 4);
  let gradient = Math.floor(256 * time) % 1536;
  let remainder = 0;
  for (let x = 0; x < width; x++) {
    if (x % 1024 === 0) yield;
    const offset = (gradientRow * width + x) * 4;
    data[offset] = gradient < 256 || gradient >= 1280 ? 255
      : gradient >= 512 && gradient < 1024 ? 0 : gradient < 512 ? 511 - gradient : gradient - 1024;
    data[offset + 1] = gradient >= 1024 ? 0 : gradient >= 256 && gradient < 768 ? 255
      : gradient < 256 ? gradient : 1023 - gradient;
    data[offset + 2] = gradient < 512 ? 0 : gradient >= 768 && gradient < 1280 ? 255
      : gradient < 768 ? gradient - 512 : 1535 - gradient;
    gradient += Math.floor(1536 / width);
    remainder += 1536 % width;
    // FFmpeg carries the residual at the gradient size, rather than the width.
    if (remainder >= 1536) {
      gradient++;
      remainder -= 1536;
    }
    gradient %= 1536;
  }
  for (let y = 1; y <= Math.floor(height / 8); y++) {
    yield;
    data.copyWithin((gradientRow + y) * width * 4, gradientRow * width * 4, (gradientRow + 1) * width * 4);
  }

  const segment = Math.floor(width / 80);
  // Scale before dividing so exact decimal ticks do not lose a digit to rounding.
  let second = Math.floor(frame * 10 ** decimals / fps);
  if (segment < 1 || height < 13 * segment || second >= 2147483647) return;
  const masks = [125, 96, 55, 103, 106, 79, 95, 97, 127, 111];
  const rectangles = [[1, 0, 5, 1], [1, 6, 5, 1], [1, 12, 5, 1], [0, 1, 1, 5], [0, 7, 1, 5], [6, 1, 1, 5], [6, 7, 1, 5]];
  let left = width - Math.floor((width - segment * 64) / 2);
  const top = Math.floor((height - segment * 13) / 2);
  for (let digit = 0; digit < 8; digit++) {
    left -= 8 * segment;
    const mask = masks[second % 10]!;
    for (let y = 0; y < 13 * segment; y++) {
      yield;
      for (let x = 0; x < 8 * segment; x++) {
        const sx = Math.floor(x / segment);
        const sy = Math.floor(y / segment);
        const lit = rectangles.some(([rx, ry, rw, rh], index) =>
          (mask & (1 << index)) !== 0 && sx >= rx! && sx < rx! + rw! && sy >= ry! && sy < ry! + rh!);
        const offset = ((top + y) * width + left + x) * 4;
        data[offset] = data[offset + 1] = data[offset + 2] = lit ? 255 : 0;
      }
    }
    second = Math.floor(second / 10);
    if (second === 0) break;
  }
}
