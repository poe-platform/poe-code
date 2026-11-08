import { SsconvertError, type CapabilityContext } from "../../contracts.js";
import { ImageExportError } from "./formats.js";
import type { ImageSurface } from "./codecs.js";

/** Real raster codecs for the captured GdkPixbuf writable plugin IDs. */
export function encodeProfileRaster(image: NonNullable<ImageSurface["raster"]>, format: string, context: CapabilityContext): Uint8Array {
  const { width, height, rgba } = image;
  if (format === "ico" && (width > 256 || height > 256))
    throw new ImageExportError("Unknown failure while saving image");
  const rowStride = format === "bmp" ? Math.ceil(width * 3 / 4) * 4 : format === "ico" ? width * 4 : width * 3;
  const maskStride = format === "ico" ? Math.ceil(width / 32) * 4 : 0;
  const offset = format === "bmp" ? 54 : format === "ico" ? 62 : 140;
  const length = offset + (rowStride + maskStride) * height;
  if (!Number.isSafeInteger(length) || length > context.limits.outputBytes)
    throw new SsconvertError("resource-limit", "ssconvert image output bytes limit exceeded");
  context.signal.throwIfAborted();
  const bytes = new Uint8Array(length), view = new DataView(bytes.buffer);
  if (format === "tiff") {
    bytes.set([73, 73, 42, 0]); view.setUint32(4, 8, true); view.setUint16(8, 10, true);
    const tags = [[256, 4, 1, width], [257, 4, 1, height], [258, 3, 3, 134], [259, 3, 1, 1],
      [262, 3, 1, 2], [273, 4, 1, offset], [277, 3, 1, 3], [278, 4, 1, height],
      [279, 4, 1, rowStride * height], [284, 3, 1, 1]];
    for (const [index, tag] of tags.entries()) {
      const position = 10 + index * 12;
      view.setUint16(position, tag[0]!, true); view.setUint16(position + 2, tag[1]!, true);
      view.setUint32(position + 4, tag[2]!, true); view.setUint32(position + 8, tag[3]!, true);
    }
    for (let index = 0; index < 3; index++) view.setUint16(134 + index * 2, 8, true);
  } else {
    const dib = format === "bmp" ? 14 : 22;
    if (format === "bmp") {
      bytes.set([66, 77]); view.setUint32(2, length, true); view.setUint32(10, offset, true);
    } else {
      view.setUint16(2, 1, true); view.setUint16(4, 1, true);
      bytes[6] = width === 256 ? 0 : width; bytes[7] = height === 256 ? 0 : height;
      view.setUint16(10, 1, true); view.setUint16(12, 32, true);
      view.setUint32(14, length - 22, true); view.setUint32(18, 22, true);
    }
    view.setUint32(dib, 40, true); view.setInt32(dib + 4, width, true);
    view.setInt32(dib + 8, format === "ico" ? height * 2 : height, true);
    view.setUint16(dib + 12, 1, true); view.setUint16(dib + 14, format === "bmp" ? 24 : 32, true);
    view.setUint32(dib + 20, rowStride * height, true);
  }
  for (let y = 0; y < height; y++) {
    context.signal.throwIfAborted();
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      const target = offset + (format === "tiff" ? y : height - y - 1) * rowStride + x * (format === "ico" ? 4 : 3);
      const alpha = rgba[source + 3]!;
      for (let channel = 0; channel < 3; channel++) {
        const destination = format === "tiff" ? channel : 2 - channel;
        bytes[target + destination] = Math.floor((rgba[source + channel]! * alpha + 255 * (255 - alpha) + 127) / 255);
      }
      if (format === "ico") bytes[target + 3] = 255;
    }
  }
  return bytes;
}
