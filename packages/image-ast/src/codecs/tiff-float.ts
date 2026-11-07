/** Convert an IEEE TIFF sample in the normalized 0..1 range to an RGBA byte. */
export function readTiffFloat8(view: DataView, offset: number, bits: number, little: boolean): number {
  let value: number;
  if (bits === 16) {
    const half = view.getUint16(offset, little), exponent = (half >>> 10) & 31, fraction = half & 1023;
    value = exponent === 0 ? fraction * 2 ** -24 : exponent === 31 ? fraction ? NaN : Infinity : (1 + fraction / 1024) * 2 ** (exponent - 15);
    if (half & 0x8000) value = -value;
  } else if (bits === 32) value = view.getFloat32(offset, little);
  else if (bits === 64) value = view.getFloat64(offset, little);
  else throw new Error(`Unsupported floating-point TIFF sample width: ${bits}`);
  return Number.isNaN(value) ? 0 : Math.round(Math.max(0, Math.min(1, value)) * 255);
}
