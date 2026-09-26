import { SsconvertError } from "../contracts.js";
import { nativeTextCharsets } from "../codecs/native-text-charsets.js";
import { encodingName } from "./names.js";
import { singleByteTables } from "./tables.js";

/** GOffice tries the override first, then detection, ASCII, UTF-8 and Latin-1. */
export function decodeText(bytes: Uint8Array, encoding?: string): string {
  if (encoding !== undefined) {
    const name = encodingName(encoding);
    if (!Object.hasOwn(singleByteTables, name) && !["utf-8", "utf-16", "utf-16le", "utf-16be",
      "utf-32", "utf-32le", "utf-32be", "ucs-2", "ucs-2le", "ucs-2be",
      "ucs-4", "ucs-4le", "ucs-4be", "utf-7"].includes(name)) {
      // WHATWG decoder availability does not establish iconv aliases, mappings
      // or invalid/truncated-byte semantics. Admit only captured capabilities.
      if (nativeTextCharsets.has(encoding.toLowerCase().split("//", 1)[0]!))
        throw new SsconvertError("unsupported-feature", "Unsupported ssconvert feature: uncaptured import charset");
    }
  }
  const guesses: string[] = encoding === undefined ? [] : [encodingName(encoding)];
  if (bytes[0] === 255 && bytes[1] === 254) guesses.push("utf-16le");
  if (bytes[0] === 254 && bytes[1] === 255) guesses.push("utf-16be");
  if (bytes[0] === 60 && bytes[1] === 0 && bytes[2] === 63 && bytes[3] === 0) guesses.push("utf-16le");
  if (bytes[0] === 0 && bytes[1] === 60 && bytes[2] === 0 && bytes[3] === 63) guesses.push("utf-16be");
  guesses.push("utf-8");
  for (const guess of guesses) {
    try {
      const label = guess.toLowerCase();
      const table = Object.hasOwn(singleByteTables, label) ? singleByteTables[label] : undefined;
      if (table !== undefined) {
        const chunks: string[] = [];
        for (const byte of bytes) {
          const character = table[byte]!;
          if (character === "\uffff") throw new RangeError("Invalid encoded byte");
          chunks.push(character);
        }
        return chunks.join("");
      }
      if (label === "utf-7" || label === "utf7") return decodeUtf7(bytes);
      if (["utf-32", "utf-32le", "utf-32be", "ucs-4", "ucs-4le", "ucs-4be"].includes(label)) {
        const little = label.endsWith("le") || label === "utf-32" && !(bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 254 && bytes[3] === 255);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        let decoded = "";
        for (let i = 0; i + 4 <= bytes.length; i += 4) {
          const value = view.getUint32(i, little);
          if (value > 0x10ffff || value >= 0xd800 && value <= 0xdfff) throw new RangeError("Invalid UTF-32");
          if (i !== 0 || value !== 0xfeff) decoded += String.fromCodePoint(value);
        }
        return decoded;
      }
      // WHATWG maps ISO-8859-1 to Windows-1252; iconv does not.
      if (["iso-8859-1", "iso8859-1", "iso_8859-1", "latin1", "latin-1"].includes(label))
        return decodeLatin1(bytes);
      if (["ascii", "us-ascii"].includes(label) && bytes.some(b => b > 127)) continue;
      if (!["utf-8", "utf-16", "utf-16le", "utf-16be", "ucs-2", "ucs-2le", "ucs-2be"].includes(label)) continue;
      const unicode16 = label === "utf-16" || label.startsWith("ucs-2");
      const decoderLabel = unicode16 ?
        (label.endsWith("be") || label === "utf-16" && bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-16le") : guess;
      if (label.startsWith("ucs-2")) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i + 2 <= bytes.length; i += 2) {
          const unit = view.getUint16(i, decoderLabel !== "utf-16be");
          if (unit >= 0xd800 && unit <= 0xdfff) throw new RangeError("Invalid UCS-2");
        }
      }
      const decoder = new TextDecoder(decoderLabel, { fatal: true });
      // WHATWG assigns controls to five byte values that iconv refuses.
      if (decoder.encoding === "windows-1252" && bytes.some(b => [129, 141, 143, 144, 157].includes(b))) continue;
      // g_convert reports consumed bytes and accepts an incomplete final character.
      return decoder.decode(bytes, { stream: true });
    } catch { /* A failed override is a guess, not a forced decoding failure. */ }
  }
  return decodeLatin1(bytes);
}

function decodeUtf7(bytes: Uint8Array): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let decoded = "", i = 0;
  while (i < bytes.length) {
    const value = bytes[i++]!;
    if (value > 127) throw new RangeError("Invalid UTF-7");
    if (value !== 43) { decoded += String.fromCharCode(value); continue; }
    if (bytes[i] === 45) { decoded += "+"; i++; continue; }
    const start = i;
    while (i < bytes.length && alphabet.includes(String.fromCharCode(bytes[i]!))) i++;
    if (i === start && i < bytes.length) throw new RangeError("Invalid UTF-7");
    const units = new Uint8Array(Math.floor((i - start) * 6 / 16) * 2);
    let accumulator = 0, bits = 0, offset = 0;
    for (let j = start; j < i; j++) {
      accumulator = accumulator * 64 + alphabet.indexOf(String.fromCharCode(bytes[j]!));
      bits += 6;
      if (bits >= 16) {
        bits -= 16;
        const unit = Math.floor(accumulator / 2 ** bits);
        units[offset++] = unit >> 8; units[offset++] = unit & 255;
        accumulator %= 2 ** bits;
      }
    }
    const complete = i < bytes.length;
    if (complete && (bits > 4 || accumulator !== 0)) throw new RangeError("Invalid UTF-7");
    decoded += new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true }).decode(units, { stream: !complete });
    if (bytes[i] === 45) i++;
  }
  return decoded;
}

function decodeLatin1(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return chunks.join("");
}
