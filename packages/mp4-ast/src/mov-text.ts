import { BinaryReader, BinaryWriter, decodeUtf8, encodeUtf8 } from "./binary.js";

/** Decode tx3g's byte-counted text and character-indexed style records. */
export function decodeMovText(bytes: Uint8Array): Uint8Array {
  if (bytes.length < 2) return bytes;
  const reader = new BinaryReader(bytes);
  const length = reader.readU16BE();
  if (length + 2 > bytes.length) return bytes;
  const text = reader.readSlice(length);
  const ranges: { start: number; end: number; flags: number }[] = [];
  while (reader.remaining >= 8) {
    const size = reader.readU32BE();
    const type = reader.readFourCC();
    if (size < 8 || size - 8 > reader.remaining) break;
    const box = new BinaryReader(reader.readSlice(size - 8));
    if (type !== "styl" || box.remaining < 2) continue;
    const count = box.readU16BE();
    if (count > Math.floor(box.remaining / 12)) continue;
    for (let i = 0; i < count; i++) {
      const start = box.readU16BE(), end = box.readU16BE();
      box.skip(2); // font ID
      const flags = box.readU8();
      box.skip(5); // font size and RGBA
      if (end > start) ranges.push({ start, end, flags });
    }
  }
  if (!ranges.length) return text;
  const characters = Array.from(decodeUtf8(text));
  ranges.sort((a, b) => a.start - b.start);
  let cursor = 0, result = "";
  for (const { start, end, flags } of ranges) {
    if (start < cursor || start >= characters.length) continue;
    const tags = ["b", "i", "u"].filter((_, bit) => flags & (1 << bit));
    result += characters.slice(cursor, start).join("") + tags.map(tag => `<${tag}>`).join("");
    result += characters.slice(start, end).join("") + tags.reverse().map(tag => `</${tag}>`).join("");
    cursor = Math.min(end, characters.length);
  }
  return encodeUtf8(result + characters.slice(cursor).join(""));
}

/** Encode emphasis using character offsets; the text prefix counts UTF-8 bytes. */
export function encodeMovText(bytes: Uint8Array): Uint8Array {
  const input = decodeUtf8(bytes);
  const characters: string[] = [];
  const ranges: { start: number; end: number; flags: number }[] = [];
  let flags = 0;
  for (let position = 0; position < input.length;) {
    if (input[position] === "<") {
      const end = input.indexOf(">", position + 1);
      if (end >= 0) {
        const tag = input.slice(position + 1, end).toLowerCase();
        const closing = tag.startsWith("/");
        const bit = ["b", "i", "u"].indexOf(closing ? tag.slice(1) : tag);
        if (bit >= 0) {
          flags = closing ? flags & ~(1 << bit) : flags | (1 << bit);
          position = end + 1;
          continue;
        }
      }
    }
    const character = String.fromCodePoint(input.codePointAt(position)!);
    if (flags) {
      const previous = ranges.at(-1);
      if (previous?.flags === flags && previous.end === characters.length) previous.end++;
      else ranges.push({ start: characters.length, end: characters.length + 1, flags });
    }
    characters.push(character);
    position += character.length;
  }
  const text = encodeUtf8(characters.join(""));
  if (text.length > 0xffff) throw new Error("Timed-text subtitle exceeds 65535 bytes");
  const writer = new BinaryWriter(2 + text.length + (ranges.length ? 10 + 12 * ranges.length : 0));
  writer.writeU16BE(text.length);
  writer.writeBytes(text);
  if (ranges.length) {
    writer.writeU32BE(10 + 12 * ranges.length);
    writer.writeFourCC("styl");
    writer.writeU16BE(ranges.length);
    for (const { start, end, flags } of ranges) {
      writer.writeU16BE(start);
      writer.writeU16BE(end);
      writer.writeU16BE(1); // default Arial font
      writer.writeU8(flags);
      writer.writeU8(16);
      writer.writeU32BE(0xffffffff);
    }
  }
  return writer.toUint8Array();
}
