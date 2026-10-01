import type { MetadataTag, TagAssignment } from "./png.js";
import { Resources, type EngineOptions } from "./resources.js";

export const jpegWriteTags: Readonly<Record<string, number>> = Object.freeze({ ImageDescription: 0x010e, Description: 0x010e, Software: 0x0131, Artist: 0x013b, Copyright: 0x8298 });
const jpegReadIfd0Tags: Readonly<Record<number, string>> = Object.freeze({
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x0131: "Software",
  0x0132: "ModifyDate",
  0x013b: "Artist",
  0x8298: "Copyright"
});
const jpegReadExifIfdTags: Readonly<Record<number, string>> = Object.freeze({
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8827: "ISO",
  0x9003: "DateTimeOriginal",
  0x9004: "CreateDate",
  0x920a: "FocalLength",
  0xa434: "LensModel"
});
interface Segment { marker: number; start: number; end: number; payload: Uint8Array }
function hasValidEoiAfterSos(bytes: Uint8Array, sosEnd: number): boolean {
  let trimmedLen = bytes.length;
  while (trimmedLen > sosEnd + 2 && bytes[trimmedLen - 1] === 0) {
    trimmedLen--;
  }
  if (trimmedLen >= sosEnd + 2 && bytes[trimmedLen - 2] === 255 && bytes[trimmedLen - 1] === 217) {
    return true;
  }
  for (let i = sosEnd; i + 1 < bytes.length; i++) {
    if (bytes[i] === 255 && bytes[i + 1] === 217) {
      return true;
    }
  }
  return false;
}
function segments(bytes: Uint8Array, resources: Resources): Segment[] {
  resources.admit("input", bytes.length);
  resources.admit("work", bytes.length * 8);
  resources.admit("retained", bytes.length * 4);
  if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error("Invalid JPEG signature");
  const result: Segment[] = [];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let position = 2;
  while (position < bytes.length) {
    resources.signal.throwIfAborted();
    const start = position;
    if (bytes[position++] !== 255) throw new Error("Invalid JPEG marker");
    while (bytes[position] === 255) position++;
    const marker = bytes[position++];
    if (marker === undefined || marker === 0) throw new Error("Invalid JPEG marker");
    if (marker === 217) { result.push({ marker, start, end: position, payload: bytes.subarray(position, position) }); return result; }
    if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
    if (position + 2 > bytes.length) throw new Error("Truncated JPEG segment");
    const size = view.getUint16(position);
    if (size < 2 || size > bytes.length - position) throw new Error("Truncated JPEG segment");
    const end = position + size;
    resources.admit("retained", 128);
    result.push({ marker, start, end, payload: bytes.subarray(position + 2, end) });
    // Entropy data and subsequent progressive scans stay opaque and byte-exact.
    if (marker === 218) {
      if (!hasValidEoiAfterSos(bytes, end)) throw new Error("JPEG missing EOI");
      return result;
    }
    position = end;
  }
  throw new Error("JPEG missing EOI");
}
function isExif(segment: Segment): boolean {
  const p = segment.payload;
  return segment.marker === 225 && p[0] === 69 && p[1] === 120 && p[2] === 105 && p[3] === 102 && p[4] === 0 && p[5] === 0;
}
function tiff(payload: Uint8Array) {
  const bytes = payload.subarray(6);
  if (bytes.length < 8) throw new Error("Truncated EXIF header");
  const little = bytes[0] === 73 && bytes[1] === 73;
  if (!little && !(bytes[0] === 77 && bytes[1] === 77)) throw new Error("Invalid EXIF byte order");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  if (view.getUint16(2, little) !== 42) throw new Error("Invalid EXIF header");
  const offset = view.getUint32(4, little);
  if (offset < 8 || offset > bytes.length - 2) throw new Error("Invalid EXIF directory");
  const count = view.getUint16(offset, little);
  if (count * 12 + 6 > bytes.length - offset) throw new Error("Truncated EXIF directory");
  return { bytes, view, little, offset, count };
}
function decodeTiffEntryValue(
  bytes: Uint8Array,
  view: DataView,
  little: boolean,
  entry: number
): { value: string; valueOffset: number } | undefined {
  const type = view.getUint16(entry + 2, little);
  const count = view.getUint32(entry + 4, little);
  if (type === 2) {
    const start = count <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (start > bytes.length || count > bytes.length - start) throw new Error("Truncated EXIF text");
    const raw = bytes.subarray(start, start + count);
    const end = raw.indexOf(0);
    return {
      value: new TextDecoder("utf-8").decode(end < 0 ? raw : raw.subarray(0, end)),
      valueOffset: start
    };
  }
  if (type === 3 && count >= 1) {
    const start = count <= 2 ? entry + 8 : view.getUint32(entry + 8, little);
    if (start + 2 <= bytes.length) {
      return { value: String(view.getUint16(start, little)), valueOffset: start };
    }
  }
  if (type === 4 && count >= 1) {
    const start = count === 1 ? entry + 8 : view.getUint32(entry + 8, little);
    if (start + 4 <= bytes.length) {
      return { value: String(view.getUint32(start, little)), valueOffset: start };
    }
  }
  if (type === 5 && count >= 1) {
    const start = view.getUint32(entry + 8, little);
    if (start + 8 <= bytes.length) {
      const num = view.getUint32(start, little);
      const den = view.getUint32(start + 4, little);
      if (den > 0) {
        if (num < den && num > 0 && den % num === 0) {
          return { value: `1/${Math.round(den / num)}`, valueOffset: start };
        }
        const ratio = num / den;
        return {
          value: Number.isInteger(ratio) ? String(ratio) : ratio.toFixed(2).replace(/\.?0+$/, ""),
          valueOffset: start
        };
      }
    }
  }
  return undefined;
}
export function inspectJpeg(input: Uint8Array, options: EngineOptions | Resources): { readonly tags: readonly MetadataTag[] } {
  const resources = options instanceof Resources ? options : new Resources(options);
  const parts = segments(input, resources);
  const tags: MetadataTag[] = [];
  const add = (name: string, value: string, group: string, offset: number): void => {
    resources.admit("decoded", value.length * 2);
    resources.admit("retained", value.length * 8 + 256);
    tags.push({ name, rawName: name, chunkType: "JPEG", index: tags.length, group, instance: 0, offset, value, raw: new TextEncoder().encode(value) });
  };
  add("FileType", "JPEG", "File", 0); add("MIMEType", "image/jpeg", "File", 0);
  for (const part of parts) {
    if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(part.marker)) {
      if (part.payload.length < 6) throw new Error("Truncated JPEG frame");
      const height = part.payload[1]! * 256 + part.payload[2]!;
      const width = part.payload[3]! * 256 + part.payload[4]!;
      if (!width || !height) throw new Error("Invalid JPEG dimensions");
      add("ImageWidth", String(width), "JPEG", part.start); add("ImageHeight", String(height), "JPEG", part.start);
      add("BitDepth", String(part.payload[0]), "JPEG", part.start); add("ImageSize", width + "x" + height, "Composite", part.start);
    }
    if (!isExif(part)) continue;
    const { bytes, view, little, offset, count } = tiff(part.payload);
    let exifIfdOffset = 0;
    for (let i = 0; i < count; i++) {
      const entry = offset + 2 + i * 12;
      const tagId = view.getUint16(entry, little);
      if (tagId === 0x8769 && view.getUint16(entry + 2, little) === 4) {
        exifIfdOffset = view.getUint32(entry + 8, little);
        continue;
      }
      const name = jpegReadIfd0Tags[tagId];
      if (!name) continue;
      const decoded = decodeTiffEntryValue(bytes, view, little, entry);
      if (decoded) {
        add(name, decoded.value, "IFD0", part.start + 10 + decoded.valueOffset);
      }
    }
    if (exifIfdOffset >= 8 && exifIfdOffset + 2 <= bytes.length) {
      const subCount = view.getUint16(exifIfdOffset, little);
      if (subCount * 12 + 2 <= bytes.length - exifIfdOffset) {
        for (let i = 0; i < subCount; i++) {
          const entry = exifIfdOffset + 2 + i * 12;
          const tagId = view.getUint16(entry, little);
          const name = jpegReadExifIfdTags[tagId];
          if (!name) continue;
          let decoded: { value: string; valueOffset: number } | undefined;
          try {
            decoded = decodeTiffEntryValue(bytes, view, little, entry);
          } catch {
            continue;
          }
          if (decoded) {
            add(name, decoded.value, "ExifIFD", part.start + 10 + decoded.valueOffset);
          }
        }
      }
    }
  }
  return { tags };
}
export function editJpeg(input: Uint8Array, assignments: readonly TagAssignment[], options: EngineOptions | Resources): Uint8Array {
  const resources = options instanceof Resources ? options : new Resources(options);
  const parts = segments(input, resources);
  const all = assignments.length === 1 && assignments[0]!.name.toLowerCase() === "all" && assignments[0]!.operation === "set" && assignments[0]!.value === "";
  const exif = parts.filter(isExif);
  if (!all && exif.length > 1) throw new Error("Multiple EXIF directories not yet supported for writes");
  let replacement = new Uint8Array(0);
  if (!all) {
    const changes = new Map<number, string>();
    for (const assignment of assignments) {
      const name = Object.keys(jpegWriteTags).find(name => name.toLowerCase() === assignment.name.toLowerCase());
      if (!name || assignment.operation !== "set") throw new Error("Tag write not yet supported: " + assignment.name);
      if (assignment.value.includes("\0")) throw new Error("EXIF text cannot contain NUL");
      resources.admit("decoded", assignment.value.length * 2);
      resources.admit("retained", assignment.value.length * 8 + 256);
      changes.set(jpegWriteTags[name]!, assignment.value);
    }
    const base = exif[0] ? tiff(exif[0].payload) : tiff(new Uint8Array([69,120,105,102,0,0,73,73,42,0,8,0,0,0,0,0,0,0,0,0]));
    const entries: Uint8Array[] = [];
    for (let i = 0; i < base.count; i++) {
      const start = base.offset + 2 + i * 12;
      if (!changes.has(base.view.getUint16(start, base.little))) entries.push(base.bytes.subarray(start, start + 12));
    }
    const values = [...changes].filter(([, value]) => value !== "").map(([tag, value]) => ({ tag, bytes: new TextEncoder().encode(value + "\0") }));
    const offset = base.bytes.length + (base.bytes.length % 2);
    const count = entries.length + values.length;
    const length = offset + 6 + count * 12 + values.reduce((sum, v) => sum + (v.bytes.length > 4 ? v.bytes.length : 0), 0);
    if (length + 8 > 65535 || count > 65535) throw new Error("EXIF segment too large");
    resources.admit("retained", length * 3 + count * 128);
    resources.admit("work", length * 4);
    const bytes = new Uint8Array(length);
    bytes.set(base.bytes);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, offset, base.little); view.setUint16(offset, count, base.little);
    entries.forEach((entry, i) => bytes.set(entry, offset + 2 + i * 12));
    view.setUint32(offset + 2 + count * 12, base.view.getUint32(base.offset + 2 + base.count * 12, base.little), base.little);
    let cursor = offset + 6 + count * 12;
    values.forEach((value, i) => {
      const p = offset + 2 + (entries.length + i) * 12;
      view.setUint16(p, value.tag, base.little); view.setUint16(p + 2, 2, base.little); view.setUint32(p + 4, value.bytes.length, base.little);
      if (value.bytes.length <= 4) bytes.set(value.bytes, p + 8);
      else { view.setUint32(p + 8, cursor, base.little); bytes.set(value.bytes, cursor); cursor += value.bytes.length; }
    });
    replacement = new Uint8Array(length + 10);
    replacement.set([255,225,(length + 8) >>> 8,(length + 8) & 255,69,120,105,102,0,0]); replacement.set(bytes, 10);
  }
  const removed = parts.filter(part => all ? (part.marker >= 225 && part.marker <= 239) || part.marker === 254 : isExif(part));
  const size = input.length - removed.reduce((sum, p) => sum + p.end - p.start, 0) + replacement.length;
  resources.admit("output", size); resources.admit("retained", size); resources.admit("work", size);
  const result = new Uint8Array(size);
  result.set(input.subarray(0, 2)); result.set(replacement, 2);
  let cursor = 2 + replacement.length, start = 2;
  for (const part of removed) { const chunk = input.subarray(start, part.start); result.set(chunk, cursor); cursor += chunk.length; start = part.end; }
  result.set(input.subarray(start), cursor);
  return result;
}
