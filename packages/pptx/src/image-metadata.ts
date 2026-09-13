export interface ImageMetadata {
  pixelWidth: number | null;
  pixelHeight: number | null;
  dpiX: number;
  dpiY: number;
}

export function normalizeImageDpi(value: unknown): [number, number] {
  const axes: unknown[] = Array.isArray(value) ? value : [];
  const axis = (raw: unknown): number => {
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 72;
    const rounded = Math.round(raw);
    return rounded >= 1 && rounded <= 2048 ? rounded : 72;
  };
  return [axis(axes[0]), axis(axes[1])];
}

function tiffMetadata(bytes: Uint8Array): ImageMetadata {
  const result: ImageMetadata = { pixelWidth: null, pixelHeight: null, dpiX: 72, dpiY: 72 };
  if (bytes.length < 8) return result;
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) return result;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint16(2, little) !== 42) return result;
  const start = view.getUint32(4, little);
  if (start < 8 || start > bytes.length - 2) return result;
  const count = view.getUint16(start, little);
  if (count > Math.floor((bytes.length - start - 2) / 12)) return result;
  let x: number | undefined,
    y: number | undefined,
    unit = 2;
  for (let index = 0; index < count; index++) {
    const offset = start + 2 + index * 12;
    const tag = view.getUint16(offset, little),
      type = view.getUint16(offset + 2, little);
    if (view.getUint32(offset + 4, little) !== 1) continue;
    let value: number | undefined;
    if (type === 3) value = view.getUint16(offset + 8, little);
    if (type === 4) value = view.getUint32(offset + 8, little);
    if (type === 5) {
      const pointer = view.getUint32(offset + 8, little);
      if (pointer <= bytes.length - 8) {
        const denominator = view.getUint32(pointer + 4, little);
        if (denominator !== 0) value = view.getUint32(pointer, little) / denominator;
      }
    }
    if (value === undefined) continue;
    if (tag === 256 && (type === 3 || type === 4) && value > 0) result.pixelWidth = value;
    if (tag === 257 && (type === 3 || type === 4) && value > 0) result.pixelHeight = value;
    if (tag === 282) x = value;
    if (tag === 283) y = value;
    if (tag === 296) unit = value;
  }
  const multiplier = unit === 3 ? 2.54 : unit === 2 ? 1 : 0;
  [result.dpiX, result.dpiY] = normalizeImageDpi([
    x === undefined ? null : x * multiplier,
    y === undefined ? null : y * multiplier
  ]);
  return result;
}

/** Reads bounded container metadata only; does not validate or decode image pixels. */
export function imageMetadata(bytes: Uint8Array, mediaType: string): ImageMetadata {
  if (mediaType === "image/tiff") return tiffMetadata(bytes);
  const result: ImageMetadata = { pixelWidth: null, pixelHeight: null, dpiX: 72, dpiY: 72 };
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const matches = (offset: number, values: readonly number[]): boolean =>
    values.every((value, index) => bytes[offset + index] === value);
  if (
    mediaType === "image/png" &&
    bytes.length >= 33 &&
    matches(0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
    view.getUint32(8) === 13 &&
    matches(12, [73, 72, 68, 82])
  ) {
    result.pixelWidth = view.getUint32(16) || null;
    result.pixelHeight = view.getUint32(20) || null;
    let offset = 33;
    while (offset <= bytes.length - 12) {
      const length = view.getUint32(offset);
      if (length > bytes.length - offset - 12) break;
      if (matches(offset + 4, [112, 72, 89, 115]) && length === 9 && bytes[offset + 16] === 1) {
        [result.dpiX, result.dpiY] = normalizeImageDpi([
          view.getUint32(offset + 8) * 0.0254,
          view.getUint32(offset + 12) * 0.0254
        ]);
      }
      if (matches(offset + 4, [73, 69, 78, 68])) break;
      offset += length + 12;
    }
  } else if (
    mediaType === "image/gif" &&
    bytes.length >= 13 &&
    (matches(0, [71, 73, 70, 56, 55, 97]) || matches(0, [71, 73, 70, 56, 57, 97]))
  ) {
    result.pixelWidth = view.getUint16(6, true) || null;
    result.pixelHeight = view.getUint16(8, true) || null;
  } else if (mediaType === "image/bmp" && bytes.length >= 26 && matches(0, [66, 77])) {
    const headerSize = view.getUint32(14, true);
    if (headerSize === 12) {
      result.pixelWidth = view.getUint16(18, true) || null;
      result.pixelHeight = view.getUint16(20, true) || null;
    } else if (headerSize >= 40 && headerSize <= bytes.length - 14) {
      const width = view.getInt32(18, true),
        height = view.getInt32(22, true);
      result.pixelWidth = width > 0 ? width : null;
      result.pixelHeight = Math.abs(height) || null;
      [result.dpiX, result.dpiY] = normalizeImageDpi([
        view.getInt32(38, true) * 0.0254,
        view.getInt32(42, true) * 0.0254
      ]);
    }
  } else if (mediaType === "image/jpeg" && matches(0, [255, 216])) {
    let offset = 2;
    while (offset < bytes.length) {
      if (bytes[offset++] !== 255) break;
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === undefined || marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset > bytes.length - 2) break;
      const length = view.getUint16(offset);
      if (length < 2 || length > bytes.length - offset) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 8
      ) {
        result.pixelHeight = view.getUint16(offset + 3) || null;
        result.pixelWidth = view.getUint16(offset + 5) || null;
      }
      if (marker === 224 && length >= 16 && matches(offset + 2, [74, 70, 73, 70, 0])) {
        const unit = bytes[offset + 9],
          multiplier = unit === 1 ? 1 : unit === 2 ? 2.54 : 0;
        [result.dpiX, result.dpiY] = normalizeImageDpi([
          view.getUint16(offset + 10) * multiplier,
          view.getUint16(offset + 12) * multiplier
        ]);
      }
      if (marker === 225 && length >= 16 && matches(offset + 2, [69, 120, 105, 102, 0, 0])) {
        const metadata = tiffMetadata(bytes.subarray(offset + 8, offset + length));
        result.dpiX = metadata.dpiX;
        result.dpiY = metadata.dpiY;
      }
      offset += length;
    }
  }
  return result;
}
