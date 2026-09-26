import type { ByteSource, CodecProvider } from "../contracts.js";
import { PythonException } from "../diagnostics/exception.js";
import { CsvkitBlocked } from "../errors.js";
import { pythonCodecAliases } from "./aliases.js";
import { decodeFrames } from "./frames.js";
import { utf8Codec } from "./utf8.js";
import { dbfCodepages } from './dbf-codepages.js';

/** encodings.normalize_encoding: punctuation collapses, trailing punctuation drops. */
export function normalizeEncoding(encoding: string): string {
  let result = "", punctuation = false;
  for (const char of encoding) {
    const code = char.codePointAt(0)!;
    if ((code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || char === ".") {
      if (punctuation && result) result += "_";
      result += char.toLowerCase();
      punctuation = false;
    } else punctuation = true;
  }
  return result;
}

export function resolveCodec(providers: readonly CodecProvider[], encoding: string): { readonly codec: CodecProvider; readonly encoding: string } {
  const name = normalizeEncoding(encoding);
  const canonical = Object.hasOwn(pythonCodecAliases, name) ? pythonCodecAliases[name]! : undefined;
  const codec = providers.find(provider => provider.names.some(alias => {
    const normalized = normalizeEncoding(alias);
    return normalized === name || (canonical !== undefined && pythonCodecAliases[normalized] === canonical);
  }));
  if (codec) return { codec, encoding: canonical ?? encoding };
  if (canonical !== undefined) throw new CsvkitBlocked(`codec ${encoding}`);
  throw new PythonException("LookupError", `unknown encoding: ${encoding}`);
}

function decodingError(encoding: string): PythonException {
  // Native detailed frames remain a verbose-profile blocker. Nonverbose handling
  // uses the original requested encoding at the engine diagnostic boundary.
  return new PythonException("UnicodeDecodeError", `${encoding} decoding failed`);
}

const cp1252High = [
  0x20ac, -1, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, -1, 0x017d, -1,
  -1, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, -1, 0x017e, 0x0178
];

interface EncodingDescriptor {
  readonly name: string;
  readonly width: 1 | 2;
  readonly byteOrder?: "little" | "big" | "signature";
  readonly codepoints?: readonly number[];
}

function createCodec(descriptor: EncodingDescriptor): CodecProvider {
  const decodeStream = async function* (source: ByteSource, _encoding: string, signal: AbortSignal): AsyncGenerator<string> {
    let decoder: TextDecoder | undefined;
    for await (const frame of decodeFrames(source, signal)) {
      signal.throwIfAborted();
      if (descriptor.width === 1) {
        let text = "";
        for (const byte of frame) {
          const code = descriptor.codepoints![byte]!;
          if (code < 0) throw decodingError(descriptor.name);
          text += String.fromCodePoint(code);
        }
        yield text;
      } else {
        let bytes = frame;
        if (!decoder) {
          let order = descriptor.byteOrder;
          if (order === "signature") {
            if (bytes[0] === 0xff && bytes[1] === 0xfe) order = "little";
            else if (bytes[0] === 0xfe && bytes[1] === 0xff) order = "big";
            else throw decodingError(descriptor.name);
            bytes = bytes.subarray(2);
          }
          decoder = new TextDecoder(order === "big" ? "utf-16be" : "utf-16le", { fatal: true, ignoreBOM: true });
        }
        let text: string;
        try { text = decoder.decode(bytes, { stream: true }); }
        catch { throw decodingError(descriptor.name); }
        yield text;
      }
    }
    signal.throwIfAborted();
    if (decoder) {
      let text: string;
      try { text = decoder.decode(); }
      catch { throw decodingError(descriptor.name); }
      yield text;
    }
  };
  return Object.freeze({
    names: Object.freeze([descriptor.name]), decodeStream,
    async decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string> {
      signal.throwIfAborted();
      // bytes.decode('utf-16') defaults to native endian without a signature;
      // TextIO's incremental decoder above requires one. Keep the two APIs distinct.
      if (descriptor.width === 2) {
        let order = descriptor.byteOrder;
        if (order === "signature") {
          order = "little";
          if (bytes[0] === 0xff && bytes[1] === 0xfe) bytes = bytes.subarray(2);
          else if (bytes[0] === 0xfe && bytes[1] === 0xff) { order = "big"; bytes = bytes.subarray(2); }
        }
        try { return new TextDecoder(order === "big" ? "utf-16be" : "utf-16le", { fatal: true, ignoreBOM: true }).decode(bytes); }
        catch { throw decodingError(descriptor.name); }
      }
      let text = "";
      for await (const fragment of decodeStream({ async *[Symbol.asyncIterator]() { yield bytes; } }, encoding, signal)) text += fragment;
      return text;
    },
    async encode(text: string, _encoding: string, signal: AbortSignal): Promise<Uint8Array> {
      signal.throwIfAborted();
      const bytes: number[] = [];
      if (descriptor.byteOrder === "signature") bytes.push(0xff, 0xfe);
      for (const char of text) {
        signal.throwIfAborted();
        const code = char.codePointAt(0)!;
        if (code >= 0xd800 && code <= 0xdfff) throw new CsvkitBlocked("strict output surrogate encoding");
        if (descriptor.width === 1) {
          const byte = descriptor.codepoints!.indexOf(code);
          if (byte < 0) throw new CsvkitBlocked(`output encoding ${descriptor.name} cannot represent U+${code.toString(16)}`);
          bytes.push(byte);
        } else {
          for (let index = 0; index < char.length; index++) {
            const unit = char.charCodeAt(index);
            if (descriptor.byteOrder === "big") bytes.push(unit >> 8, unit & 255);
            else bytes.push(unit & 255, unit >> 8);
          }
        }
      }
      return Uint8Array.from(bytes);
    }
  });
}

/** Finite, explicitly injected codecs; no ambient converter or codec loading. */
export const pythonCodecs: readonly CodecProvider[] = Object.freeze([
  utf8Codec,
  ...Object.entries(dbfCodepages).map(([name, codepoints]) => createCodec({ name, width: 1, codepoints })),
  ...([
    { name: "utf-16", width: 2, byteOrder: "signature" },
    { name: "utf-16-le", width: 2, byteOrder: "little" },
    { name: "utf-16-be", width: 2, byteOrder: "big" },
    { name: "ascii", width: 1, codepoints: Array.from({ length: 256 }, (_, byte) => byte < 128 ? byte : -1) },
    { name: "iso8859-1", width: 1, codepoints: Array.from({ length: 256 }, (_, byte) => byte) },
    { name: "cp1252", width: 1, codepoints: Array.from({ length: 256 }, (_, byte) => byte >= 128 && byte < 160 ? cp1252High[byte - 128]! : byte) }
  ] satisfies EncodingDescriptor[]).map(createCodec)
]);
