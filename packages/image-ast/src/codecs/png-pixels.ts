export function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function writePngPixel(rawData: Uint8Array, rowStart: number, x: number, outIdx: number, rgba: Uint8Array, bitDepth: number, colorType: number, palette?: Uint8Array, trns?: Uint8Array): void {
  if (bitDepth === 8) {
    if (colorType === 6) {
      const idx = rowStart + x * 4;
      rgba[outIdx] = rawData[idx]!;
      rgba[outIdx + 1] = rawData[idx + 1]!;
      rgba[outIdx + 2] = rawData[idx + 2]!;
      rgba[outIdx + 3] = rawData[idx + 3]!;
    } else if (colorType === 2) {
      const idx = rowStart + x * 3;
      const r = rawData[idx]!;
      const g = rawData[idx + 1]!;
      const b = rawData[idx + 2]!;
      let a = 255;
      if (trns && trns.length >= 6 && r === trns[1] && g === trns[3] && b === trns[5]) a = 0;
      rgba[outIdx] = r;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = b;
      rgba[outIdx + 3] = a;
    } else if (colorType === 4) {
      const idx = rowStart + x * 2;
      const g = rawData[idx]!;
      rgba[outIdx] = g;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = g;
      rgba[outIdx + 3] = rawData[idx + 1]!;
    } else if (colorType === 0) {
      const g = rawData[rowStart + x]!;
      const a = trns && trns.length >= 2 && g === trns[1] ? 0 : 255;
      rgba[outIdx] = g;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = g;
      rgba[outIdx + 3] = a;
    } else if (colorType === 3) {
      const pIdx = rawData[rowStart + x]!;
      rgba[outIdx] = palette ? (palette[pIdx * 3] ?? 0) : 0;
      rgba[outIdx + 1] = palette ? (palette[pIdx * 3 + 1] ?? 0) : 0;
      rgba[outIdx + 2] = palette ? (palette[pIdx * 3 + 2] ?? 0) : 0;
      rgba[outIdx + 3] = trns && pIdx < trns.length ? trns[pIdx]! : 255;
    }
  } else if (bitDepth === 16) {
    if (colorType === 6) {
      const idx = rowStart + x * 8;
      rgba[outIdx] = rawData[idx]!;
      rgba[outIdx + 1] = rawData[idx + 2]!;
      rgba[outIdx + 2] = rawData[idx + 4]!;
      rgba[outIdx + 3] = rawData[idx + 6]!;
    } else if (colorType === 2) {
      const idx = rowStart + x * 6;
      let a = 255;
      if (
        trns &&
        trns.length >= 6 &&
        rawData[idx] === trns[0] &&
        rawData[idx + 1] === trns[1] &&
        rawData[idx + 2] === trns[2] &&
        rawData[idx + 3] === trns[3] &&
        rawData[idx + 4] === trns[4] &&
        rawData[idx + 5] === trns[5]
      ) {
        a = 0;
      }
      rgba[outIdx] = rawData[idx]!;
      rgba[outIdx + 1] = rawData[idx + 2]!;
      rgba[outIdx + 2] = rawData[idx + 4]!;
      rgba[outIdx + 3] = a;
    } else if (colorType === 4) {
      const idx = rowStart + x * 4;
      const g = rawData[idx]!;
      rgba[outIdx] = g;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = g;
      rgba[outIdx + 3] = rawData[idx + 2]!;
    } else {
      const idx = rowStart + x * 2;
      const g = rawData[idx]!;
      const a =
        trns && trns.length >= 2 && rawData[idx] === trns[0] && rawData[idx + 1] === trns[1]
          ? 0
          : 255;
      rgba[outIdx] = g;
      rgba[outIdx + 1] = g;
      rgba[outIdx + 2] = g;
      rgba[outIdx + 3] = a;
    }
  } else {
    const pixelsPerByte = 8 / bitDepth;
    const byteIndex = rowStart + Math.floor(x / pixelsPerByte);
    const shift = (pixelsPerByte - 1 - (x % pixelsPerByte)) * bitDepth;
    const mask = (1 << bitDepth) - 1;
    const sample = (rawData[byteIndex]! >>> shift) & mask;
    if (colorType === 3) {
      rgba[outIdx] = palette ? (palette[sample * 3] ?? 0) : 0;
      rgba[outIdx + 1] = palette ? (palette[sample * 3 + 1] ?? 0) : 0;
      rgba[outIdx + 2] = palette ? (palette[sample * 3 + 2] ?? 0) : 0;
      rgba[outIdx + 3] = trns && sample < trns.length ? trns[sample]! : 255;
    } else {
      const scaled = Math.round((sample * 255) / mask);
      const a = trns && trns.length >= 2 && sample === trns[1] ? 0 : 255;
      rgba[outIdx] = scaled;
      rgba[outIdx + 1] = scaled;
      rgba[outIdx + 2] = scaled;
      rgba[outIdx + 3] = a;
    }
  }
}
