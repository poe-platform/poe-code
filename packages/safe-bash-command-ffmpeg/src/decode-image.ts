import { decodeImage, parseNetpbmHeader } from "@poe-code/image-ast/portable";

export function decodeFfmpegImage(bytes: Uint8Array) {
  if (bytes[0] === 80 && [52, 53, 54].includes(bytes[1]!)) {
    const { dataOffset } = parseNetpbmHeader(bytes);
    // FFmpeg consumes one separator byte; the shared decoder treats CRLF as a pair.
    // Preserve the LF sample without changing the original packet used by stream copy.
    if (bytes[dataOffset - 2] === 13 && bytes[dataOffset - 1] === 10) {
      bytes = new Uint8Array(bytes);
      bytes[dataOffset - 2] = 10;
    }
  }
  const image = decodeImage(bytes);
  if (image.format === "pgm" && bytes[1] === 0x35) {
    const { maxval, dataOffset } = parseNetpbmHeader(bytes);
    const wide = maxval > 255;
    const maximum = wide ? 65535 : 255;
    if (maxval >= maximum) return image;
    const shift = wide ? 15 : 7;
    const rounding = wide ? 16384 : 64;
    const factor = Math.floor((maximum * (2 ** shift) + Math.floor(maxval / 2)) / maxval);
    // FFmpeg uses a fixed-point multiplier and wraps to the output sample width.
    // In particular, MAXVAL 254/65534 maps its maximum sample back to zero.
    for (let pixel = 0; pixel < image.width * image.height; pixel++) {
      const offset = dataOffset + pixel * (wide ? 2 : 1);
      const sample = wide ? ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0) : bytes[offset] ?? 0;
      const value = ((sample * factor + rounding) >>> shift) & maximum;
      for (let channel = 0; channel < 3; channel++) {
        image.data[pixel * 4 + channel] = wide ? Math.round(value / 257) : value;
        if (image.data16) image.data16[pixel * 4 + channel] = wide ? value : value * 257;
      }
    }
    delete image.evaluateSamples;
    return image;
  }
  if (image.format !== "bmp" || bytes.byteLength < 54) return image;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (header.getUint32(14, true) < 40 || header.getUint16(28, true) !== 16) return image;
  const compression = header.getUint32(30, true);
  const masks = compression === 0 ? [0x7c00, 0x03e0, 0x001f]
    : compression === 3 && bytes.byteLength >= 66
      ? [header.getUint32(54, true), header.getUint32(58, true), header.getUint32(62, true)]
      : [];
  const bits = masks[0] === 0x0f00 && masks[1] === 0x00f0 && masks[2] === 0x000f ? [4, 4, 4]
    : masks[0] === 0xf800 && masks[1] === 0x07e0 && masks[2] === 0x001f ? [5, 6, 5]
      : masks[0] === 0x7c00 && masks[1] === 0x03e0 && masks[2] === 0x001f ? [5, 5, 5] : undefined;
  if (!bits) return image;
  // Recover the packed samples from the image decoder's full-range scaling.
  // FFmpeg shifts 4-bit channels and replicates high bits for 5/6-bit channels.
  for (let i = 0; i < image.data.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      const depth = bits[channel]!;
      const sample = image.data[i + channel]! >> (8 - depth);
      image.data[i + channel] = (sample << (8 - depth)) | (depth === 4 ? 0 : sample >> (2 * depth - 8));
    }
  }
  return image;
}
