import { crc32 } from "@poe-code/office-package";
import { OfficeError } from "./errors.js";
function invalid(): never {
  throw new OfficeError(
    "invalid-value",
    "Picture input requires a complete PNG or JPEG container.",
    "validate-intent"
  );
}
export function validatePictureInput(bytes: Uint8Array): "png" | "jpeg" {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n)) {
    let offset = 8,
      header = false,
      data = false;
    while (offset + 12 <= bytes.length) {
      const size = view.getUint32(offset),
        tag = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12) invalid();
      if (
        crc32(bytes.subarray(offset + 4, offset + 8 + size)) !== view.getUint32(offset + 8 + size)
      )
        invalid();
      if (!header && tag !== "IHDR") invalid();
      if (tag === "IHDR") {
        if (
          header ||
          size !== 13 ||
          view.getUint32(offset + 8) === 0 ||
          view.getUint32(offset + 12) === 0 ||
          bytes[offset + 18] !== 0 ||
          bytes[offset + 19] !== 0 ||
          ![0, 1].includes(bytes[offset + 20]!)
        )
          invalid();
        const depths: Record<number, readonly number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16]
        };
        if (!depths[bytes[offset + 17]!]?.includes(bytes[offset + 16]!)) invalid();
        header = true;
      }
      if (tag === "IDAT") data = true;
      offset += size + 12;
      if (tag === "IEND") {
        if (size !== 0 || !data || offset !== bytes.length) invalid();
        return "png";
      }
    }
    invalid();
  }
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2,
      frame = false,
      scan = false;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) invalid();
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined) invalid();
      if (marker === 217) {
        if (!frame || !scan || offset !== bytes.length) invalid();
        return "jpeg";
      }
      if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215)) invalid();
      if (offset + 2 > bytes.length) invalid();
      const size = view.getUint16(offset);
      if (size < 2 || size > bytes.length - offset) invalid();
      if ([192, 193, 194].includes(marker)) {
        if (
          frame ||
          size < 8 ||
          view.getUint16(offset + 3) === 0 ||
          view.getUint16(offset + 5) === 0 ||
          size !== 8 + 3 * bytes[offset + 7]!
        )
          invalid();
        frame = true;
      }
      offset += size;
      if (marker === 218) {
        if (!frame || size < 6) invalid();
        scan = true;
        while (offset < bytes.length) {
          if (bytes[offset] !== 255) {
            offset++;
            continue;
          }
          const next = bytes[offset + 1];
          if (next === 0 || (next !== undefined && next >= 208 && next <= 215)) {
            offset += 2;
            continue;
          }
          break;
        }
      }
    }
    invalid();
  }
  invalid();
}
