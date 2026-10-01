import type { ImageFormat } from "@poe-code/image-ast/portable";

// A namespaced payload in standard PNG iTXt / JPEG COM containers. No process
// state: copying, replacing, or deleting a file also copies/replaces/deletes its properties.
const keyword = "safe-bash-sips";
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const maxMetadataBytes = 65500;

function payloadProperties(bytes: Uint8Array): Map<string, string | null> {
  if (bytes.length > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  const value: unknown = JSON.parse(decoder.decode(bytes));
  if (!Array.isArray(value)) throw new Error("Invalid sips metadata");
  const result = new Map<string, string | null>();
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || (entry[1] !== null && typeof entry[1] !== "string")) {
      throw new Error("Invalid sips metadata property");
    }
    result.set(entry[0], entry[1]);
  }
  return result;
}

export function readProperties(bytes: Uint8Array, format: ImageFormat): Map<string, string | null> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const prefix = encoder.encode(format === "png" ? `${keyword}\0\0\0\0\0` : `${keyword}\0`);
  let offset = format === "png" ? 8 : 2;
  while ((format === "png" || format === "jpeg") && offset + 4 <= bytes.length) {
    let start: number;
    let end: number;
    let candidate: boolean;
    if (format === "png") {
      const length = view.getUint32(offset);
      start = offset + 8;
      end = start + length;
      if (end + 4 > bytes.length) throw new Error("Invalid PNG metadata chunk");
      candidate = view.getUint32(offset + 4) === 0x69545874; // iTXt
      offset = end + 4;
    } else {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = view.getUint16(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) throw new Error("Invalid JPEG metadata segment");
      start = offset + 4;
      end = offset + 2 + length;
      candidate = marker === 0xfe;
      offset = end;
    }
    if (candidate && end - start >= prefix.length && prefix.every((byte, index) => bytes[start + index] === byte)) {
      return payloadProperties(bytes.subarray(start + prefix.length, end));
    }
  }
  return new Map();
}

export function writeProperties(bytes: Uint8Array, format: ImageFormat, properties: ReadonlyMap<string, string | null>): Uint8Array {
  if (properties.size === 0) return bytes;
  if (format !== "png" && format !== "jpeg") throw new Error(`sips property persistence is not supported for ${format}; use PNG or JPEG output`);
  // Check before serialization/encoding as well as after UTF-8 expansion.
  let size = 0;
  for (const [key, value] of properties) {
    size += key.length + (value?.length ?? 4) + 8;
    if (size > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  }
  const payload = encoder.encode(JSON.stringify([...properties]));
  if (payload.length > maxMetadataBytes) throw new Error("sips metadata byte limit exceeded");
  const prefix = encoder.encode(format === "png" ? `${keyword}\0\0\0\0\0` : `${keyword}\0`);
  const dataLength = prefix.length + payload.length;
  const chunk = new Uint8Array(dataLength + (format === "png" ? 12 : 4));
  const view = new DataView(chunk.buffer);
  const dataOffset = format === "png" ? 8 : 4;
  chunk.set(prefix, dataOffset);
  chunk.set(payload, dataOffset + prefix.length);
  if (format === "png") {
    view.setUint32(0, dataLength);
    view.setUint32(4, 0x69545874);
    let crc = 0xffffffff;
    for (let index = 4; index < chunk.length - 4; index++) {
      crc ^= chunk[index]!;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  } else {
    view.setUint16(0, 0xfffe);
    view.setUint16(2, dataLength + 2);
  }
  // Freshly encoded images have no prior payload. PNG inserts after IHDR;
  // JPEG inserts after SOI, before the first image segment.
  const offset = format === "png" ? 33 : 2;
  const output = new Uint8Array(bytes.length + chunk.length);
  output.set(bytes.subarray(0, offset));
  output.set(chunk, offset);
  output.set(bytes.subarray(offset), offset + chunk.length);
  return output;
}
