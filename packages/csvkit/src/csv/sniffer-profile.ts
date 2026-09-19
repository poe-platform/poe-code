import { CsvkitBlocked } from "../errors.js";

/** Frozen buffer.peek size and decode(errors='ignore') behavior, independent of transport chunks. */
export interface SniffStreamProfile {
  readonly name: string;
  readonly peekBytes: number;
  decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string>;
}

export const defaultSniffStreamProfile: SniffStreamProfile = Object.freeze({
  name: "cpython-buffered-65536-utf8-ignore-v1",
  peekBytes: 65536,
  async decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string> {
    const name = encoding.toLowerCase().replaceAll("_", "-");
    if (!["utf-8", "utf8", "utf-8-sig"].includes(name))
      throw new CsvkitBlocked(`stdin sniff decode(errors=ignore) profile for ${encoding}`);
    let text = "", index = name === "utf-8-sig" && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
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
});
