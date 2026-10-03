import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { FileSystem } from "@poe-code/safe-fs/core";
import { createStoredZipEntries, ZipStorageFailure, type ZipEntryStorage } from "@poe-code/office-package";
import { createZipCodec, ZipDirectoryIndex, type ZipSource, type ZipStreamEntry } from "@poe-code/office-package/zip";
import type { ByteSink, ByteSource } from "./contracts.js";
import { OfficeError } from "./errors.js";
import { asciiKey, partName } from "./package-uri.js";
import { resourceContext, type ResourceContext } from "./resource-limits.js";

export interface PackageWorkingStorage {
  /** Explicit caller-authorized backing filesystem and directory. */
  readonly fs: FileSystem;
  readonly directory: string;
  /** Resident page budget; a positive multiple of 16 KiB, default 1 MiB. */
  readonly cacheBytes?: number;
}

export interface RetainedPackageContext extends ResourceContext {
  readonly workingStorage: PackageWorkingStorage;
}

export interface PackageRewriteOptions {
  readonly compression?: "store" | "auto";
  /** Undefined retains compressed bytes and ZIP metadata; null removes a part.
   * Replacement sources are borrowed until rewrite settles. */
  readonly replace?: (part: string, original: ByteSource) => Promise<ByteSource | null | undefined>;
  readonly additions?: AsyncIterable<{ readonly part: string; readonly source: ByteSource }>;
}

export interface RetainedPackageArchive {
  readonly entryCount: number;
  parts(): AsyncIterable<string>;
  has(part: string): Promise<boolean>;
  byteLength(part: string): Promise<number>;
  read(part: string): ByteSource;
  /** Stages the complete archive in caller storage before writing the sink.
   * The caller controls publication and owns the sink's lifetime. */
  rewrite(sink: ByteSink, options?: PackageRewriteOptions): Promise<void>;
  /** Retires scratch storage; the retained input remains caller-owned. */
  close(): Promise<void>;
}

/** Admit the whole archive without retaining its payloads or member collection.
 * Input must address one stable caller-retained object until close. In-memory
 * filesystems retain spill bytes in RAM: use an external backend for large data. */
export async function openPackageArchive(input: ZipSource, settings: RetainedPackageContext): Promise<RetainedPackageArchive> {
  const context = resourceContext(settings);
  const working = settings.workingStorage;
  const cacheBytes = working?.cacheBytes ?? 1024 * 1024;
  if (!working?.fs || typeof working.directory !== "string" || !working.directory.startsWith("/")
    || !Number.isSafeInteger(cacheBytes) || cacheBytes < 16384 || cacheBytes % 16384)
    throw new OfficeError("invalid-value", "Explicit package working storage and a valid cache budget are required.", "usage");
  if (!input || typeof input.read !== "function") throw new OfficeError("invalid-type", "A retained package source is required.", "usage");
  const controller = new AbortController();
  const signal = context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal;
  const limits = { ...context.archiveLimits, maxArchiveBytes: Math.min(context.limits.maxBytes, context.archiveLimits.maxArchiveBytes) };
  const pages = new PagedStorage({ fs: working.fs, cwd: working.directory, env: {}, signal }, cacheBytes / 16384);
  let closed = false, closing: Promise<void> | undefined;
  let sourcePending: Promise<unknown> = Promise.resolve();
  const check = () => {
    if (closed) throw new OfficeError("invalid-handle", "Package archive is closed.", "admit");
    signal.throwIfAborted();
  };
  const failure = (error: unknown): unknown => {
    if (error instanceof OfficeError && error.code === "invalid-handle") return error;
    if (signal.aborted) return new OfficeError("cancelled", "Operation cancelled.", "parse");
    if (error instanceof OfficeError) return error;
    let cause = error;
    while (cause instanceof ZipStorageFailure) cause = cause.cause;
    const code = cause && typeof cause === "object" && "code" in cause ? cause.code : undefined;
    if (code === "resource-limit" || code === "EFBIG") return new OfficeError("resource-limit", "Package byte limit exceeded.", "parse");
    return new OfficeError(error instanceof ZipStorageFailure ? "io-failure" : "invalid-archive",
      error instanceof ZipStorageFailure ? "Package storage operation failed." : "Invalid package archive.", "parse");
  };
  const storage: ZipEntryStorage = {
    allocate(length) { check(); try { return pages.allocate(length); } catch (error) { throw new ZipStorageFailure(error); } },
    async read(position, length) { check(); try { return await pages.read(position, length); } catch (error) { throw new ZipStorageFailure(error); } },
    async write(position, bytes) { check(); try { await pages.write(position, bytes); } catch (error) { throw new ZipStorageFailure(error); } },
    close: () => pages.close()
  };
  const source: ZipSource = { size: input.size, read(position, maximum, options) {
    // Serial ownership transfer protects codecs from a backend that reuses its
    // response buffer, including when independent member streams interleave.
    const pending = sourcePending.then(async () => {
      check(); options.signal.throwIfAborted();
      try {
        const size = Math.min(maximum, 16384);
        const bytes = await input.read(position, size, options);
        check(); options.signal.throwIfAborted();
        if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > size) throw new Error("Invalid retained range response");
        return new Uint8Array(bytes);
      } catch (error) { throw new ZipStorageFailure(error); }
    });
    sourcePending = pending.then(() => undefined, () => undefined);
    return pending;
  } };
  const close = (): Promise<void> => {
    closed = true;
    controller.abort();
    return closing ??= sourcePending.then(() => pages.close());
  };
  const codec = createZipCodec(undefined, { zip64: true, rejectDuplicateNames: true, utcDates: true });
  const entries = createStoredZipEntries(() => storage, source);
  const names = new ZipDirectoryIndex(storage, { signal });
  const parents = new ZipDirectoryIndex(storage, { signal });
  const text = new TextEncoder(), decoder = new TextDecoder("utf-8", { fatal: true });
  let first = 0, last = 0, count = 0;
  async function storeText(position: number, bytes: Uint8Array): Promise<void> {
    for (let offset = 0; offset < bytes.length; offset += 16384) await storage.write(position + offset, bytes.subarray(offset, offset + 16384));
  }
  async function readText(position: number, length: number): Promise<string> {
    // ZIP names have a format-level 65535-byte bound. This is one name, never
    // a package member or a collection of names.
    if (!Number.isSafeInteger(length) || length < 0 || length > 4 * 65535) throw new ZipStorageFailure(new Error("Invalid package name record"));
    const bytes = new Uint8Array(length);
    for (let offset = 0; offset < length; offset += 16384) {
      const size = Math.min(16384, length - offset);
      const chunk = await storage.read(position + offset, size);
      if (chunk.length !== size) throw new ZipStorageFailure(new Error("Truncated package name"));
      bytes.set(chunk, offset);
    }
    return decoder.decode(bytes);
  }
  async function record(position: number) {
    const bytes = new Uint8Array(await storage.read(position, 24));
    if (bytes.length !== 24) throw new ZipStorageFailure(new Error("Truncated package record"));
    const header = new DataView(bytes.buffer);
    return { next: header.getFloat64(0, true), partLength: header.getFloat64(8, true), nameLength: header.getFloat64(16, true) };
  }
  async function admit(entry: ZipStreamEntry): Promise<void> {
    if (entry.symlink) throw new OfficeError("unsafe-path", "Invalid package part name.", "index");
    const part = partName(entry.directory && entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name, true);
    const key = asciiKey(part);
    if (await names.get(key) !== undefined || !entry.directory && await parents.get(key) !== undefined)
      throw new OfficeError("invalid-opc", "Colliding package part names.", "index");
    let parent = key.slice(0, key.lastIndexOf("/"));
    while (parent) {
      if (await names.get(parent) !== undefined) throw new OfficeError("invalid-opc", "Colliding package part names.", "index");
      await parents.set(parent, 1);
      parent = parent.slice(0, parent.lastIndexOf("/"));
    }
    // Complete CRC/decompression admission precedes exposing any member.
    for await (const bytes of codec.decodeZipEntry(entry, limits, signal)) { check(); void bytes; }
    if (entry.directory) { await parents.set(key, 1); return; }
    const partBytes = text.encode(part), nameBytes = text.encode(entry.name);
    const position = storage.allocate(24 + partBytes.length + nameBytes.length);
    const header = new Uint8Array(24), view = new DataView(header.buffer);
    view.setFloat64(8, partBytes.length, true); view.setFloat64(16, nameBytes.length, true);
    await storage.write(position, header);
    await storeText(position + 24, partBytes);
    await storeText(position + 24 + partBytes.length, nameBytes);
    if (last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await storage.write(last, link); }
    else first = position;
    last = position; count++;
    await names.set(key, position);
    await entries.set(entry);
  }
  async function lookup(part: string): Promise<ZipStreamEntry> {
    check();
    const position = await names.get(asciiKey(partName(part, false)));
    if (position === undefined) throw new OfficeError("missing-binding", "Package member is absent.", "index");
    const header = await record(position);
    const name = await readText(position + 24 + header.partLength, header.nameLength);
    const entry = await entries.get(name);
    if (!entry) throw new ZipStorageFailure(new Error("Missing package record"));
    return entry;
  }
  try {
    check();
    const summary = await codec.readZipArchive(source, limits, signal, { storage, onEntry: admit });
    check();
    const archive: RetainedPackageArchive = {
      entryCount: summary.members,
      close,
      async *parts() {
        try {
          check(); let position = first;
          for (let index = 0; index < count; index++) {
            if (!Number.isSafeInteger(position) || position < 1) throw new ZipStorageFailure(new Error("Invalid package record"));
            const header = await record(position);
            yield await readText(position + 24, header.partLength);
            position = header.next;
          }
          if (position) throw new ZipStorageFailure(new Error("Invalid package record chain"));
          check();
        } catch (error) { throw failure(error); }
      },
      async has(part) {
        try { check(); return await names.get(asciiKey(partName(part, false))) !== undefined; }
        catch (error) { throw failure(error); }
      },
      async byteLength(part) {
        try { return (await lookup(part)).size; }
        catch (error) { throw failure(error); }
      },
      async *read(part) {
        try { yield* codec.decodeZipEntry(await lookup(part), limits, signal); }
        catch (error) { throw failure(error); }
      },
      async rewrite(sink, options = {}) {
        try {
          check();
          const compression = options.compression ?? "auto";
          if (!sink || typeof sink.write !== "function" || !["auto", "store"].includes(compression))
            throw new OfficeError("invalid-value", "A package sink and valid compression policy are required.", "usage");
          const writer = codec.createStagedWriter(storage, limits, signal);
          const outputNames = new ZipDirectoryIndex(storage, { signal });
          const outputParents = new ZipDirectoryIndex(storage, { signal });
          const reserve = async (part: string, directory = false) => {
            const key = asciiKey(part);
            if (await outputNames.get(key) !== undefined || !directory && await outputParents.get(key) !== undefined)
              throw new OfficeError("invalid-opc", "Colliding output package parts.", "serialize");
            let parent = key.slice(0, key.lastIndexOf("/"));
            while (parent) {
              if (await outputNames.get(parent) !== undefined) throw new OfficeError("invalid-opc", "Colliding output package parts.", "serialize");
              await outputParents.set(parent, 1); parent = parent.slice(0, parent.lastIndexOf("/"));
            }
            if (directory) await outputParents.set(key, 1);
            else await outputNames.set(key, 1);
          };
          await codec.readZipArchive(source, limits, signal, { storage, async onEntry(entry) {
            check();
            const part = partName(entry.directory && entry.name.endsWith("/") ? entry.name.slice(0, -1) : entry.name, true);
            if (entry.directory) { await reserve(part, true); await writer.add(entry); return; }
            const replacement = await options.replace?.(part, codec.decodeZipEntry(entry, limits, signal));
            check();
            if (replacement === null) return;
            await reserve(part);
            if (replacement === undefined) await writer.add(entry);
            else await writer.addSource(entry.name, replacement, { modified: new Date(Date.UTC(1980, 0, 1)), mode: 0o100644, directory: false, symlink: false, compression });
          } });
          if (options.additions) for await (const item of options.additions) {
            check(); const part = partName(item.part, false);
            if (part !== item.part) throw new OfficeError("unsafe-path", "A canonical package part is required.", "serialize");
            await reserve(part);
            const name = [...part.slice(1)].map(character => character.codePointAt(0)! > 127 ? encodeURIComponent(character) : character).join("");
            await writer.addSource(name, item.source, { modified: new Date(Date.UTC(1980, 0, 1)), mode: 0o100644, directory: false, symlink: false, compression });
          }
          for await (const chunk of writer.finish(new Uint8Array(summary.comment))) {
            check();
            try { await sink.write(chunk, signal); } catch (error) { throw new ZipStorageFailure(error); }
            check();
          }
        } catch (error) { throw failure(error); }
      }
    };
    return Object.freeze(archive);
  } catch (error) {
    const primary = failure(error);
    await close().catch(() => {});
    throw primary;
  }
}
