/** Decode a bounded sniff sample with Python UTF-8 errors=ignore semantics. */
export function decodeSniffUtf8(bytes:Uint8Array, signature:boolean, signal:AbortSignal):string {
    let text = "", index = signature && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
    while (index < bytes.length) {
      signal.throwIfAborted();
      const first = bytes[index]!;
      if (first < 0x80) { text += String.fromCodePoint(first); index++; continue; }
      const width = first >= 0xc2 && first <= 0xdf ? 2 : first >= 0xe0 && first <= 0xef ? 3 : first >= 0xf0 && first <= 0xf4 ? 4 : 0;
      if (!width) { index++; continue; }
      let consumed = 1, value = first & (width === 2 ? 0x1f : width === 3 ? 0x0f : 7);
      while (consumed < width && index + consumed < bytes.length) {
        const byte = bytes[index + consumed]!;
        const minimum = consumed === 1 && first === 0xe0 ? 0xa0 : consumed === 1 && first === 0xf0 ? 0x90 : 0x80;
        const maximum = consumed === 1 && first === 0xed ? 0x9f : consumed === 1 && first === 0xf4 ? 0x8f : 0xbf;
        if (byte < minimum || byte > maximum) break;
        value = value * 64 + (byte & 0x3f); consumed++;
      }
      if (consumed === width) text += String.fromCodePoint(value);
      index += consumed;
    }
    return text;
}
