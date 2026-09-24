export interface ExifMetadata {
  readonly orientation?: number;
  readonly density?: number;
}

export function parseExifBuffer(raw: Uint8Array): ExifMetadata {
  let offset = 0;
  if (
    raw.length >= 6 &&
    raw[0] === 0x45 && // E
    raw[1] === 0x78 && // x
    raw[2] === 0x69 && // i
    raw[3] === 0x66 && // f
    raw[4] === 0x00 &&
    raw[5] === 0x00
  ) {
    offset = 6;
  }
  if (raw.length < offset + 8) return {};
  const sub = raw.subarray(offset);
  const view = new DataView(sub.buffer, sub.byteOffset, sub.byteLength);
  const littleEndian = sub[0] === 0x49 && sub[1] === 0x49;
  const bigEndian = sub[0] === 0x4d && sub[1] === 0x4d;
  if (!littleEndian && !bigEndian) return {};

  const magic = view.getUint16(2, littleEndian);
  if (magic !== 0x002a) return {};
  const ifdOffset = view.getUint32(4, littleEndian);
  if (ifdOffset + 2 > sub.length) return {};

  const numEntries = view.getUint16(ifdOffset, littleEndian);
  let orientation: number | undefined;
  let xRes: number | undefined;
  let resUnit = 2; // 2 = inches (DPI), 3 = cm (DPCM)

  for (let i = 0; i < numEntries; i++) {
    const entryPos = ifdOffset + 2 + i * 12;
    if (entryPos + 12 > sub.length) break;
    const tag = view.getUint16(entryPos, littleEndian);
    const type = view.getUint16(entryPos + 2, littleEndian);
    const valueOffset = view.getUint32(entryPos + 8, littleEndian);

    if (tag === 0x0112) {
      // Orientation (SHORT = 3)
      const val = type === 3 ? view.getUint16(entryPos + 8, littleEndian) : valueOffset;
      if (val >= 1 && val <= 8) orientation = val;
    } else if (tag === 0x0128) {
      const val = type === 3 ? view.getUint16(entryPos + 8, littleEndian) : valueOffset;
      if (val === 2 || val === 3) resUnit = val;
    } else if (tag === 0x011a && type === 5) {
      // RATIONAL (two uint32s at valueOffset)
      if (valueOffset + 8 <= sub.length) {
        const num = view.getUint32(valueOffset, littleEndian);
        const den = view.getUint32(valueOffset + 4, littleEndian);
        if (den > 0) xRes = num / den;
      }
    }
  }

  let density: number | undefined;
  if (xRes !== undefined && xRes > 0) {
    density = resUnit === 3 ? Math.round(xRes * 2.54) : Math.round(xRes);
  }

  return {
    ...(orientation !== undefined ? { orientation } : {}),
    ...(density !== undefined ? { density } : {})
  };
}

export function buildExifApp1Segment(options: {
  readonly orientation?: number;
  readonly density?: number;
}): Uint8Array {
  const orientation = options.orientation ?? 1;
  const density = Math.max(1, Math.round(options.density ?? 72));
  // Exif\0\0 (6) + TIFF header (8) + count (2) + 4 entries (48) + nextIFD (4) + 2 rationals (16) = 84 bytes
  const payload = new Uint8Array(84);
  const view = new DataView(payload.buffer);
  // "Exif\0\0"
  payload[0] = 0x45;
  payload[1] = 0x78;
  payload[2] = 0x69;
  payload[3] = 0x66;
  payload[4] = 0x00;
  payload[5] = 0x00;
  // Little-endian TIFF header at offset 6
  const tiff = 6;
  payload[tiff] = 0x49;
  payload[tiff + 1] = 0x49;
  view.setUint16(tiff + 2, 0x002a, true);
  view.setUint32(tiff + 4, 8, true); // IFD0 starts at offset 8 from tiff

  const ifd = tiff + 8;
  view.setUint16(ifd, 4, true); // 4 entries

  const writeEntry = (idx: number, tag: number, type: number, count: number, valueOrOffset: number) => {
    const p = ifd + 2 + idx * 12;
    view.setUint16(p, tag, true);
    view.setUint16(p + 2, type, true);
    view.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) {
      view.setUint16(p + 8, valueOrOffset, true);
      view.setUint16(p + 10, 0, true);
    } else {
      view.setUint32(p + 8, valueOrOffset, true);
    }
  };

  const ratOffsetX = 8 + 2 + 4 * 12 + 4; // 62
  const ratOffsetY = ratOffsetX + 8; // 70
  writeEntry(0, 0x0112, 3, 1, orientation); // Orientation
  writeEntry(1, 0x011a, 5, 1, ratOffsetX); // XResolution
  writeEntry(2, 0x011b, 5, 1, ratOffsetY); // YResolution
  writeEntry(3, 0x0128, 3, 1, 2); // ResolutionUnit = inches

  view.setUint32(ifd + 2 + 4 * 12, 0, true); // next IFD = 0
  view.setUint32(tiff + ratOffsetX, density, true);
  view.setUint32(tiff + ratOffsetX + 4, 1, true);
  view.setUint32(tiff + ratOffsetY, density, true);
  view.setUint32(tiff + ratOffsetY + 4, 1, true);

  return payload;
}
