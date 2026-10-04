import { parseXmlStream, XmlLimitError, type XmlElement } from "@poe-code/safe-fs/xml";
import { createCompressionCodec, type CompressionReader } from "@poe-code/office-package";
import { ownedRangeSource } from "@poe-code/spreadsheet-engine/range-input";
import { SsconvertError, type CapabilityContext, type RangeSource } from "../contracts.js";
import { encodingName } from "../encoding/names.js";
import { singleByteTables } from "../encoding/tables.js";

export class GnumericSourceFailure extends Error {
  constructor(readonly cause: unknown) { super("Gnumeric source read failed"); }
}
function limit(message: string): never { throw new SsconvertError("resource-limit", `ssconvert ${message} limit exceeded`); }
function invalid(message: string): never { throw new SsconvertError("io", `E Invalid Gnumeric XML: ${message}`); }

/** Consume retained input and gzip output in bounded chunks, optionally retaining the XML tree. */
export async function readGnumericDocument(input: Uint8Array | RangeSource, context: CapabilityContext, retainTree = true): Promise<XmlElement> {
  context.signal.throwIfAborted();
  const size = input instanceof Uint8Array ? input.length : input.size;
  if (!Number.isSafeInteger(size) || size < 0) invalid("invalid source size");
  if (size > context.limits.inputBytes) limit("input bytes");
  // The explicit array API captures mutable caller bytes; retained file input
  // instead owns only each bounded response before another read can reuse it.
  const captured = input instanceof Uint8Array ? new Uint8Array(input) : input;
  let closed = false, reader: CompressionReader | undefined, closing: Promise<void> | undefined;
  const cleanup = () => { closed = true; return closing ??= reader?.close() ?? Promise.resolve(); };
  context.own(cleanup);
  const check = () => { context.signal.throwIfAborted(); if (closed) invalid("input operation is closed"); };
  const read = captured instanceof Uint8Array ? async (position: number, count: number) => captured.subarray(position, position + count) : captured.read.bind(captured);
  const source = ownedRangeSource({ size, async read(position, count, options) {
    try { return await read(position, count, options); }
    catch (error) { throw new GnumericSourceFailure(error); }
  } }, context.signal, check, context.own);
  async function exact(position: number, count: number) {
    const bytes = new Uint8Array(count);
    for (let offset = 0; offset < count;) {
      const chunk = await source.read(position + offset, count - offset);
      bytes.set(chunk, offset); offset += chunk.length;
    }
    return bytes;
  }
  try {
    check();
    const head = await exact(0, Math.min(2, size)), gzip = head[0] === 31 && head[1] === 139;
    const maximum = Math.min(context.limits.inputBytes, context.limits.inflatedBytes ?? context.limits.inputBytes);
    if (gzip && size > (context.limits.compressedBytes ?? context.limits.inputBytes)) limit("compressed bytes");
    // Preserve early ISIZE admission; decoded counting also covers forged
    // trailers and concatenated members whose total exceeds the final ISIZE.
    if (gzip && size >= 18 && new DataView((await exact(size - 4, 4)).buffer).getUint32(0, true) > maximum) limit("decompressed bytes");
    if (!gzip && size > maximum) limit("decompressed bytes");
    async function* raw() {
      for (let position = 0; position < size;) {
        check();
        const chunk = await source.read(position, Math.min(16384, size - position));
        position += chunk.length; yield chunk;
      }
    }
    async function* plain() {
      if (!gzip) { yield* raw(); return; }
      const compression = createCompressionCodec();
      check(); reader = new compression.CodecReader(raw(), context.signal);
      let length = 0;
      try {
        for await (const chunk of compression.codec(reader, { mode: "gunzip", chunkSize: 16384, singleMember: true }, context.signal)) {
          check();
          if (chunk.length > maximum - length) limit("decompressed bytes");
          length += chunk.length; yield chunk;
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof GnumericSourceFailure || error instanceof SsconvertError) throw error;
        invalid("invalid gzip stream");
      } finally { await reader.close(); }
    }
    const xmlLimits = { retainTree, expectedEncoding: "UTF-8" as "UTF-8" | "UTF-16LE" | "UTF-16BE", maxDepth: context.limits.xmlDepth ?? Infinity,
      maxNodes: context.limits.workbookNodes ?? Infinity, maxAttributes: context.limits.workbookNodes ?? Infinity,
      maxTextLength: context.limits.workbookTextBytes ?? context.limits.inputBytes };
    async function* text() {
      const prefix = new Uint8Array(1024); let length = 0;
      let decode: ((bytes: Uint8Array) => string) | undefined, decoder: TextDecoder | undefined;
      function initialize() {
        if (prefix[0] === 255 && prefix[1] === 254 || prefix[0] === 60 && prefix[1] === 0) xmlLimits.expectedEncoding = "UTF-16LE";
        if (prefix[0] === 254 && prefix[1] === 255 || prefix[0] === 0 && prefix[1] === 60) xmlLimits.expectedEncoding = "UTF-16BE";
        const header = new TextDecoder("ascii").decode(prefix.subarray(0, length));
        const encodingAt = header.startsWith("<?xml") && " \t\r\n".includes(header[5] ?? "\0") ? header.indexOf("encoding") : -1;
        let declared: string | undefined, declaredAt = -1;
        if (encodingAt >= 0) {
          let at = encodingAt + 8; while (" \t\r\n".includes(header[at] ?? "\0")) at++;
          if (header[at++] !== "=") invalid("malformed encoding declaration");
          while (" \t\r\n".includes(header[at] ?? "\0")) at++;
          const quote = header[at++]; if (quote !== "'" && quote !== '"') invalid("malformed encoding declaration");
          const end = header.indexOf(quote, at); if (end < 0) invalid("malformed encoding declaration");
          declared = header.slice(at, end); declaredAt = at;
        }
        if (xmlLimits.expectedEncoding === "UTF-8" && declared && !["utf-8", "utf8"].includes(declared.toLowerCase())) {
          const table = singleByteTables[encodingName(declared)];
          if (!table) throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: XML encoding ${declared}`);
          decode = bytes => {
            let text = "";
            for (const byte of bytes) { const character = table[byte]!; if (character === "\uffff") invalid("invalid encoded XML byte"); text += character; }
            return text;
          };
          const text = decode(prefix.subarray(0, length));
          return text.slice(0, declaredAt) + "UTF-8" + text.slice(declaredAt + declared.length);
        }
        decoder = new TextDecoder(xmlLimits.expectedEncoding, { fatal: true });
        decode = bytes => decoder!.decode(bytes, { stream: true });
        return decode(prefix.subarray(0, length));
      }
      for await (const chunk of plain()) {
        let offset = 0;
        if (!decode) {
          const count = Math.min(prefix.length - length, chunk.length);
          prefix.set(chunk.subarray(0, count), length); length += count; offset = count;
          if (length < prefix.length) continue;
          yield initialize();
        }
        if (offset < chunk.length) yield decode!(chunk.subarray(offset));
      }
      if (!decode) yield initialize();
      if (decoder) yield decoder.decode();
    }
    let work = 0;
    return await parseXmlStream(text(), xmlLimits, async units => {
      check();
      if ((work += units) >= 16384) { work = 0; await new Promise<void>(resolve => setTimeout(resolve, 0)); }
    });
  } catch (error) {
    context.signal.throwIfAborted();
    if (error instanceof GnumericSourceFailure) throw error;
    if (error instanceof SyntaxError && error.message === "Invalid XML: DTD and entity declarations are forbidden")
      throw new SsconvertError("capability-denied", "ssconvert host denies XML DTD and entity declarations");
    if (error instanceof XmlLimitError) limit("XML nodes/text");
    if (error instanceof SsconvertError) throw error;
    return invalid(error instanceof Error ? error.message : "malformed document");
  } finally { await cleanup(); }
}
