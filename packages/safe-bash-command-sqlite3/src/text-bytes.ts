const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { ignoreBOM: true });

// SQLite TEXT can contain arbitrary bytes. Reserve unpaired low surrogates for
// invalid UTF-8 bytes so string operations and database round trips are lossless.
export function decodeSqlText(bytes: Uint8Array): string {
  let text = "", start = 0;
  for (let offset = 0; offset < bytes.length;) {
    const first = bytes[offset]!;
    const width = first < 0x80 ? 1 : first >= 0xc2 && first <= 0xdf ? 2
      : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
    let valid = width > 0 && offset + width <= bytes.length;
    for (let i = 1; valid && i < width; i++) {
      const byte = bytes[offset + i]!;
      valid = byte >= 0x80 && byte <= 0xbf;
      if (i === 1) {
        if (first === 0xe0) valid &&= byte >= 0xa0;
        if (first === 0xed) valid &&= byte < 0xa0;
        if (first === 0xf0) valid &&= byte >= 0x90;
        if (first === 0xf4) valid &&= byte < 0x90;
      }
    }
    if (valid) offset += width;
    else {
      text += decoder.decode(bytes.subarray(start, offset)) + String.fromCharCode(0xdc00 + first);
      start = ++offset;
    }
  }
  return text + decoder.decode(bytes.subarray(start));
}

export function encodeSqlText(text: string): Uint8Array {
  const parts: Uint8Array[] = [];
  let start = 0, length = 0;
  for (let offset = 0; offset < text.length; offset++) {
    const code = text.charCodeAt(offset);
    if (code >= 0xd800 && code <= 0xdbff && text.charCodeAt(offset + 1) >= 0xdc00 && text.charCodeAt(offset + 1) <= 0xdfff) {
      offset++;
    } else if (code >= 0xdc80 && code <= 0xdcff) {
      const prefix = encoder.encode(text.slice(start, offset));
      parts.push(prefix, Uint8Array.of(code - 0xdc00));
      length += prefix.length + 1;
      start = offset + 1;
    }
  }
  if (!parts.length) return encoder.encode(text);
  const tail = encoder.encode(text.slice(start));
  const bytes = new Uint8Array(length + tail.length);
  let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  bytes.set(tail, offset);
  return bytes;
}
