import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSource } from "@poe-code/office-package";
import { OfficeError } from "./office-errors.js";
import type { RetainedXmlContext as RetainedPackageContext } from "./office-resources.js";
import { resolveOfficeResources as resourceContext } from "./office-resources.js";

/** A range in the stored UTF-8 representation, excluding surrounding markup. */
export interface XmlRange { readonly start: number; readonly length: number; }
export interface XmlLexicalToken {
  readonly kind: "text" | "start-name" | "attribute-name" | "attribute-value" | "start-end" | "end-name" | "comment" | "cdata" | "instruction";
  readonly range: XmlRange;
  readonly empty?: boolean;
}
export interface RetainedXml {
  readonly encoding: "utf-8" | "utf-16le" | "utf-16be";
  readonly byteLength: number;
  readonly bom: boolean;
  /** Delimiter scanning only. Consumers must validate names, entities, namespaces,
   * element matching, declaration and application semantics before admission. */
  tokens(): AsyncGenerator<XmlLexicalToken>;
  read(range: XmlRange): ByteSource;
  /** Expand predefined/numeric references and normalize XML 1.0 value whitespace. */
  value(range: XmlRange, attribute?: boolean, entities?: boolean): ByteSource;
  close(): Promise<void>;
}

function invalid(): never { throw new OfficeError("invalid-xml", "Invalid XML lexical structure.", "parse"); }
const space = (byte: number) => byte === 32 || byte === 9 || byte === 10 || byte === 13;
const nameStart = (byte: number) => byte === 58 || byte === 95 || byte >= 65 && byte <= 90 || byte >= 97 && byte <= 122 || byte >= 128;
const nameByte = (byte: number) => nameStart(byte) || byte >= 48 && byte <= 57 || byte === 45 || byte === 46;

/** Decode in bounded windows into caller storage. No token, attribute or text
 * value is accumulated into a string; arbitrarily long values remain ranges.
 * This is the lexical layer for retained semantic indexes, not XML admission. */
export async function openRetainedXml(source: ByteSource, settings: RetainedPackageContext): Promise<RetainedXml> {
  const context = resourceContext(settings), working = settings.workingStorage;
  const cacheBytes = working?.cacheBytes ?? 1024 * 1024;
  if (!working?.fs || typeof working.directory !== "string" || !working.directory.startsWith("/")
    || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError("invalid-value", "Explicit XML working storage and a valid cache budget are required.", "usage");
  const signal = context.signal ?? new AbortController().signal;
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  const start = pages.allocate(0), encoder = new TextEncoder();
  let encoding: RetainedXml["encoding"] = "utf-8", decoder: TextDecoder | undefined;
  let length = 0, inputBytes = 0, closed = false, bom = false;
  let closing: Promise<void> | undefined;
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "XML storage is closed.", "parse");
    if (signal.aborted) throw new OfficeError("cancelled", "Operation cancelled.", "parse");
  };
  const close = () => { closed = true; return closing ??= pages.close(); };
  const failure = (error: unknown): unknown => {
    if (error instanceof OfficeError) return error;
    if (signal.aborted) return new OfficeError("cancelled", "Operation cancelled.", "parse");
    return new OfficeError("io-failure", "XML storage operation failed.", "parse");
  };
  async function decode(bytes: Uint8Array, final = false) {
    let text: string;
    try { text = decoder!.decode(bytes, { stream: !final }); } catch { invalid(); }
    for (const character of text) {
      const point = character.codePointAt(0)!;
      if (!(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff
        || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff)) invalid();
    }
    const encoded = encoder.encode(text);
    for (let offset = 0; offset < encoded.length; offset += 16384) {
      check(); const chunk = encoded.subarray(offset, offset + 16384);
      await pages.append(chunk); length += chunk.length;
    }
  }
  const header = new Uint8Array(3);
  let headerLength = 0;
  function initializeDecoder() {
    if (headerLength >= 2 && (header[0] === 255 && header[1] === 254 || header[0] === 60 && header[1] === 0)) encoding = "utf-16le";
    else if (headerLength >= 2 && (header[0] === 254 && header[1] === 255 || header[0] === 0 && header[1] === 60)) encoding = "utf-16be";
    bom = encoding === "utf-8" ? headerLength === 3 && header[0] === 239 && header[1] === 187 && header[2] === 191
      : headerLength >= 2 && (header[0] === 255 && header[1] === 254 || header[0] === 254 && header[1] === 255);
    decoder = new TextDecoder(encoding, { fatal: true });
  }
  try {
    for await (const chunk of source) {
      check();
      if (!(chunk instanceof Uint8Array)) throw new OfficeError("invalid-type", "Expected XML byte chunks.", "parse");
      if (chunk.length > context.xmlLimits.maxBytes - inputBytes || !Number.isSafeInteger(inputBytes + chunk.length))
        throw new OfficeError("resource-limit", "XML byte limit exceeded.", "parse");
      inputBytes += chunk.length;
      let offset = 0;
      if (!decoder) {
        while (offset < chunk.length && headerLength < 3) header[headerLength++] = chunk[offset++]!;
        if (headerLength < 3) continue;
        initializeDecoder();
        await decode(header);
      }
      for (; offset < chunk.length; offset += 16384) {
        check(); await decode(new Uint8Array(chunk.subarray(offset, offset + 16384)));
      }
    }
    if (!decoder) { initializeDecoder(); await decode(header.subarray(0, headerLength)); }
    await decode(new Uint8Array(), true); check();
  } catch (error) { await close().catch(() => {}); throw failure(error); }

  function validRange(range: XmlRange) {
    if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.length) || range.start < 0 || range.length < 0
      || range.start > length || range.length > length - range.start)
      throw new OfficeError("invalid-value", "Invalid XML storage range.", "usage");
  }
  async function* read(range: XmlRange): ByteSource {
    try {
      check(); validRange(range);
      for (let offset = 0; offset < range.length; offset += 16384) {
        check(); yield await pages.read(start + range.start + offset, Math.min(16384, range.length - offset));
      }
      check();
    } catch (error) { throw failure(error); }
  }
  return Object.freeze({ encoding, bom, byteLength: length, close, read,
    async *value(range: XmlRange, attribute = false, entities = true) {
      const decoder = new TextDecoder("utf-8", { fatal: true });
      let output = "", entity = "", mode = 0, point = 0, digits = false, carriage = false, brackets = 0;
      const predefined: Readonly<Record<string, string>> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
      const character = (value: string) => {
        if (mode) {
          if (value === ";") {
            if (mode === 5) {
              if (!Object.hasOwn(predefined, entity)) invalid();
              output += predefined[entity];
            } else {
              if ((mode !== 3 && mode !== 4) || !digits || !(point === 9 || point === 10 || point === 13 || point >= 32 && point <= 0xd7ff
                || point >= 0xe000 && point <= 0xfffd || point >= 0x10000 && point <= 0x10ffff)) invalid();
              output += String.fromCodePoint(point);
            }
            mode = 0; return;
          }
          if (mode === 1) {
            if (value === "#") { mode = 2; point = 0; digits = false; return; }
            mode = 5; entity = "";
          } else if (mode === 2) {
            if (value === "x") { mode = 4; return; }
            mode = 3;
          }
          if (mode === 5) { entity += value; if (entity.length > 4) invalid(); return; }
          const code = value.charCodeAt(0);
          const digit = code >= 48 && code <= 57 ? code - 48 : mode === 4 && code >= 65 && code <= 70 ? code - 55
            : mode === 4 && code >= 97 && code <= 102 ? code - 87 : -1;
          if (digit < 0) invalid();
          point = point * (mode === 4 ? 16 : 10) + digit; digits = true;
          if (point > 0x10ffff) invalid(); return;
        }
        if (carriage) { carriage = false; if (value === "\n") return; }
        if (entities && (value === "<" || !attribute && value === ">" && brackets === 2)) invalid();
        brackets = value === "]" ? Math.min(2, brackets + 1) : 0;
        if (entities && value === "&") { mode = 1; return; }
        if (value === "\r") { carriage = true; output += attribute ? " " : "\n"; }
        else output += attribute && (value === "\n" || value === "\t") ? " " : value;
      };
      try {
        for await (const bytes of read(range)) {
          let text: string;
          try { text = decoder.decode(bytes, { stream: true }); } catch { invalid(); }
          for (const value of text) {
            character(value);
            if (output.length >= 4096) { check(); yield encoder.encode(output); output = ""; }
          }
        }
        try { if (decoder.decode()) invalid(); } catch { invalid(); }
        if (mode) invalid();
        check(); if (output) yield encoder.encode(output); check();
      } catch (error) { throw failure(error); }
    },
    async *tokens(): AsyncGenerator<XmlLexicalToken> {
      let position = 0, windowStart = -1;
      let window: Uint8Array = new Uint8Array();
      const range = (begin: number, end = position): XmlRange => Object.freeze({ start: begin, length: end - begin });
      const peek = async (): Promise<number> => {
        check(); if (position === length) return -1;
        if (position < windowStart || position >= windowStart + window.length) {
          windowStart = position; window = await pages.read(start + position, Math.min(16384, length - position));
        }
        return window[position - windowStart]!;
      };
      const take = async (expected: number) => { if (await peek() !== expected) invalid(); position++; };
      const spaces = async () => { const begin = position; while (space(await peek())) position++; return position !== begin; };
      const name = async () => {
        const begin = position;
        if (!nameStart(await peek())) invalid();
        do { position++; } while (nameByte(await peek()));
        return range(begin);
      };
      const delimited = async (end: string, forbidDoubleDash = false) => {
        const begin = position;
        let matched = 0;
        for (;;) {
          const byte = await peek(); if (byte < 0) invalid(); position++;
          if (byte === end.charCodeAt(matched)) {
            if (++matched === end.length) return range(begin, position - end.length);
          } else {
            if (forbidDoubleDash && matched === 2) invalid();
            matched = matched === 2 && end[0] === end[1] && byte === end.charCodeAt(0) ? 2
              : byte === end.charCodeAt(0) ? 1 : 0;
          }
        }
      };
      try {
        check();
        while (position < length) {
          if (await peek() !== 60) {
            const begin = position;
            while (position < length && await peek() !== 60) position++;
            yield { kind: "text", range: range(begin) }; continue;
          }
          position++;
          const next = await peek();
          if (next === 33) {
            position++;
            if (await peek() === 45) {
              await take(45); await take(45);
              yield { kind: "comment", range: await delimited("-->", true) };
            } else {
              for (const character of "[CDATA[") await take(character.charCodeAt(0));
              yield { kind: "cdata", range: await delimited("]]>") };
            }
          } else if (next === 63) {
            position++; yield { kind: "instruction", range: await delimited("?>") };
          } else if (next === 47) {
            position++; const value = await name(); await spaces(); await take(62);
            yield { kind: "end-name", range: value };
          } else {
            yield { kind: "start-name", range: await name() };
            for (;;) {
              const separated = await spaces(), byte = await peek();
              if (byte === 62 || byte === 47) {
                const empty = byte === 47;
                if (empty) position++;
                await take(62); yield { kind: "start-end", range: range(position), empty }; break;
              }
              if (!separated) invalid();
              yield { kind: "attribute-name", range: await name() };
              await spaces(); await take(61); await spaces();
              const quote = await peek(); if (quote !== 34 && quote !== 39) invalid(); position++;
              const begin = position;
              while (await peek() !== quote) { const byte = await peek(); if (byte < 0 || byte === 60) invalid(); position++; }
              const value = range(begin); position++;
              yield { kind: "attribute-value", range: value };
            }
          }
        }
        check();
      } catch (error) { throw failure(error); }
    }
  });
}
