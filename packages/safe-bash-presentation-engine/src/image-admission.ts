import { crc32 } from "@poe-code/office-package";
import { OfficeError } from "./errors.js";
import { imageMetadata, type ImageMetadata } from "./image-metadata.js";

function invalid(message: string): never {
  throw new OfficeError("invalid-value", message, "admit");
}
function dimensions(width: number, height: number): void {
  if (width === 0 || height === 0) invalid("Image dimensions must be positive.");
  if (width > 1_000_000 || height > 1_000_000 || width * height > 100_000_000)
    throw new OfficeError(
      "resource-limit",
      "Image pixel dimensions exceed the admission budget.",
      "admit"
    );
}
function png(bytes: Uint8Array, view: DataView): void {
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    invalid("Invalid PNG signature.");
  let offset = 8,
    header = false,
    data = false,
    palette = false,
    endedData = false,
    color = 0;
  while (offset <= bytes.length - 12) {
    const length = view.getUint32(offset);
    if (length > bytes.length - offset - 12) invalid("Truncated PNG chunk.");
    const name = bytes.subarray(offset + 4, offset + 8);
    if (
      !name.every((byte) => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122)) ||
      (name[2]! & 32) !== 0
    )
      invalid("Invalid PNG chunk name.");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (
      crc32(bytes.subarray(offset + 4, offset + 8 + length)) !== view.getUint32(offset + 8 + length)
    )
      invalid("Invalid PNG chunk checksum.");
    if (!header && type !== "IHDR") invalid("PNG must start with its image header.");
    if (type === "IHDR") {
      if (header || length !== 13) invalid("Invalid PNG image header.");
      dimensions(view.getUint32(offset + 8), view.getUint32(offset + 12));
      const depth = bytes[offset + 16]!;
      color = bytes[offset + 17]!;
      const depths: Record<number, readonly number[]> = {
        0: [1, 2, 4, 8, 16],
        2: [8, 16],
        3: [1, 2, 4, 8],
        4: [8, 16],
        6: [8, 16]
      };
      if (
        !depths[color]?.includes(depth) ||
        bytes[offset + 18] !== 0 ||
        bytes[offset + 19] !== 0 ||
        bytes[offset + 20]! > 1
      )
        invalid("Unsupported PNG header fields.");
      header = true;
    } else if (type === "PLTE") {
      if (
        palette ||
        data ||
        length === 0 ||
        length > 768 ||
        length % 3 !== 0 ||
        color === 0 ||
        color === 4
      )
        invalid("Invalid PNG palette.");
      palette = true;
    } else if (type === "IDAT") {
      if (endedData || (color === 3 && !palette)) invalid("Invalid PNG image data order.");
      data = true;
    } else if (type === "IEND") {
      if (!data || length !== 0 || offset + 12 !== bytes.length) invalid("Invalid PNG ending.");
      return;
    } else {
      if (data) endedData = true;
      if ((bytes[offset + 4]! & 32) === 0) invalid("Unsupported critical PNG chunk.");
    }
    offset += length + 12;
  }
  invalid("PNG is missing its ending.");
}
function gif(bytes: Uint8Array, view: DataView): void {
  const signature = String.fromCharCode(...bytes.subarray(0, 6));
  if (bytes.length < 13 || (signature !== "GIF87a" && signature !== "GIF89a"))
    invalid("Invalid GIF header.");
  const width = view.getUint16(6, true),
    height = view.getUint16(8, true);
  dimensions(width, height);
  let offset = 13 + (bytes[10]! & 128 ? 3 * 2 ** ((bytes[10]! & 7) + 1) : 0),
    frames = 0,
    pixels = 0;
  while (offset < bytes.length) {
    const marker = bytes[offset++];
    if (marker === 59) {
      if (!frames || offset !== bytes.length) invalid("Invalid GIF ending.");
      return;
    }
    if (marker === 44) {
      if (offset > bytes.length - 9) invalid("Truncated GIF image descriptor.");
      const left = view.getUint16(offset, true),
        top = view.getUint16(offset + 2, true);
      const frameWidth = view.getUint16(offset + 4, true),
        frameHeight = view.getUint16(offset + 6, true);
      dimensions(frameWidth, frameHeight);
      if (left + frameWidth > width || top + frameHeight > height)
        invalid("GIF frame exceeds logical screen.");
      pixels += frameWidth * frameHeight;
      if (pixels > 100_000_000)
        throw new OfficeError("resource-limit", "GIF frame pixel budget exceeded.", "admit");
      const packed = bytes[offset + 8]!;
      offset += 9 + (packed & 128 ? 3 * 2 ** ((packed & 7) + 1) : 0);
      if (offset >= bytes.length || bytes[offset]! < 2 || bytes[offset]! > 8)
        invalid("Invalid GIF code size.");
      offset++;
      frames++;
    } else if (marker === 33) {
      if (offset >= bytes.length) invalid("Truncated GIF extension.");
      offset++;
    } else invalid("Invalid GIF block marker.");
    while (true) {
      if (offset >= bytes.length) invalid("Truncated GIF data block.");
      const length = bytes[offset++]!;
      if (length === 0) break;
      if (length > bytes.length - offset) invalid("Truncated GIF data block.");
      offset += length;
    }
  }
  invalid("GIF is missing its ending.");
}
function jpeg(bytes: Uint8Array, view: DataView): void {
  if (bytes[0] !== 255 || bytes[1] !== 216) invalid("Invalid JPEG signature.");
  let offset = 2,
    entropy = false;
  while (offset < bytes.length) {
    if (entropy && bytes[offset] !== 255) {
      offset++;
      continue;
    }
    if (bytes[offset++] !== 255) invalid("Invalid JPEG marker.");
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 217) {
      if (offset !== bytes.length) invalid("Unexpected bytes after JPEG ending.");
      return;
    }
    if (entropy && marker === 0) continue;
    if (marker === undefined || marker === 0 || marker === 216) invalid("Invalid JPEG marker.");
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    entropy = false;
    if (offset > bytes.length - 2) invalid("Truncated JPEG segment.");
    const length = view.getUint16(offset);
    if (length < 2 || length > bytes.length - offset) invalid("Invalid JPEG segment length.");
    if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
      if (length < 8 || bytes[offset + 7] === 0 || length !== 8 + 3 * bytes[offset + 7]!)
        invalid("Invalid JPEG frame header.");
      dimensions(view.getUint16(offset + 5), view.getUint16(offset + 3));
    }
    if (marker === 218) {
      if (length < 6 || bytes[offset + 2] === 0 || length !== 6 + 2 * bytes[offset + 2]!)
        invalid("Invalid JPEG scan header.");
      entropy = true;
    }
    offset += length;
  }
  invalid("JPEG is missing its ending.");
}

function bmp(bytes: Uint8Array, view: DataView): void {
  if (bytes.length < 26 || bytes[0] !== 66 || bytes[1] !== 77) invalid("Invalid BMP header.");
  if (view.getUint32(2, true) !== bytes.length) invalid("Invalid BMP byte length.");
  const header = view.getUint32(14, true),
    pixelOffset = view.getUint32(10, true);
  if (![12, 40, 52, 56, 108, 124].includes(header) || header > bytes.length - 14)
    invalid("Unsupported or truncated BMP information header.");
  if (pixelOffset < 14 + header || pixelOffset >= bytes.length)
    invalid("Invalid BMP pixel offset.");
  const planes = view.getUint16(header === 12 ? 22 : 26, true);
  const depth = view.getUint16(header === 12 ? 24 : 28, true);
  if (planes !== 1 || ![1, 4, 8, 16, 24, 32].includes(depth))
    invalid("Invalid BMP planes or bit depth.");
  const metadata = imageMetadata(bytes, "image/bmp");
  if (!metadata.pixelWidth || !metadata.pixelHeight) invalid("Invalid BMP dimensions.");
  dimensions(metadata.pixelWidth, metadata.pixelHeight);
  const compression = header === 12 ? 0 : view.getUint32(30, true);
  if (compression === 0) {
    const stride = Math.ceil((metadata.pixelWidth * depth) / 32) * 4;
    if (stride * metadata.pixelHeight > bytes.length - pixelOffset)
      invalid("Truncated BMP pixels.");
  }
}
function tiff(bytes: Uint8Array, view: DataView): void {
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (
    bytes.length < 8 ||
    (!little && !(bytes[0] === 77 && bytes[1] === 77)) ||
    view.getUint16(2, little) !== 42
  )
    invalid("Invalid TIFF header.");
  let offset = view.getUint32(4, little);
  const visited = new Set<number>();
  while (offset !== 0) {
    if (visited.has(offset) || offset < 8 || offset > bytes.length - 6)
      invalid("Invalid TIFF directory offset.");
    visited.add(offset);
    const count = view.getUint16(offset, little);
    if (count > Math.floor((bytes.length - offset - 6) / 12)) invalid("Truncated TIFF directory.");
    for (let index = 0; index < count; index++) {
      const entry = offset + 2 + index * 12,
        type = view.getUint16(entry + 2, little);
      const widths = [0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8];
      const width = widths[type];
      if (!width) invalid("Unsupported TIFF field type.");
      const size = view.getUint32(entry + 4, little) * width;
      if (size > 4) {
        const pointer = view.getUint32(entry + 8, little);
        if (pointer < 8 || pointer > bytes.length || size > bytes.length - pointer)
          invalid("Truncated TIFF field.");
      }
    }
    offset = view.getUint32(offset + 2 + count * 12, little);
  }
  const metadata = imageMetadata(bytes, "image/tiff");
  if (!metadata.pixelWidth || !metadata.pixelHeight) invalid("TIFF dimensions are missing.");
  dimensions(metadata.pixelWidth, metadata.pixelHeight);
}
function wmf(bytes: Uint8Array, view: DataView): void {
  if (bytes.length < 46 || view.getUint32(0, true) !== 0x9ac6cdd7)
    invalid("A placeable WMF header is required.");
  let checksum = 0;
  for (let offset = 0; offset < 20; offset += 2) checksum ^= view.getUint16(offset, true);
  if (checksum !== view.getUint16(20, true) || view.getUint16(14, true) === 0)
    invalid("Invalid WMF placeable header.");
  if (
    ![1, 2].includes(view.getUint16(22, true)) ||
    view.getUint16(24, true) !== 9 ||
    ![0x100, 0x300].includes(view.getUint16(26, true)) ||
    view.getUint32(28, true) * 2 !== bytes.length - 22
  )
    invalid("Invalid WMF standard header.");
  let offset = 40;
  while (offset <= bytes.length - 6) {
    const words = view.getUint32(offset, true),
      type = view.getUint16(offset + 4, true);
    if (words < 3 || words * 2 > bytes.length - offset) invalid("Invalid WMF record size.");
    offset += words * 2;
    if (type === 0) {
      if (words !== 3 || offset !== bytes.length) invalid("Invalid WMF ending.");
      const metadata = imageMetadata(bytes, "image/x-wmf");
      if (!metadata.pixelWidth || !metadata.pixelHeight) invalid("Invalid WMF bounds.");
      dimensions(metadata.pixelWidth, metadata.pixelHeight);
      return;
    }
  }
  invalid("WMF is missing its ending.");
}

export function admitImage(
  bytes: Uint8Array,
  contentType: string
): ImageMetadata & { extension: string } {
  if (!(bytes instanceof Uint8Array))
    throw new OfficeError("invalid-type", "Image bytes must be a Uint8Array.", "admit");
  if (bytes.byteLength > 32 * 1024 * 1024)
    throw new OfficeError("resource-limit", "Encoded image exceeds 32 MiB.", "admit");
  if (typeof contentType !== "string")
    throw new OfficeError("invalid-type", "Image content type must be a string.", "admit");
  const formats: Record<
    string,
    { extension: string; validate: (bytes: Uint8Array, view: DataView) => void }
  > = {
    "image/png": { extension: "png", validate: png },
    "image/jpeg": { extension: "jpg", validate: jpeg },
    "image/gif": { extension: "gif", validate: gif },
    "image/bmp": { extension: "bmp", validate: bmp },
    "image/tiff": { extension: "tiff", validate: tiff },
    "image/x-wmf": { extension: "wmf", validate: wmf }
  };
  const format = Object.hasOwn(formats, contentType) ? formats[contentType] : undefined;
  if (!format)
    throw new OfficeError("unsupported-profile", "Unsupported image content type.", "admit");
  format.validate(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { ...imageMetadata(bytes, contentType), extension: format.extension };
}
