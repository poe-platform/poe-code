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
    const lower = Math.floor(raw);
    const rounded = raw - lower === 0.5 ? lower + (lower % 2 === 0 ? 0 : 1) : Math.round(raw);
    return rounded >= 1 && rounded <= 2048 ? rounded : 72;
  };
  return [axis(axes[0]), axis(axes[1])];
}

interface MetadataRange {
  readonly offset: number;
  readonly length: number;
}
type MetadataReader<T> = Generator<MetadataRange, T, Uint8Array>;
const emptyMetadata = (): ImageMetadata => ({
  pixelWidth: null,
  pixelHeight: null,
  dpiX: 72,
  dpiY: 72
});
function* read(offset: number, length: number): MetadataReader<DataView> {
  const bytes = yield { offset, length };
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}
const matches = (bytes: DataView, offset: number, values: readonly number[]) =>
  values.every(
    (value, index) => offset + index < bytes.byteLength && bytes.getUint8(offset + index) === value
  );

function* tiffMetadata(size: number, base = 0): MetadataReader<ImageMetadata> {
  const result = emptyMetadata();
  if (size < 8) return result;
  const header = yield* read(base, 8),
    little = matches(header, 0, [73, 73]);
  if ((!little && !matches(header, 0, [77, 77])) || header.getUint16(2, little) !== 42)
    return result;
  const start = header.getUint32(4, little);
  if (start < 8 || start > size - 2) return result;
  const count = (yield* read(base + start, 2)).getUint16(0, little);
  if (count > Math.floor((size - start - 2) / 12)) return result;
  let x: number | undefined,
    y: number | undefined,
    unit = 2;
  for (let index = 0; index < count; index++) {
    const entry = yield* read(base + start + 2 + index * 12, 12),
      tag = entry.getUint16(0, little),
      type = entry.getUint16(2, little);
    if (entry.getUint32(4, little) !== 1) continue;
    let value: number | undefined;
    if (type === 3) value = entry.getUint16(8, little);
    if (type === 4) value = entry.getUint32(8, little);
    if (type === 5) {
      const pointer = entry.getUint32(8, little);
      if (pointer <= size - 8) {
        const fraction = yield* read(base + pointer, 8),
          denominator = fraction.getUint32(4, little);
        if (denominator !== 0) value = fraction.getUint32(0, little) / denominator;
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

/** Requests bounded metadata fields; pixel payloads are never decoded or retained. */
function* metadataRanges(size: number, mediaType: string): MetadataReader<ImageMetadata> {
  if (mediaType === "image/tiff") return yield* tiffMetadata(size);
  const result = emptyMetadata(),
    header = yield* read(0, Math.min(size, 54));
  if (mediaType === "image/x-wmf" && size >= 22 && header.getUint32(0, true) === 0x9ac6cdd7) {
    const units = header.getUint16(14, true),
      width = header.getInt16(10, true) - header.getInt16(6, true),
      height = header.getInt16(12, true) - header.getInt16(8, true);
    if (units && width > 0 && height > 0) {
      result.pixelWidth = Math.max(1, Math.floor((width * 72) / units));
      result.pixelHeight = Math.max(1, Math.floor((height * 72) / units));
    }
  } else if (
    mediaType === "image/png" &&
    size >= 33 &&
    matches(header, 0, [137, 80, 78, 71, 13, 10, 26, 10]) &&
    header.getUint32(8) === 13 &&
    matches(header, 12, [73, 72, 68, 82])
  ) {
    result.pixelWidth = header.getUint32(16) || null;
    result.pixelHeight = header.getUint32(20) || null;
    let offset = 33;
    while (offset <= size - 12) {
      const chunk = yield* read(offset, 8),
        length = chunk.getUint32(0);
      if (length > size - offset - 12) break;
      if (matches(chunk, 4, [112, 72, 89, 115]) && length === 9) {
        const physical = yield* read(offset + 8, 9);
        if (physical.getUint8(8) === 1)
          [result.dpiX, result.dpiY] = normalizeImageDpi([
            physical.getUint32(0) * 0.0254,
            physical.getUint32(4) * 0.0254
          ]);
      }
      if (matches(chunk, 4, [73, 69, 78, 68])) break;
      offset += length + 12;
    }
  } else if (
    mediaType === "image/gif" &&
    size >= 13 &&
    (matches(header, 0, [71, 73, 70, 56, 55, 97]) || matches(header, 0, [71, 73, 70, 56, 57, 97]))
  ) {
    result.pixelWidth = header.getUint16(6, true) || null;
    result.pixelHeight = header.getUint16(8, true) || null;
  } else if (mediaType === "image/bmp" && size >= 26 && matches(header, 0, [66, 77])) {
    const headerSize = header.getUint32(14, true);
    if (headerSize === 12) {
      result.pixelWidth = header.getUint16(18, true) || null;
      result.pixelHeight = header.getUint16(20, true) || null;
    } else if (headerSize >= 40 && headerSize <= size - 14) {
      const width = header.getInt32(18, true),
        height = header.getInt32(22, true);
      result.pixelWidth = width > 0 ? width : null;
      result.pixelHeight = Math.abs(height) || null;
      [result.dpiX, result.dpiY] = normalizeImageDpi([
        header.getInt32(38, true) * 0.0254,
        header.getInt32(42, true) * 0.0254
      ]);
    }
  } else if (mediaType === "image/jpeg" && matches(header, 0, [255, 216])) {
    let offset = 2;
    while (offset < size) {
      if ((yield* read(offset++, 1)).getUint8(0) !== 255) break;
      let marker: number | undefined;
      while (offset < size) {
        marker = (yield* read(offset++, 1)).getUint8(0);
        if (marker !== 255) break;
      }
      if (marker === undefined || marker === 255 || marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset > size - 2) break;
      const length = (yield* read(offset, 2)).getUint16(0);
      if (length < 2 || length > size - offset) break;
      if (
        [192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker) &&
        length >= 8
      ) {
        const frame = yield* read(offset + 3, 4);
        result.pixelHeight = frame.getUint16(0) || null;
        result.pixelWidth = frame.getUint16(2) || null;
      }
      if (marker === 224 && length >= 16) {
        const jfif = yield* read(offset + 2, 14);
        if (matches(jfif, 0, [74, 70, 73, 70, 0])) {
          const unit = jfif.getUint8(7),
            multiplier = unit === 1 ? 1 : unit === 2 ? 2.54 : 0;
          [result.dpiX, result.dpiY] = normalizeImageDpi([
            jfif.getUint16(8) * multiplier,
            jfif.getUint16(10) * multiplier
          ]);
        }
      }
      if (
        marker === 225 &&
        length >= 16 &&
        matches(yield* read(offset + 2, 6), 0, [69, 120, 105, 102, 0, 0])
      ) {
        const metadata = yield* tiffMetadata(length - 8, offset + 8);
        result.dpiX = metadata.dpiX;
        result.dpiY = metadata.dpiY;
      }
      offset += length;
    }
  }
  return result;
}

/** Buffering convenience codec sharing the same bounded metadata parser. */
export function imageMetadata(bytes: Uint8Array, mediaType: string): ImageMetadata {
  const reader = metadataRanges(bytes.length, mediaType);
  let next = reader.next();
  while (!next.done)
    next = reader.next(bytes.subarray(next.value.offset, next.value.offset + next.value.length));
  return next.value;
}

export interface ImageMetadataSource {
  readonly size: number;
  read(offset: number, length: number): Promise<Uint8Array>;
}
/** Pure range codec with an owned 16 KiB read cache; storage and source lifetime belong to the caller. */
export async function readImageMetadata(
  source: ImageMetadataSource,
  mediaType: string,
  signal?: AbortSignal
): Promise<ImageMetadata> {
  const size = source.size;
  if (!Number.isSafeInteger(size) || size < 0)
    throw new RangeError("Invalid image metadata source size.");
  const reader = metadataRanges(size, mediaType);
  let next = reader.next(),
    cache = new Uint8Array(),
    start = 0;
  try {
    while (!next.done) {
      signal?.throwIfAborted();
      const request = next.value,
        field = new Uint8Array(request.length);
      let used = 0;
      while (used < field.length) {
        const offset = request.offset + used;
        if (offset < start || offset >= start + cache.length) {
          signal?.throwIfAborted();
          const length = Math.min(16384, size - offset),
            bytes = await source.read(offset, length);
          signal?.throwIfAborted();
          if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > length)
            throw new RangeError("Invalid image metadata range result.");
          cache = new Uint8Array(bytes);
          start = offset;
        }
        const amount = Math.min(field.length - used, start + cache.length - offset);
        field.set(cache.subarray(offset - start, offset - start + amount), used);
        used += amount;
      }
      next = reader.next(field);
    }
    signal?.throwIfAborted();
    return next.value;
  } finally {
    reader.return(emptyMetadata());
  }
}
