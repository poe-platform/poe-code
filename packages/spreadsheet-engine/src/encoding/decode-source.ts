import { SsconvertError, type RangeSource } from "../contracts.js";
import { decodingGuesses } from "./decode.js";
import { singleByteTables } from "./tables.js";

class InvalidEncoding extends Error {}
type Decoder = (bytes: Uint8Array) => string;

function utf7Decoder(): Decoder {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let shifted = false, started = false, bits = 0, accumulator = 0;
  let unicode = new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true });
  const unit = new Uint8Array(2);
  return bytes => {
    let text = "";
    for (const byte of bytes) {
      if (byte > 127) throw new InvalidEncoding();
      const character = String.fromCharCode(byte);
      if (shifted) {
        const value = alphabet.indexOf(character);
        if (value >= 0) {
          started = true; accumulator = accumulator * 64 + value; bits += 6;
          if (bits >= 16) {
            bits -= 16;
            const value = Math.floor(accumulator / 2 ** bits);
            unit[0] = value >> 8; unit[1] = value & 255;
            text += unicode.decode(unit, { stream: true });
            accumulator %= 2 ** bits;
          }
          continue;
        }
        if (!started) {
          if (byte !== 45) throw new InvalidEncoding();
          text += "+";
        } else {
          if (bits > 4 || accumulator !== 0) throw new InvalidEncoding();
          text += unicode.decode();
        }
        shifted = false;
        if (byte === 45) continue;
      }
      if (byte === 43) {
        shifted = true; started = false; bits = 0; accumulator = 0;
        unicode = new TextDecoder("utf-16be", { fatal: true, ignoreBOM: true });
      } else text += character;
    }
    // An unterminated shift at EOF accepts only its complete codepoints, just
    // like g_convert's consumed-byte result. Never flush its partial UTF-16 unit.
    return text;
  };
}

function decoder(label: string, header: Uint8Array): Decoder | undefined {
  label = label.toLowerCase();
  const table = Object.hasOwn(singleByteTables, label) ? singleByteTables[label] : undefined;
  if (table) return bytes => {
    let text = "";
    for (const byte of bytes) {
      const character = table[byte]!;
      if (character === "\uffff") throw new InvalidEncoding();
      text += character;
    }
    return text;
  };
  if (label === "utf-7" || label === "utf7") return utf7Decoder();
  if (["utf-32", "utf-32le", "utf-32be", "ucs-4", "ucs-4le", "ucs-4be"].includes(label)) {
    const little = label.endsWith("le") || label === "utf-32" && !(header[0] === 0 && header[1] === 0 && header[2] === 254 && header[3] === 255);
    let count = 0, unit = 0, first = true;
    return bytes => {
      let text = "";
      for (const byte of bytes) {
        unit = little ? unit + byte * 2 ** (8 * count) : unit * 256 + byte;
        if (++count !== 4) continue;
        if (unit > 0x10ffff || unit >= 0xd800 && unit <= 0xdfff) throw new InvalidEncoding();
        if (!first || unit !== 0xfeff) text += String.fromCodePoint(unit);
        first = false; unit = 0; count = 0;
      }
      return text;
    };
  }
  if (["iso-8859-1", "iso8859-1", "iso_8859-1", "latin1", "latin-1"].includes(label))
    return bytes => { let text = ""; for (const byte of bytes) text += String.fromCharCode(byte); return text; };
  if (!["utf-8", "utf-16", "utf-16le", "utf-16be", "ucs-2", "ucs-2le", "ucs-2be"].includes(label)) return undefined;
  const unicode16 = label === "utf-16" || label.startsWith("ucs-2");
  const name = unicode16 ? (label.endsWith("be") || label === "utf-16" && header[0] === 254 && header[1] === 255 ? "utf-16be" : "utf-16le") : label;
  const textDecoder = new TextDecoder(name, { fatal: true });
  let firstByte: number | undefined;
  return bytes => {
    if (label.startsWith("ucs-2")) for (const byte of bytes) {
      if (firstByte === undefined) { firstByte = byte; continue; }
      const unit = name === "utf-16le" ? firstByte + byte * 256 : firstByte * 256 + byte;
      firstByte = undefined;
      if (unit >= 0xd800 && unit <= 0xdfff) throw new InvalidEncoding();
    }
    return textDecoder.decode(bytes, { stream: true });
  };
}

/** Encoding detection can fail at EOF. Validate each guess with bounded reads,
 * then replay the stable source instead of retaining provisional decoded text. */
export function decodeTextSource(source: RangeSource, signal: AbortSignal, encoding?: string) {
  signal.throwIfAborted();
  const size = source.size;
  if (!Number.isSafeInteger(size) || size < 0) throw new SsconvertError("io", "Invalid ssconvert source size");
  const backendRead = source.read.bind(source);
  const read = async (position: number, maximum: number) => {
    signal.throwIfAborted();
    const bytes = await backendRead(position, maximum, { signal });
    signal.throwIfAborted();
    if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > maximum)
      throw new SsconvertError("io", "Invalid or truncated ssconvert source range");
    return bytes;
  };
  const decode = (convert: Decoder, bytes: Uint8Array) => {
    try { return convert(bytes); }
    catch (error) {
      if (error instanceof TypeError || error instanceof InvalidEncoding) throw new InvalidEncoding();
      throw error;
    }
  };
  let admission: Promise<{ header: Uint8Array; selected: string }> | undefined;
  const select = async () => {
    const header = new Uint8Array(Math.min(size, 4));
    for (let offset = 0; offset < header.length;) {
      const bytes = await read(offset, header.length - offset);
      header.set(bytes, offset); offset += bytes.length;
    }
    let selected = "latin1";
    for (const guess of decodingGuesses(header, encoding)) {
      const convert = decoder(guess, header);
      if (!convert) continue;
      let valid = true;
      for (let offset = 0; offset < size;) {
        const bytes = await read(offset, Math.min(16384, size - offset));
        try { decode(convert, bytes); }
        catch (error) { if (!(error instanceof InvalidEncoding)) throw error; valid = false; break; }
        offset += bytes.length;
      }
      if (valid) { selected = guess; break; }
    }
    return { header, selected };
  };
  return { async *[Symbol.asyncIterator]() {
    signal.throwIfAborted();
    const { header, selected } = await (admission ??= select());
    const convert = decoder(selected, header)!;
    for (let offset = 0; offset < size;) {
      const bytes = await read(offset, Math.min(16384, size - offset));
      const text = decode(convert, bytes);
      offset += bytes.length;
      if (text) yield text;
    }
    signal.throwIfAborted();
  } };
}
