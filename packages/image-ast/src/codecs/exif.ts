import type { ImageMetadata } from "../ast.js";
import {exifMetadataSteps,type ExifMetadata} from "./exif-metadata.js";
export type {ExifMetadata} from "./exif-metadata.js";

export function parseExifBuffer(raw:Uint8Array):ExifMetadata {
  const steps=exifMetadataSteps(raw.length);let next=steps.next();
  while(!next.done)next=steps.next(raw.subarray(next.value.position,next.value.position+next.value.length));
  return next.value;
}

export function buildExifApp1Segment(options: {
  readonly exif?: Uint8Array | undefined;
  readonly orientation?: number | undefined;
  readonly density?: number;
  readonly resolution?: ImageMetadata["resolution"];
}): Uint8Array {
  const orientation = options.orientation ?? 1;
  const density = Math.max(1, Math.round(options.density ?? 72));
  const resolution = options.resolution;
  const scale = resolution?.unit === "meter" ? 100 : 1;
  const x = resolution ? resolution.x / scale : density, y = resolution ? resolution.y / scale : density;
  const denominator = Number.isInteger(x) && Number.isInteger(y) ? 1 : 10000;
  if (options.exif) {
    const raw = options.exif;
    const little = raw[0] === 73 && raw[1] === 73;
    const big = raw[0] === 77 && raw[1] === 77;
    const source = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (raw.length < 8 || (!little && !big) || source.getUint16(2, little) !== 42) throw new Error("Invalid EXIF header");
    const ifd = source.getUint32(4, little);
    if (ifd + 2 > raw.length) throw new Error("Invalid EXIF directory");
    const count = source.getUint16(ifd, little), end = ifd + 2 + count * 12;
    if (end + 4 > raw.length) throw new Error("Truncated EXIF directory");
    let hasOrientation = false;
    for (let entry = ifd + 2; entry < end; entry += 12) if (source.getUint16(entry, little) === 0x0112) hasOrientation = true;
    const addOrientation = !hasOrientation && options.orientation !== undefined;
    const directory = (raw.length + 1) & ~1;
    const payload = new Uint8Array(6 + (addOrientation ? directory + 2 + (count + 1) * 12 + 4 : raw.length));
    payload.set([69, 120, 105, 102, 0, 0]); payload.set(raw, 6);
    const view = new DataView(payload.buffer, 6);
    for (let entry = ifd + 2; entry < end; entry += 12) {
      const tag = view.getUint16(entry, little), type = view.getUint16(entry + 2, little);
      if (tag === 0x0112 && options.orientation !== undefined) {
        view.setUint16(entry + 2, 3, little); view.setUint32(entry + 4, 1, little);
        view.setUint32(entry + 8, 0, little); view.setUint16(entry + 8, orientation, little);
      } else if ((tag === 0x011a || tag === 0x011b) && type === 5 && view.getUint32(entry + 4, little) === 1) {
        const offset = view.getUint32(entry + 8, little);
        if (offset + 8 <= raw.length) {
          view.setUint32(offset, Math.round((tag === 0x011a ? x : y) * denominator), little);
          view.setUint32(offset + 4, denominator, little);
        }
      } else if (tag === 0x0128 && type === 3 && view.getUint32(entry + 4, little) === 1) {
        view.setUint16(entry + 8, resolution?.unit === "meter" || resolution?.unit === "cm" ? 3 : resolution?.unit === "unknown" ? 1 : 2, little);
      }
    }
    // Relocate only the directory when adding orientation; all profile offsets stay valid.
    if (addOrientation) {
      view.setUint32(4, directory, little); view.setUint16(directory, count + 1, little);
      payload.copyWithin(6 + directory + 2, 6 + ifd + 2, 6 + end);
      const entry = directory + 2 + count * 12;
      view.setUint16(entry, 0x0112, little); view.setUint16(entry + 2, 3, little);
      view.setUint32(entry + 4, 1, little); view.setUint16(entry + 8, orientation, little);
      view.setUint32(entry + 12, source.getUint32(end, little), little);
    }
    return payload;
  }
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
  writeEntry(3, 0x0128, 3, 1, resolution?.unit === "meter" || resolution?.unit === "cm" ? 3 : resolution?.unit === "unknown" ? 1 : 2); // ResolutionUnit

  view.setUint32(ifd + 2 + 4 * 12, 0, true); // next IFD = 0
  view.setUint32(tiff + ratOffsetX, Math.round(x * denominator), true);
  view.setUint32(tiff + ratOffsetX + 4, denominator, true);
  view.setUint32(tiff + ratOffsetY, Math.round(y * denominator), true);
  view.setUint32(tiff + ratOffsetY + 4, denominator, true);

  return payload;
}
