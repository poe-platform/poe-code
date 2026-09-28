import { dirname, type FileSystem } from "@poe-code/safe-fs/core";
import { createZipCodec, type ZipEntry, type ZipLimits } from "@poe-code/office-package/zip";
import { PlaywrightResourceLimitError } from "@poe-platform/safe-bash/playwright";

export interface TraceLimits {
  readonly maxBytes?: number;
  readonly maxFiles?: number;
  readonly maxArchiveBytes?: number;
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
  limits: Required<TraceLimits>;
  fs: FileSystem;
  signal: AbortSignal;
  admitInput(path: string, size: number, source: boolean): void;
}): Promise<void> {
  const { limits, signal, fs } = options;
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
    try {
      const metadata = await fs.lstat(entry.value, { signal });
      if (metadata.type !== "file") {
        if (source) return;
        throw new Error("Native trace must be a regular file");
      }
      if (!fs.openReadFile) throw new Error("Browser trace retained reads unavailable");
      file = await fs.openReadFile(entry.value, { signal });
    }
    catch (error) {
      if (source && (error as { code?: string }).code === "ENOENT") return;
      throw error;
    }
    try {
      const metadata = await file.stat({ signal });
      if (metadata.type !== "file") {
        if (source) return;
        throw new Error("Native trace must be a regular file");
      }
      options.admitInput(entry.value, metadata.size, source);
      signal.throwIfAborted();
      const bytes = new Uint8Array(metadata.size);
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const chunk = await file.read(offset, Math.min(65536, bytes.length - offset), { signal });
        if (!chunk.byteLength) throw new Error("Native trace file truncated during export");
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      await add(entry.name, bytes, new Date(metadata.mtimeMs));
    } finally { await file.close(); }
  };
  let writing = false;
  try {
    for (const entry of options.entries) await addFile(entry, false);
    if (options.calls.length) await add("trace.stacks", new TextEncoder().encode(serializeTraceStacks(options.calls)), new Date());
    if (options.includeSources) {
      const sources = new Set(options.calls.flatMap(call => call.stack?.map(frame => frame.file) ?? []));
      for (const value of sources) {
        const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", new TextEncoder().encode(value)));
        const hash = Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
        await addFile({ name: `resources/src@${hash}.txt`, value }, true);
      }
    }
    const bytes = await codec.writeZipArchive({ entries, comment: new Uint8Array() }, zipLimits, signal);
    signal.throwIfAborted();
    await fs.mkdir(dirname(options.zipFile), { recursive: true, signal });
    signal.throwIfAborted();
    writing = true;
    await fs.writeFile(options.zipFile, bytes, { signal });
    signal.throwIfAborted();
  } catch (error) {
    if (writing) await fs.rm(options.zipFile, { force: true });
    if (error instanceof Error && error.name === "CodecError" && error.message.includes("limit"))
      throw new PlaywrightResourceLimitError("Browser trace archive byte or file limit exceeded");
    throw error;
  }
}
