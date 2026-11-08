import {PandocError} from "./errors.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {createZipCodec, ZipDirectoryIndex, type ZipLimits, type ZipSource, type ZipEntry, type ZipStreamEntry} from "@poe-code/office-package/zip";
import {createCompressionCodec} from "@poe-code/compression";
import {epubFailure} from "./epub-xml.js";
import type {AdapterContext, Input, StreamingInput} from "./types.js";

/** Validate every ZIP member and retain replayable member sources in the caller
 * store. The buffered reader and retained book reader share this admission. */
export async function openEpubArchive(input: Input | StreamingInput, ctx: AdapterContext) {
    const fail: (part: string, message: string) => never = (part, message) => epubFailure(ctx, part, message);
    const signal = ctx.signal ?? new AbortController().signal;
    const limits: ZipLimits = {maxArchiveBytes: ctx.limits.compressedBytes, maxEntryBytes: ctx.limits.expandedBytes, maxTotalBytes: ctx.limits.expandedBytes, maxMembers: ctx.limits.parts, maxPathBytes: ctx.limits.text, maxDepth: ctx.limits.depth, maxPaxBytes: ctx.limits.binaryBytes, maxTextBytes: ctx.limits.text, chunkSize: 4096};
    const codec = createZipCodec({compression: createCompressionCodec(), yieldTurn: async () => ctx.cooperate(1), fail: message => {
      return epubFailure(ctx, input.source ?? "archive", message, message.includes("limit") ? "E_LIMIT" : "E_PARSE");
    }}, {rejectDuplicateNames: true});
    const working = ctx.workingFiles;
    const cacheBytes = working?.cacheBytes ?? 1024 * 1024;
    if (working && (!Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384 !== 0 || !working.directory.startsWith("/")))
      {throw new PandocError("E_OPTION", ctx.operation ?? "read", "Invalid working storage configuration");}
    const storage = working ? new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal}, cacheBytes / 16384) : undefined;
    const release = storage && ctx.onClose?.(() => storage.close());
    const close = async () => {try {await storage?.close();} finally {release?.();}};
    try {
    let source: ZipSource | undefined;
    if (storage) {
      ctx.charge("retainedBytes", cacheBytes);
      const position = storage.allocate(0);
      let size = 0;
      const chunks = "chunks" in input ? input.chunks : [input.bytes];
      let iterator: AsyncIterator<Uint8Array> | Iterator<Uint8Array> | undefined;
      let done = false;
      const cleanup = async () => {if (!done) {done = true; await iterator?.return?.();}};
      // A host factory may cancel while creating the producer. Enroll cleanup
      // first so the returned iterator is owned even if the next checkpoint fails.
      const unregister = ctx.onClose?.(cleanup);
      let inputFailure: {reason: unknown} | undefined;
      try {
      iterator = Symbol.asyncIterator in chunks ? chunks[Symbol.asyncIterator]() : chunks[Symbol.iterator]();
      while (!done) {
        ctx.checkpoint();
        const next = await iterator.next();
        if (next.done) {done = true; break;}
        const bytes = next.value;
        if (!(bytes instanceof Uint8Array)) throw new PandocError("E_IO", ctx.operation ?? "read", "Producer must yield bytes");
        ctx.checkpoint();
        if ("chunks" in input) {ctx.charge("inputBytes", bytes.length); ctx.charge("compressedBytes", bytes.length);}
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          await storage.append(bytes.subarray(offset, offset + 4096));
          await ctx.cooperate();
        }
        size += bytes.length;
      }
      } catch (reason) {inputFailure = {reason}; throw reason;}
      finally {try {await cleanup().catch(reason => {if (!inputFailure) throw reason;});} finally {unregister?.();}}
      source = {size, read: (offset, length) => storage.read(position + offset, length)};
    } else {
      if (!("bytes" in input)) return fail("archive", "Streaming EPUB requires caller working storage");
      ctx.charge("retainedBytes", input.bytes.length);
    }
    const parts = new Map<string, Uint8Array>();
    const partIndex = storage ? new ZipDirectoryIndex(storage) : undefined;
    const hasPart = async (name: string) => partIndex ? await partIndex.get(name) !== undefined : parts.has(name);
    const partRecord = async (name: string): Promise<Uint8Array | {position: number; length: number} | undefined> => {
      if (!partIndex) return parts.get(name);
      const pointer = await partIndex.get(name);
      if (pointer === undefined) return undefined;
      const record = await storage!.read(pointer, 16);
      const header = new DataView(record.buffer, record.byteOffset, 16);
      return {position: header.getFloat64(0, true), length: header.getFloat64(8, true)};
    };
    const partChunks = async function* (part: {position: number; length: number}) {
      for (let offset = 0; offset < part.length; offset += 4096) {
        yield await storage!.read(part.position + offset, Math.min(4096, part.length - offset));
        await ctx.cooperate();
      }
    };
    const getPart = async (name: string): Promise<Uint8Array | undefined> => {
      const part = await partRecord(name);
      if (part === undefined || part instanceof Uint8Array) return part;
      ctx.charge("retainedBytes", part.length);
      const bytes = new Uint8Array(part.length);
      let offset = 0;
      for await (const chunk of partChunks(part)) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      return bytes;
    };
    // Validate every member, including unused resources, before reading the book.
    const processEntry = async (entry: ZipEntry | ZipStreamEntry) => {
      ctx.charge("parts", 1);
      if (entry.symlink || entry.name.includes("\\") || entry.name.includes(":")) fail(entry.name, "Unsafe EPUB ZIP member");
      const chunks: Uint8Array[] = [];
      const position = storage?.allocate(0);
      let length = 0;
      for await (const chunk of codec.decodeZipEntry(entry, limits, signal)) {
        ctx.charge("expandedBytes", chunk.length, !storage);
        length += chunk.length;
        if (storage) await storage.append(chunk);
        else chunks.push(chunk);
      }
      if (entry.directory) return;
      if (storage) {
        const record = new DataView(new ArrayBuffer(16));
        record.setFloat64(0, position!, true); record.setFloat64(8, length, true);
        const pointer = await storage.append(new Uint8Array(record.buffer));
        await partIndex!.set(entry.name, pointer);
      }
      else {
        ctx.charge("retainedBytes", length);
        const bytes = new Uint8Array(length);
        let offset = 0;
        for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.length;}
        parts.set(entry.name, bytes);
      }
    };
    if (storage) await codec.readZipArchive(source!, limits, signal, {storage, onEntry: processEntry});
    else {
      const archive = await codec.readZipArchive((input as Input).bytes, limits, signal);
      for (const entry of archive.entries) await processEntry(entry);
    }
    const mime = await partRecord("mimetype"), expectedMime = "application/epub+zip";
    // The only accepted UTF-8 spellings are the ASCII value and that value
    // preceded by a BOM (which TextDecoder historically ignored). Probe at most
    // 23 bytes; an invalid large member must not become a resident byte/string copy.
    if (mime && !(mime instanceof Uint8Array)) ctx.charge("retainedBytes", mime.length);
    const mimeLength = mime?.length ?? 0;
    if (!mime || mimeLength !== expectedMime.length && mimeLength !== expectedMime.length + 3
      || new TextDecoder().decode(mime instanceof Uint8Array ? mime : await storage!.read(mime.position, mime.length)) !== expectedMime)
      fail("mimetype", "Invalid or missing EPUB mimetype");
    if (await hasPart("META-INF/encryption.xml")) fail("META-INF/encryption.xml", "Unsupported EPUB encryption/DRM or font obfuscation");
    return {storage, hasPart, getPart, partRecord, partChunks, close};
    } catch (reason) {await close().catch(() => {}); throw reason;}
}
