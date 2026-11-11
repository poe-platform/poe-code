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

/** Serialize normalized RGBA bytes as IEEE samples, after channel/plane selection. */
export function encodeTiffFloatSamples(bytes: Uint8Array | Uint16Array, bits: 16 | 32 | 64, little: boolean): Uint8Array {
  const output = new Uint8Array(bytes.length * bits / 8), view = new DataView(output.buffer);
  for (let i = 0; i < bytes.length; i++) {
    const value = bytes[i]! / (bytes instanceof Uint16Array ? 65535 : 255), offset = i * bits / 8;
    if (bits === 32) view.setFloat32(offset, value, little);
    else if (bits === 64) view.setFloat64(offset, value, little);
    else {
      // Nonzero byte samples are normal binary16 values; zero is exact.
      const exponent = value === 0 ? 0 : Math.floor(Math.log2(value));
      const half = value === 0 ? 0 : (exponent + 15) * 1024 + Math.round((value / 2 ** exponent - 1) * 1024);
      view.setUint16(offset, half, little);
    }
  }
  return output;
}
