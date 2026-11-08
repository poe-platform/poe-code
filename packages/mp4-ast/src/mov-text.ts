import { BinaryReader, decodeUtf8, encodeUtf8 } from "./binary.js";

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
