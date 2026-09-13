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
    "image/gif": { extension: "gif", validate: gif }
  };
  const format = Object.hasOwn(formats, contentType) ? formats[contentType] : undefined;
  if (!format)
    throw new OfficeError(
      "unsupported-profile",
      "Image content type must be image/png, image/jpeg or image/gif.",
      "admit"
    );
  format.validate(bytes, new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength));
  return { ...imageMetadata(bytes, contentType), extension: format.extension };
}
