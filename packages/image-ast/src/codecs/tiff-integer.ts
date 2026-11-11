/** Scale integer samples to the requested quantum width. Signed TIFF uses the same bits. */
export function encodeTiffIntegerSamples(samples: Uint8Array | Uint16Array, bits: 8 | 16 | 32 | undefined, little: boolean): Uint8Array {
  bits ??= 8;
  if (bits === 8 && samples instanceof Uint8Array) return samples;
  const output = new Uint8Array(samples.length * bits / 8), view = new DataView(output.buffer);
  const scale = (2 ** bits - 1) / (samples instanceof Uint16Array ? 65535 : 255);
  for (let i = 0; i < samples.length; i++) {
    const value = Math.round(samples[i]! * scale);
    if (bits === 8) output[i] = value;
    else if (bits === 16) view.setUint16(i * 2, value, little);
    else view.setUint32(i * 4, value, little);
  }
  return output;
}
