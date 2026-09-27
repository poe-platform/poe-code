import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { mkdir, open, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createZipCodec, type ZipEntry, type ZipLimits } from "@poe-code/office-package/zip";
import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";

export interface TraceLimits {
  readonly maxBytes: number;
  readonly maxFiles: number;
  readonly maxArchiveBytes: number;
}
export interface TraceCallData {
  id: number;
  stack?: { file: string; line?: number; column?: number; function?: string }[];
}
export interface TraceArchiveEntry { name: string; value: string }

/** The trace viewer's version-8 client stack format, from the pinned provider. */
export function serializeTraceStacks(calls: readonly TraceCallData[]): string {
  const files = new Map<string, number>();
  const stacks: [number, [number, number, number, string][]][] = [];
  for (const call of calls) {
    if (!call.stack?.length) continue;
    const frames: [number, number, number, string][] = [];
    for (const frame of call.stack) {
      let index = files.get(frame.file);
      if (index === undefined) { index = files.size; files.set(frame.file, index); }
      frames.push([index, frame.line || 0, frame.column || 0, frame.function || ""]);
    }
    stacks.push([call.id, frames]);
  }
  return JSON.stringify({ files: [...files.keys()], stacks });
}

/** Input files and client stacks have already been admitted by their recording.
 * Compression admits each output chunk before retention. The codec then admits
 * the complete ZIP, including its directory, before allocating that output. */
export async function writeTraceArchive(options: {
  entries: readonly TraceArchiveEntry[];
  zipFile: string;
  calls: readonly TraceCallData[];
  includeSources: boolean;
  limits: TraceLimits;
  signal: AbortSignal;
  admitInput(path: string, size: number, source: boolean): void;
}): Promise<void> {
  const { limits, signal } = options;
  const codec = createZipCodec();
  const zipLimits: ZipLimits = {
    maxArchiveBytes: limits.maxArchiveBytes, maxEntryBytes: limits.maxBytes,
    maxTotalBytes: limits.maxBytes, maxMembers: limits.maxFiles,
    maxPathBytes: 65535, maxDepth: 32, maxPaxBytes: 65535, maxTextBytes: 65535,
    chunkSize: 65536,
  };
  const entries: ZipEntry[] = [];
  let compressed = 0;
  const add = async (name: string, bytes: Uint8Array, modified: Date) => {
    signal.throwIfAborted();
    if (entries.length >= limits.maxFiles) throw new PlaywrightResourceLimitError("Browser trace file limit exceeded");
    const entry = await codec.makeZipEntry(name, bytes, {
      modified, mode: 0o100644, directory: false, symlink: false, compression: "deflate",
    }, { ...zipLimits, maxArchiveBytes: limits.maxArchiveBytes - compressed }, signal);
    compressed += entry.data.byteLength;
    entries.push(entry);
  };
  const addFile = async (entry: TraceArchiveEntry, source: boolean) => {
    signal.throwIfAborted();
    let file;
    try { file = await open(entry.value, "r"); }
    catch (error) {
      if (source && (error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    try {
      const metadata = await file.stat();
      if (!metadata.isFile()) {
        if (source) return;
        throw new Error("Native trace must be a regular file");
      }
      options.admitInput(entry.value, metadata.size, source);
      signal.throwIfAborted();
      const bytes = new Uint8Array(metadata.size);
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const { bytesRead } = await file.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
        if (!bytesRead) throw new Error("Native trace file truncated during export");
        offset += bytesRead;
      }
      await add(entry.name, bytes, metadata.mtime);
    } finally { await file.close(); }
  };
  let writing = false;
  try {
    for (const entry of options.entries) await addFile(entry, false);
    if (options.calls.length) await add("trace.stacks", Buffer.from(serializeTraceStacks(options.calls)), new Date());
    if (options.includeSources) {
      const sources = new Set(options.calls.flatMap(call => call.stack?.map(frame => frame.file) ?? []));
      for (const value of sources) await addFile({ name: `resources/src@${createHash("sha1").update(value).digest("hex")}.txt`, value }, true);
    }
    const bytes = await codec.writeZipArchive({ entries, comment: new Uint8Array() }, zipLimits, signal);
    signal.throwIfAborted();
    await mkdir(dirname(options.zipFile), { recursive: true });
    signal.throwIfAborted();
    writing = true;
    await writeFile(options.zipFile, bytes);
    signal.throwIfAborted();
  } catch (error) {
    if (writing) await rm(options.zipFile, { force: true });
    if (error instanceof Error && error.name === "CodecError" && error.message.includes("limit"))
      throw new PlaywrightResourceLimitError("Browser trace archive byte or file limit exceeded");
    throw error;
  }
}
