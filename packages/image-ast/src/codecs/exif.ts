import {exifMetadataSteps,type ExifMetadata} from "./exif-metadata.js";
export type {ExifMetadata} from "./exif-metadata.js";

export function parseExifBuffer(raw:Uint8Array):ExifMetadata {
  const steps=exifMetadataSteps(raw.length);let next=steps.next();
  while(!next.done)next=steps.next(raw.subarray(next.value.position,next.value.position+next.value.length));
  return next.value;
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
