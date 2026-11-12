import { decodeImage } from "@poe-code/image-ast/portable";

export function decodeFfmpegImage(bytes: Uint8Array) {
  const image = decodeImage(bytes);
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
