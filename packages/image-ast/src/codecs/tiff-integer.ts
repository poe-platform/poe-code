/** Scale byte samples to the requested integer quantum width. Signed TIFF uses the same bits. */
export function encodeTiffIntegerSamples(bytes: Uint8Array, bits: 8 | 16 | 32 | undefined, little: boolean): Uint8Array {
  if (bits === undefined || bits === 8) return bytes;
  const output = new Uint8Array(bytes.length * bits / 8), view = new DataView(output.buffer);
  const scale = (2 ** bits - 1) / 255;
  for (let i = 0; i < bytes.length; i++) {
    if (bits === 16) view.setUint16(i * 2, bytes[i]! * scale, little);
    else view.setUint32(i * 4, bytes[i]! * scale, little);
  }
  return output;
}
