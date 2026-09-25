import { Reader, ascii, cleanText, join } from "./binary.js";
import type { AudioNode, AudioPicture, AudioTags } from "./types.js";

const names: Record<string, string> = {
  TIT2: "title",
  TPE1: "artist",
  TPE2: "albumArtist",
  TALB: "album",
  TRCK: "track",
  TPOS: "disc",
  TCON: "genre",
  TDRC: "date",
  TYER: "date",
  TCOP: "copyright",
  TSSE: "encoder",
  TT2: "title",
  TP1: "artist",
  TP2: "albumArtist",
  TAL: "album",
  TRK: "track",
  TPA: "disc",
  TCO: "genre",
  TYE: "date",
  TCR: "copyright",
  TEN: "encoder"
};
export function synchsafe(r: Reader, offset: number): number {
  let value = 0;
  for (let i = 0; i < 4; i++) {
    const b = r.u8(offset + i);
    if (b & 128) throw new Error("Invalid ID3 synchsafe size");
    value = value * 128 + b;
  }
  return value;
}
function unsync(bytes: Uint8Array): Uint8Array {
  const result: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    result.push(b);
    if (b === 255 && bytes[i + 1] === 0) i++;
  }
  return Uint8Array.from(result);
}
function text(bytes: Uint8Array, encoding: number): string {
  if (encoding === 0) return cleanText(new TextDecoder("latin1").decode(bytes));
  if (encoding === 3) return cleanText(new TextDecoder().decode(bytes));
  if (encoding === 2) return cleanText(new TextDecoder("utf-16be").decode(bytes));
  if (encoding === 1)
    return cleanText(
      new TextDecoder(bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-16le").decode(bytes)
    );
  throw new Error("Invalid ID3 text encoding");
}
function terminated(bytes: Uint8Array, start: number, encoding: number): number {
  const width = encoding === 1 || encoding === 2 ? 2 : 1;
  for (let i = start; i + width <= bytes.length; i += width)
    if (bytes[i] === 0 && (width === 1 || bytes[i + 1] === 0)) return i;
  throw new Error("Unterminated ID3 text field");
}
export interface Id3Result {
  size: number;
  nodes: AudioNode[];
  tags: AudioTags;
  pictures: AudioPicture[];
  version: number;
}
export function parseId3(bytes: Uint8Array): Id3Result {
  const input = new Reader(bytes),
    version = input.u8(3),
    flags = input.u8(5),
    length = synchsafe(input, 6);
  if (![2, 3, 4].includes(version)) throw new Error("Unsupported ID3 version");
  if (version === 2 && flags & 64) throw new Error("Compressed ID3v2.2 tag unsupported");
  const footer = version === 4 && flags & 16 ? 10 : 0;
  input.check(0, 10 + length + footer);
  const payload = input.slice(10, length),
    r = new Reader(flags & 128 && version < 4 ? unsync(payload) : payload);
  const nodes: AudioNode[] = [],
    tags: AudioTags = {},
    pictures: AudioPicture[] = [];
  let pos = 0;
  if (version >= 3 && flags & 64) {
    const extended = version === 4 ? synchsafe(r, 0) : r.u32(0) + 4;
    r.check(0, extended);
    if (extended < 4) throw new Error("Invalid ID3 extended header");
    pos = extended;
  }
  while (pos < r.bytes.length && r.u8(pos) !== 0) {
    const header = version === 2 ? 6 : 10,
      id = r.text(pos, version === 2 ? 3 : 4),
      size =
        version === 2 ? r.u24(pos + 3) : version === 4 ? synchsafe(r, pos + 4) : r.u32(pos + 4);
    const frameFlags = version === 2 ? 0 : r.u16(pos + 8);
    let data = r.slice(pos + header, size);
    if (version === 4 && (flags & 128 || frameFlags & 2)) data = unsync(data);
    const node: AudioNode = {
      type: id,
      offset: 10 + pos,
      size: header + size,
      data,
      fields: { flags: frameFlags, version }
    };
    nodes.push(node);
    const unsupported = version === 3 ? frameFlags & 0x00c0 : frameFlags & 0x000c;
    if (!unsupported && data.length) {
      let prefix = 0;
      if (version === 3 && frameFlags & 32) prefix++;
      if (version === 4 && frameFlags & 64) prefix++;
      if (version === 4 && frameFlags & 1) prefix += 4;
      data = data.subarray(prefix);
      if (id.startsWith("T") && id !== "TXXX" && id !== "TXX")
        tags[names[id] ?? id] = text(data.subarray(1), data[0]!);
      else if (id === "COMM" || id === "COM") {
        const encoding = data[0]!,
          end = terminated(data, 4, encoding),
          width = encoding === 1 || encoding === 2 ? 2 : 1;
        tags.comment = text(data.subarray(end + width), encoding);
      } else if (id === "APIC" || id === "PIC") {
        const encoding = data[0]!,
          mimeEnd = id === "PIC" ? 4 : terminated(data, 1, 0);
        const mime =
          id === "PIC"
            ? `image/${new Reader(data).text(1, 3) === "JPG" ? "jpeg" : new Reader(data).text(1, 3).toLowerCase()}`
            : text(data.subarray(1, mimeEnd), 0);
        const typeOffset = id === "PIC" ? 4 : mimeEnd + 1,
          descriptionStart = typeOffset + 1,
          end = terminated(data, descriptionStart, encoding),
          width = encoding === 1 || encoding === 2 ? 2 : 1;
        pictures.push({
          type: data[typeOffset]!,
          mime,
          description: text(data.subarray(descriptionStart, end), encoding),
          data: data.subarray(end + width)
        });
      }
    }
    pos += header + size;
  }
  if (footer && input.text(10 + length, 3) !== "3DI") throw new Error("Missing ID3 footer");
  return { size: 10 + length + footer, nodes, tags, pictures, version };
}
function syncBytes(value: number): Uint8Array {
  if (value > 0x0fffffff) throw new Error("ID3 tag too large");
  return Uint8Array.from([
    (value >>> 21) & 127,
    (value >>> 14) & 127,
    (value >>> 7) & 127,
    value & 127
  ]);
}
export function encodeId3(
  tags: AudioTags,
  retained: AudioNode[] = [],
  pictures: AudioPicture[] = []
): Uint8Array {
  const frames: Uint8Array[] = [];
  function frame(id: string, data: Uint8Array): void {
    frames.push(join([ascii(id), syncBytes(data.length), new Uint8Array(2), data]));
  }
  for (const node of retained) {
    const flags = Number(node.fields?.flags ?? 0);
    if (flags & (node.fields?.version === 3 ? 0x00c0 : 0x000c)) {
      throw new Error(`Cannot safely rewrite transformed ID3 frame ${node.type}`);
    }
    if (
      node.type === "APIC" ||
      node.type === "PIC" ||
      names[node.type] ||
      (node.type.startsWith("T") && node.type !== "TXXX" && node.type !== "TXX") ||
      node.type === "COMM" ||
      node.type === "COM"
    )
      continue;
    // Only retain v2.3/v2.4 frames whose byte representation is independent of flags/version.
    if (node.type.length === 4 && !node.fields?.flags) frame(node.type, node.data);
    else throw new Error(`Cannot safely rewrite ID3 frame ${node.type}`);
  }
  for (const [name, value] of Object.entries(tags)) {
    const id = Object.keys(names).find((key) => key.length === 4 && names[key] === name) ?? name;
    if (name === "comment")
      frame(
        "COMM",
        join([
          new Uint8Array([3]),
          ascii("eng"),
          new Uint8Array(1),
          new TextEncoder().encode(value)
        ])
      );
    else {
      if (id.length !== 4 || !id.startsWith("T")) throw new Error(`Unsupported ID3 tag ${name}`);
      frame(id, join([new Uint8Array([3]), new TextEncoder().encode(value)]));
    }
  }
  for (const picture of pictures)
    frame(
      "APIC",
      join([
        new Uint8Array([3]),
        ascii(picture.mime),
        new Uint8Array([0, picture.type]),
        new TextEncoder().encode(picture.description),
        new Uint8Array(1),
        picture.data
      ])
    );
  const body = join(frames);
  return join([ascii("ID3"), new Uint8Array([4, 0, 0]), syncBytes(body.length), body]);
}
export function parseId3v1(bytes: Uint8Array): AudioTags {
  const r = new Reader(bytes),
    tags: AudioTags = {};
  for (const [name, offset, size] of [
    ["title", 3, 30],
    ["artist", 33, 30],
    ["album", 63, 30],
    ["date", 93, 4],
    ["comment", 97, 30]
  ] as const)
    tags[name] = cleanText(r.text(offset, size));
  if (r.u8(125) === 0 && r.u8(126) !== 0) {
    tags.track = String(r.u8(126));
    tags.comment = cleanText(r.text(97, 28));
  }
  tags.genre = String(r.u8(127));
  return tags;
}
