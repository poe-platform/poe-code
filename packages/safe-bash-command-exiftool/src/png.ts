import { Resources, type EngineOptions } from "./resources.js";
import { exiftoolRegistry } from "./registry.js";
import { isNumericShift } from "./shifts.js";

export interface MetadataTag {
  readonly name: string;
  readonly rawName: string;
  readonly chunkType: string;
  readonly index: number;
  readonly group: string;
  readonly instance: number;
  readonly offset: number;
  readonly value: string;
  readonly raw: Uint8Array;
}
export interface TagAssignment {
  readonly name: string;
  readonly operation: "set" | "remove" | "add";
  readonly value: string;
}
interface Chunk { readonly type: string; readonly bytes: Uint8Array; readonly tag?: MetadataTag }
const signature = new Uint8Array([137,80,78,71,13,10,26,10]);
const bitDepths: Readonly<Record<number, readonly number[]>> = Object.freeze({
  0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
});

function checksum(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Qualified fixed-width timestamp policy; no host clock or timezone conversion. */
function encodePngTime(value: string, resources: Resources): Uint8Array {
  resources.admit("work", value.length * 2 + 32);
  const invalid = (): never => { throw new Error("PNG timestamp syntax/range not yet supported"); };
  const decimal = (start: number, end: number): number => {
    let number = 0;
    for (let index = start; index < end; index++) {
      const digit = value.charCodeAt(index) - 48;
      if (!(digit >= 0 && digit <= 9)) invalid();
      number = number * 10 + digit;
    }
    return number;
  };
  if (value.length < 19 || ![":", "-"].includes(value[4]!) || value[7] !== value[4] ||
    ![" ", "T"].includes(value[10]!) || value[13] !== ":" || value[16] !== ":") invalid();
  const year = decimal(0, 4), month = decimal(5, 7), day = decimal(8, 10);
  const hour = decimal(11, 13), minute = decimal(14, 16), second = decimal(17, 19);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) invalid();
  let index = 19;
  if (value[index] === ".") {
    const start = ++index;
    while (index < value.length && value.charCodeAt(index) >= 48 && value.charCodeAt(index) <= 57) index++;
    if (start === index) invalid();
  }
  if (value[index] === "Z") index++;
  else if (value[index] === "+" || value[index] === "-") {
    if (value.length - index !== 6 || value[index + 3] !== ":" || decimal(index + 1, index + 3) > 23 || decimal(index + 4, index + 6) > 59) invalid();
    index += 6;
  }
  if (index !== value.length) invalid();
  // Native tIME ValueConvInv stores local fields, discarding fractions/offset.
  resources.admit("retained", 26);
  return new Uint8Array([year >>> 8, year & 255, month, day, hour, minute, second]);
}

/** Chunk constructor has its own explicit extent bound for SDK callers. */
export function pngChunk(type: string, data: Uint8Array, maxBytes = 16_777_216): Uint8Array {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || data.length + 12 > maxBytes) throw new RangeError("PNG output budget exceeded");
  if (type.length !== 4 || [...type].some(character => !((character >= "A" && character <= "Z") || (character >= "a" && character <= "z")))) throw new TypeError("Invalid PNG chunk type");
  const bytes = new Uint8Array(data.length + 12);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, data.length);
  for (let index = 0; index < 4; index++) bytes[index + 4] = type.charCodeAt(index);
  bytes.set(data, 8);
  view.setUint32(bytes.length - 4, checksum(bytes.subarray(4, bytes.length - 4)));
  return bytes;
}

function parse(input: Uint8Array, resources: Resources): { chunks: Chunk[]; tags: MetadataTag[] } {
  resources.admit("input", input.length);
  resources.admit("retained", input.length);
  resources.admit("work", input.length * 10);
  const bytes = new Uint8Array(input);
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error("Not a PNG file");
  const view = new DataView(bytes.buffer);
  const chunks: Chunk[] = [];
  const tags: MetadataTag[] = [];
  const instances = new Map<string, number>();
  let offset = 8;
  let ended = false;
  let imageData = false;
  while (offset < bytes.length) {
    resources.signal.throwIfAborted();
    resources.admit("retained", 128);
    if (ended) throw new Error("PNG trailing data not yet supported");
    if (bytes.length - offset < 12) throw new Error("PNG truncated chunk");
    const size = view.getUint32(offset);
    if (size > bytes.length - offset - 12) throw new Error("PNG truncated chunk data");
    const end = offset + size + 12;
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (checksum(bytes.subarray(offset + 4, end - 4)) !== view.getUint32(end - 4)) throw new Error("PNG CRC mismatch");
    const data = bytes.subarray(offset + 8, end - 4);
    if (offset === 8 && type !== "IHDR") throw new Error("PNG missing initial IHDR");
    if (type === "IHDR") {
      if (offset !== 8 || size !== 13) throw new Error("Invalid PNG IHDR");
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (!header.getUint32(0) || !header.getUint32(4) || header.getUint32(0) > 0x7fffffff || header.getUint32(4) > 0x7fffffff) throw new Error("Invalid PNG dimensions");
      if (!bitDepths[data[9]!]?.includes(data[8]!) || data[10] !== 0 || data[11] !== 0 || data[12]! > 1) throw new Error("Invalid PNG IHDR encoding fields");
    }
    if (type === "IDAT") imageData = true;
    if (type === "IEND" && !imageData) throw new Error("PNG missing IDAT");
    let tag: MetadataTag | undefined;
    let rawName: string | undefined, name = "", value = "";
    let raw: Uint8Array | undefined;
    let start = 0;
    if (type === "zTXt" || type === "eXIf") throw new Error("PNG " + type + " metadata not yet supported");
    if (type === "tEXt" || type === "iTXt") {
      const separator = data.indexOf(0);
      if (separator < 1 || separator > 79) throw new Error("Invalid PNG text keyword");
      resources.admit("decoded", data.length * 2);
      resources.admit("work", data.length * 8);
      const keyword = Array.from(data.subarray(0, separator), byte => String.fromCharCode(byte)).join("");
      start = separator + 1;
      if (type === "iTXt") {
        if (start + 2 > data.length) throw new Error("PNG truncated iTXt header");
        if (data[start] !== 0) throw new Error("PNG compressed iTXt not yet supported");
        if (data[start + 1] !== 0) throw new Error("Invalid PNG iTXt compression method");
        const languageEnd = data.indexOf(0, start + 2);
        const translatedEnd = languageEnd < 0 ? -1 : data.indexOf(0, languageEnd + 1);
        if (translatedEnd < 0) throw new Error("PNG truncated iTXt language fields");
        // Language-qualified and structured metadata require namespace-aware controls.
        if (languageEnd !== start + 2 || translatedEnd !== languageEnd + 1 || keyword === "XML:com.adobe.xmp") throw new Error("PNG qualified/XMP iTXt not yet supported");
        start = translatedEnd + 1;
      }
      raw = data.subarray(start);
      // Includes transient per-byte strings/array slots in the Latin-1 decoder,
      // owned raw bytes and interpreted UTF-16 strings, in addition to the input.
      resources.admit("retained", raw.length + data.length * 40 + 128);
      value = type === "tEXt" ? Array.from(raw, byte => String.fromCharCode(byte)).join("") : new TextDecoder("utf-8", { ignoreBOM: true }).decode(raw);
      name = exiftoolRegistry.tags.find(name => name.toLowerCase() === keyword.toLowerCase()) ?? keyword;
      rawName = keyword;
    }
    if (type === "tIME") {
      if (size !== 7) throw new Error("Invalid PNG tIME length");
      resources.admit("decoded", 50);
      resources.admit("retained", 256);
      resources.admit("work", 128);
      rawName = "tIME"; name = "ModifyDate"; raw = data;
      const fields = [(data[0]! << 8) | data[1]!, ...data.subarray(2)];
      const parts = fields.map((field, index) => String(field).padStart(index === 0 ? 4 : 2, "0"));
      value = parts.slice(0, 3).join(":") + " " + parts.slice(3).join(":");
    }
    if (rawName !== undefined && raw !== undefined) {
      const instance = instances.get(name) ?? 0;
      instances.set(name, instance + 1);
      tag = Object.freeze({ name, rawName, chunkType: type, index: chunks.length, value, raw: new Uint8Array(raw), instance, offset: offset + 8 + start, group: "PNG" });
      tags.push(tag);
    }
    chunks.push({ type, bytes: bytes.subarray(offset, end), ...(tag ? { tag } : {}) });
    if (type === "IEND") { if (size) throw new Error("Invalid PNG IEND"); ended = true; }
    offset = end;
  }
  if (!ended) throw new Error("PNG truncated: missing IEND");
  return { chunks, tags };
}

export function inspectPng(input: Uint8Array, options: EngineOptions | Resources): { readonly tags: readonly MetadataTag[] } {
  const resources = options instanceof Resources ? options : new Resources(options);
  return Object.freeze({ tags: Object.freeze(parse(input, resources).tags) });
}

/** Selected scalar writes only. Unknown metadata and every other chunk stay exact. */
export function editPng(input: Uint8Array, assignments: readonly TagAssignment[], options: EngineOptions | Resources): Uint8Array {
  const resources = options instanceof Resources ? options : new Resources(options);
  const { chunks } = parse(input, resources);
  resources.admit("retained", assignments.length * 128);
  resources.admit("work", assignments.length * (chunks.length + 1));
  const all = assignments.length === 1 && assignments[0]!.name.toLowerCase() === "all" && assignments[0]!.operation === "set" && assignments[0]!.value === "";
  if (all && chunks.some(chunk => !["IHDR", "PLTE", "IDAT", "IEND", "tEXt", "iTXt", "tIME"].includes(chunk.type))) throw new Error("PNG all deletion with unqualified chunks is not yet supported");
  const operations = new Map<string, TagAssignment[]>();
  for (const assignment of assignments) {
    resources.admit("decoded", (assignment.name.length + assignment.value.length) * 2);
    resources.admit("work", assignment.name.length * 5 + assignment.value.length * 3);
    resources.admit("work", (chunks.length + assignments.length) * (assignment.value.length + assignment.name.length + 1));
    resources.admit("retained", assignment.name.length * 10 + assignment.value.length * 6);
    if (all) continue;
    const name = exiftoolRegistry.tags.find(name => name.toLowerCase() === assignment.name.toLowerCase());
    if (!name) throw new Error("Tag write not yet supported: " + assignment.name);
    if (name === "ModifyDate" && assignment.operation !== "set") throw new Error("Temporal shifts are not yet supported for ModifyDate");
    if (assignment.operation === "add") {
      const group = exiftoolRegistry.scalarShiftErrorGroups[name];
      if (group && !isNumericShift(assignment.value)) throw new Error("Shift value for " + group + ":" + name + " is not a number");
      throw new Error("Scalar numeric shifts are not yet supported for " + name);
    }
    if (assignment.operation !== "set" && assignment.operation !== "remove") throw new Error("Invalid tag operation");
    const prior = assignment.operation === "set" ? [] : operations.get(name) ?? [];
    prior.push(assignment); operations.set(name, prior);
  }
  const output: Uint8Array[] = [signature];
  let outputSize = 8;
  resources.admit("output", 8);
  const append = (bytes: Uint8Array): void => { resources.admit("output", bytes.length); outputSize += bytes.length; output.push(bytes); };
  let inserted = false;
  for (const chunk of chunks) {
    if (all && chunk.tag) continue;
    const ops = chunk.tag && exiftoolRegistry.writeChunks[chunk.tag.name]?.includes(chunk.type) ? operations.get(chunk.tag.name) : undefined;
    if (ops?.some(op => op.operation === "set" || op.value === chunk.tag!.value)) continue;
    if (chunk.type === "IDAT" && !inserted) {
      inserted = true;
      for (const [name, ops] of operations) {
        const set = ops.find(op => op.operation === "set");
        if (!set?.value || ops.some(op => op.operation === "remove" && op.value === set.value)) continue;
        if (name === "ModifyDate") {
          const data = encodePngTime(set.value, resources);
          resources.admit("work", 128);
          resources.admit("retained", 19);
          resources.admit("output", 19);
          outputSize += 19;
          output.push(pngChunk("tIME", data, 19));
          continue;
        }
        // Default native UTF-8 policy uses iTXt for every non-ASCII value,
        // including characters that could also be represented in Latin-1.
        resources.admit("work", set.value.length * 2);
        let valueBytes = 0;
        let international = false;
        for (let index = 0; index < set.value.length; index++) {
          const code = set.value.charCodeAt(index);
          international ||= code > 127;
          if (code >= 0xd800 && code <= 0xdbff) {
            const next = set.value.charCodeAt(++index);
            if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error("Unpaired surrogate in PNG text write");
            valueBytes += 4;
          } else {
            if (code >= 0xdc00 && code <= 0xdfff) throw new Error("Unpaired surrogate in PNG text write");
            valueBytes += code < 128 ? 1 : code < 2048 ? 2 : 3;
          }
        }
        const prefix = name + (international ? "\0\0\0\0\0" : "\0");
        const dataSize = prefix.length + valueBytes;
        const size = dataSize + 12;
        resources.admit("work", dataSize * 12);
        resources.admit("retained", prefix.length * 2 + valueBytes + dataSize + size);
        resources.admit("output", size);
        const data = new Uint8Array(dataSize);
        for (let index = 0; index < prefix.length; index++) data[index] = prefix.charCodeAt(index);
        data.set(new TextEncoder().encode(set.value), prefix.length);
        outputSize += size;
        output.push(pngChunk(international ? "iTXt" : "tEXt", data, size));
        // Native PNG scalar writes replace each existing text instance rather
        // than collapsing duplicates. A missing tag creates one new instance.
        let instances = 0;
        for (const existing of chunks) {
          resources.signal.throwIfAborted();
          resources.admit("work", 1);
          if (existing.tag?.name === name && exiftoolRegistry.writeChunks[name]?.includes(existing.type)) instances++;
        }
        for (let instance = 1; instance < instances; instance++) append(output[output.length - 1]!);
      }
    }
    append(chunk.bytes);
  }
  resources.admit("retained", outputSize);
  resources.admit("work", outputSize);
  const result = new Uint8Array(outputSize);
  let position = 0;
  for (const bytes of output) { result.set(bytes, position); position += bytes.length; }
  resources.signal.throwIfAborted();
  return result;
}
