import type { MetadataTag, TagAssignment } from "./png.js";
import { Resources, type EngineOptions } from "./resources.js";

export const jpegWriteTags: Readonly<Record<string, number>> = Object.freeze({ Comment: -1, Author: 0x013b, DateTime: 0x0132, XResolution: 0x011a, YResolution: 0x011b, ResolutionUnit: 0x0128, ImageDescription: 0x010e, Description: 0x010e, Make: 0x010f, Model: 0x0110, Orientation: 0x0112, Software: 0x0131, ModifyDate: 0x0132, UserComment: 0x9286, DateTimeOriginal: 0x9003, CreateDate: 0x9004, Artist: 0x013b, Copyright: 0x8298 });
const jpegReadIfd0Tags: Readonly<Record<number, string>> = Object.freeze({
  0x010e: "ImageDescription",
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x011a: "XResolution",
  0x011b: "YResolution",
  0x0128: "ResolutionUnit",
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
  0x9286: "UserComment",
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
  if (type === 7 && view.getUint16(entry, little) === 0x9286) {
    const start = count <= 4 ? entry + 8 : view.getUint32(entry + 8, little);
    if (start > bytes.length || count > bytes.length - start || count < 8) throw new Error("Truncated EXIF UserComment");
    const raw = bytes.subarray(start, start + count);
    const encoding = new TextDecoder().decode(raw.subarray(0, 8));
    const text = raw.subarray(8);
    const value = encoding === "UNICODE\0"
      ? new TextDecoder(little ? "utf-16le" : "utf-16be", { fatal: true }).decode(text)
      : new TextDecoder().decode(text);
    return { value: value.endsWith("\0") ? value.slice(0, -1) : value, valueOffset: start };
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
    if (part.marker === 254) add("Comment", new TextDecoder().decode(part.payload), "JPEG", part.start);
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
  const rewriteExif = assignments.some(assignment => assignment.name.toLowerCase() !== "comment");
  if (!all && rewriteExif && exif.length > 1) throw new Error("Multiple EXIF directories not yet supported for writes");
  let replacement = new Uint8Array(0);
  let comment: Uint8Array | undefined;
  if (!all) {
    const changes = new Map<number, string>();
    for (const assignment of assignments) {
      const name = Object.keys(jpegWriteTags).find(name => name.toLowerCase() === assignment.name.toLowerCase());
      if (!name || assignment.operation !== "set") throw new Error("Tag write not yet supported: " + assignment.name);
      if (assignment.value.includes("\0")) throw new Error("EXIF text cannot contain NUL");
      resources.admit("decoded", assignment.value.length * 2);
      resources.admit("retained", assignment.value.length * 8 + 256);
      if (name === "Comment") {
        const data = new TextEncoder().encode(assignment.value);
        if (data.length > 65533) throw new Error("Comment segment too large");
        comment = data.length ? new Uint8Array(data.length + 4) : new Uint8Array(0);
        if (data.length) {
          comment.set([255,254,(data.length + 2) >>> 8,(data.length + 2) & 255]);
          comment.set(data, 4);
        }
      } else changes.set(jpegWriteTags[name]!, assignment.value);
    }
    if (changes.size) {
      const base = exif[0] ? tiff(exif[0].payload) : tiff(new Uint8Array([69,120,105,102,0,0,73,73,42,0,8,0,0,0,0,0,0,0,0,0]));
      // Keep opaque data at its existing offsets; reclaim the supported directories
      // and values before rebuilding a compact tail.
      let bytes: Uint8Array = base.bytes;
      type Value = { type: number; count: number; bytes: Uint8Array };
      const rootChanges = new Map<number, Value | undefined>();
      const exifChanges = new Map<number, Value | undefined>();
      for (const [tag, value] of changes) {
        let encoded: Value | undefined;
        if (value !== "") {
          if (tag === 0x0112 || tag === 0x0128) {
            const maximum = tag === 0x0112 ? "8" : "3";
            if (value.length !== 1 || value < "1" || value > maximum) throw new Error(tag === 0x0112 ? "Orientation must be an integer from 1 to 8" : "ResolutionUnit must be an integer from 1 to 3");
            const data = new Uint8Array(2);
            new DataView(data.buffer).setUint16(0, Number(value), base.little);
            encoded = { type: 3, count: 1, bytes: data };
          } else if (tag === 0x011a || tag === 0x011b) {
            const terms = value.split("/");
            let numerator = Number(terms[0]), denominator = terms.length === 2 ? Number(terms[1]) : 1;
            if (terms.length > 2 || !value.trim() || !Number.isFinite(numerator) || !Number.isFinite(denominator) || numerator <= 0 || denominator <= 0) throw new Error("Resolution must be a positive rational");
            if (terms.length === 1) {
              while (!Number.isInteger(numerator) && denominator < 1000000) { numerator *= 10; denominator *= 10; }
              numerator = Math.round(numerator);
            }
            let a = numerator, b = denominator;
            while (b) { const remainder = a % b; a = b; b = remainder; }
            numerator /= a; denominator /= a;
            if (![numerator, denominator].every(n => Number.isInteger(n) && n > 0 && n <= 0xffffffff)) throw new Error("Resolution is outside the TIFF RATIONAL range");
            const data = new Uint8Array(8), view = new DataView(data.buffer);
            view.setUint32(0, numerator, base.little); view.setUint32(4, denominator, base.little);
            encoded = { type: 5, count: 1, bytes: data };
          } else if (tag === 0x9286) {
            const ascii = [...value].every(char => char.charCodeAt(0) < 128);
            const data = new Uint8Array(8 + (ascii ? value.length : value.length * 2));
            data.set(new TextEncoder().encode(ascii ? "ASCII" : "UNICODE"));
            if (ascii) data.set(new TextEncoder().encode(value), 8);
            else {
              const view = new DataView(data.buffer);
              for (let i = 0; i < value.length; i++) view.setUint16(8 + i * 2, value.charCodeAt(i), base.little);
            }
            encoded = { type: 7, count: data.length, bytes: data };
          } else {
            const data = new TextEncoder().encode(value + "\0");
            encoded = { type: 2, count: data.length, bytes: data };
          }
        }
        (Object.hasOwn(jpegReadExifIfdTags, tag) ? exifChanges : rootChanges).set(tag, encoded);
      }
      let oldExifOffset = 0;
      for (let i = 0; i < base.count; i++) {
        const entry = base.offset + 2 + i * 12;
        if (base.view.getUint16(entry, base.little) === 0x8769) {
          if (base.view.getUint16(entry + 2, base.little) !== 4 || base.view.getUint32(entry + 4, base.little) !== 1) throw new Error("Invalid ExifIFD pointer");
          oldExifOffset = base.view.getUint32(entry + 8, base.little);
        }
      }
      resources.admit("retained", base.bytes.length * 2);
      const reclaim = new Uint8Array(base.bytes.length);
      const protectedBytes = new Uint8Array(base.bytes.length);
      const widths: Readonly<Record<number, number>> = {1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8,13:4};
      const visited = new Set<number>();
      const pending: {offset:number; updates?:Map<number,Value | undefined>; names?:Readonly<Record<number,string>>}[] = [
        {offset:oldExifOffset,updates:exifChanges,names:jpegReadExifIfdTags},
        {offset:base.offset,updates:rootChanges,names:jpegReadIfd0Tags}
      ];
      while (pending.length) {
        const {offset,updates,names} = pending.pop()!;
        if (!offset || visited.has(offset)) continue;
        resources.signal.throwIfAborted();
        visited.add(offset);
        if (offset < 8 || offset > base.bytes.length - 2) throw new Error("Invalid EXIF directory");
        const count = base.view.getUint16(offset, base.little), end = offset + 6 + count * 12;
        if (end > base.bytes.length) throw new Error("Truncated EXIF directory");
        resources.admit("work", count * 12);
        (updates ? reclaim : protectedBytes).fill(1, offset, end);
        for (let i = 0; i < count; i++) {
          const entry = offset + 2 + i * 12;
          const tag = base.view.getUint16(entry, base.little), type = base.view.getUint16(entry + 2, base.little);
          const count = base.view.getUint32(entry + 4, base.little), width = widths[type];
          if (!width) throw new Error("Unsupported EXIF field type: " + type);
          const length = count * width, start = length <= 4 ? entry + 8 : base.view.getUint32(entry + 8, base.little);
          if (start > base.bytes.length || length > base.bytes.length - start) throw new Error("Truncated EXIF value");
          resources.admit("work", length);
          if (updates && names && Object.hasOwn(names, tag)) {
            if (!updates.has(tag)) updates.set(tag, {type, count, bytes:base.bytes.subarray(start,start + length)});
            if (length > 4) {
              reclaim.fill(1, start, start + length);
              if (length % 2 && base.bytes[start + length] === 0) reclaim[start + length] = 1;
            }
          } else if (length > 4) protectedBytes.fill(1, start, start + length);
          // Standard directory pointers and thumbnail payloads remain fixed.
          if ([0x8769,0x8825,0xa005,0x014a].includes(tag) && (type === 4 || type === 13)) {
            for (let j = 0; j < count; j++) {
              const child = base.view.getUint32(start + j * 4, base.little);
              if (tag !== 0x8769 || !updates) {
                resources.admit("retained", 64);
                pending.push({offset:child});
              }
            }
          }
        }
        resources.admit("retained", 64);
        pending.push({offset:base.view.getUint32(end - 4, base.little)});
      }
      let retainedEnd = base.bytes.length;
      while (retainedEnd > 8 && reclaim[retainedEnd - 1] && !protectedBytes[retainedEnd - 1]) retainedEnd--;
      bytes = base.bytes.subarray(0, retainedEnd);
      const appendDirectory = (oldOffset: number, updates: Map<number, Value | undefined>): number => {
        const entries = new Map<number, Uint8Array>();
        let next = 0;
        if (oldOffset) {
          if (oldOffset < 8 || oldOffset > base.bytes.length - 2) throw new Error("Invalid EXIF directory");
          const count = base.view.getUint16(oldOffset, base.little);
          if (count * 12 + 6 > base.bytes.length - oldOffset) throw new Error("Truncated EXIF directory");
          for (let i = 0; i < count; i++) {
            const start = oldOffset + 2 + i * 12;
            const tag = base.view.getUint16(start, base.little);
            if (!updates.has(tag)) entries.set(tag, base.bytes.subarray(start, start + 12));
          }
          next = base.view.getUint32(oldOffset + 2 + count * 12, base.little);
        }
        for (const [tag, value] of updates) if (value) entries.set(tag, new Uint8Array(12));
        const offset = bytes.length + bytes.length % 2;
        const count = entries.size;
        const dataStart = offset + 6 + count * 12;
        let length = dataStart;
        for (const value of updates.values()) if (value && value.bytes.length > 4) length += value.bytes.length + value.bytes.length % 2;
        if (length + 8 > 65535 || count > 65535) throw new Error("EXIF segment too large");
        resources.admit("retained", length * 3 + count * 128);
        resources.admit("work", length * 4);
        const result = new Uint8Array(length);
        result.set(bytes);
        const view = new DataView(result.buffer);
        view.setUint16(offset, count, base.little);
        view.setUint32(offset + 2 + count * 12, next, base.little);
        let cursor = dataStart;
        [...entries].sort(([a], [b]) => a - b).forEach(([tag, entry], i) => {
          const p = offset + 2 + i * 12;
          result.set(entry, p);
          const value = updates.get(tag);
          if (!value) return;
          view.setUint16(p, tag, base.little);
          view.setUint16(p + 2, value.type, base.little);
          view.setUint32(p + 4, value.count, base.little);
          if (value.bytes.length <= 4) result.set(value.bytes, p + 8);
          else {
            view.setUint32(p + 8, cursor, base.little);
            result.set(value.bytes, cursor);
            cursor += value.bytes.length + value.bytes.length % 2;
          }
        });
        bytes = result;
        return offset;
      };
      if (exifChanges.size || oldExifOffset) {
        const offset = appendDirectory(oldExifOffset, exifChanges);
        const pointer = new Uint8Array(4);
        new DataView(pointer.buffer).setUint32(0, offset, base.little);
        rootChanges.set(0x8769, { type: 4, count: 1, bytes: pointer });
      }
      const offset = appendDirectory(base.offset, rootChanges);
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(4, offset, base.little);
      const length = bytes.length;
      replacement = new Uint8Array(length + 10);
      replacement.set([255,225,(length + 8) >>> 8,(length + 8) & 255,69,120,105,102,0,0]); replacement.set(bytes, 10);
    }
  }
  if (comment !== undefined) {
    const combined = new Uint8Array(replacement.length + comment.length);
    combined.set(replacement); combined.set(comment, replacement.length); replacement = combined;
  }
  const removed = parts.filter(part => all ? (part.marker >= 225 && part.marker <= 239) || part.marker === 254 : (rewriteExif && isExif(part)) || (comment !== undefined && part.marker === 254));
  const size = input.length - removed.reduce((sum, p) => sum + p.end - p.start, 0) + replacement.length;
  resources.admit("output", size); resources.admit("retained", size); resources.admit("work", size);
  const result = new Uint8Array(size);
  result.set(input.subarray(0, 2)); result.set(replacement, 2);
  let cursor = 2 + replacement.length, start = 2;
  for (const part of removed) { const chunk = input.subarray(start, part.start); result.set(chunk, cursor); cursor += chunk.length; start = part.end; }
  result.set(input.subarray(start), cursor);
  return result;
}
