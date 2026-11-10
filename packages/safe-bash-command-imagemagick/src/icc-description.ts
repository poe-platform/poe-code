/** Read the profile description tag (ICC v2 textDescription or v4 multiLocalizedUnicode). */
export function readIccDescription(profile: Uint8Array): string | undefined {
  if (profile.length < 132) return undefined;
  const view = new DataView(profile.buffer, profile.byteOffset, profile.byteLength);
  const size = view.getUint32(0), count = view.getUint32(128);
  if (size < 132 || size > profile.length || view.getUint32(36) !== 0x61637370 || count > (size - 132) / 12) return undefined;
  for (let index = 0; index < count; index++) {
    const entry = 132 + index * 12;
    if (view.getUint32(entry) !== 0x64657363) continue; // desc tag
    const offset = view.getUint32(entry + 4), length = view.getUint32(entry + 8);
    if (offset < 132 + count * 12 || length < 12 || offset + length > size) return undefined;
    const type = view.getUint32(offset);
    if (type === 0x64657363) {
      const textLength = view.getUint32(offset + 8);
      if (textLength === 0 || textLength > length - 12) return undefined;
      const text = profile.subarray(offset + 12, offset + 12 + textLength);
      const nul = text.indexOf(0);
      return new TextDecoder().decode(nul < 0 ? text : text.subarray(0, nul));
    }
    if (type !== 0x6d6c7563 || length < 16) return undefined; // mluc type
    const records = view.getUint32(offset + 8);
    if (view.getUint32(offset + 12) !== 12 || records === 0 || records > (length - 16) / 12) return undefined;
    let selected: { offset: number; length: number; rank: number } | undefined;
    for (let record = 0; record < records; record++) {
      const start = offset + 16 + record * 12;
      const textLength = view.getUint32(start + 4), textOffset = view.getUint32(start + 8);
      if (textOffset < 16 + records * 12 || textLength % 2 !== 0 || textOffset + textLength > length) return undefined;
      // ImageMagick requests en-US, falling back to English and then the first locale.
      const rank = view.getUint16(start) === 0x656e ? view.getUint16(start + 2) === 0x5553 ? 2 : 1 : 0;
      if (!selected || rank > selected.rank) selected = { offset: offset + textOffset, length: textLength, rank };
    }
    if (!selected) return undefined;
    const text = new TextDecoder("utf-16be").decode(profile.subarray(selected.offset, selected.offset + selected.length));
    const nul = text.indexOf("\0");
    return nul < 0 ? text : text.slice(0, nul);
  }
  return undefined;
}
