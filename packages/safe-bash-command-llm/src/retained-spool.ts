import { FsError, type FileReadHandle, type FileStat, type FileSystem } from "safe-bash-contracts";

let serial = 0;

function verifyRetainedFile(actual: FileStat, expected: FileStat): void {
 const sameOwner = expected.identityScope !== undefined && expected.identityScope === actual.identityScope;
 const sameIdentity = expected.opaqueIdentity !== undefined
  ? expected.opaqueIdentity === actual.opaqueIdentity
  : expected.dev !== undefined && expected.ino !== undefined && expected.dev === actual.dev && expected.ino === actual.ino;
 if (!sameOwner || !sameIdentity || actual.type !== "file" || actual.size !== expected.size || actual.revision !== expected.revision || actual.opaqueVersion !== expected.opaqueVersion || actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs) throw new FsError("EBUSY", { message: "LLM spool changed" });
}

/** Retain bytes in caller-owned staging and replay bounded identity-checked reads. */
export async function createLlmSpool(fs: FileSystem, directory: string, signal: AbortSignal, purpose: "input" | "output" = "output") {
 const parent = await fs.stat(directory, { signal });
 if (parent.type !== "directory") throw new FsError("ENOTDIR", { path: directory });
 const caps = await fs.capabilitiesFor?.(directory, { signal }) ?? fs.capabilities;
 if (!caps.retainedStagingCleanup || !caps.retainedStagingWrite || !caps.retainedRead || !fs.createStagedFile || !fs.openReadFile) throw new FsError("ENOTSUP", { message: "LLM staging requires caller filesystem retained staging and reads" });
 let staging;
 for (let attempt = 0; attempt < 16; attempt++) {
  try {
   staging = await fs.createStagedFile(`${directory === "/" ? "" : directory}/.llm-${purpose}-${++serial}`, purpose, { type: "file", data: new Uint8Array(0) }, { parent, mode: 0o600, retainCleanup: true, signal });
   break;
  } catch (error) {
   signal.throwIfAborted();
   if (!(error instanceof FsError) || error.code !== "EEXIST") throw error;
  }
 }
 if (!staging) throw new FsError("EEXIST", { message: "LLM output staging names exhausted" });
 const owner = staging;
 const cleanup = owner.cleanup;
 const writer = owner.writer;
 if (!cleanup || !writer) {
  try { await cleanup?.remove(); } finally { await cleanup?.close(); }
  throw new FsError("EIO", { message: "Caller filesystem omitted its retained staging handles" });
 }
 let reader: FileReadHandle | undefined;
 let sealed: FileStat | undefined;
 let written = 0;
 let closing: Promise<void> | undefined;
 return {
  async write(bytes: Uint8Array): Promise<void> {
   signal.throwIfAborted();
   if (sealed || closing) throw new FsError("EBADF", { message: "LLM spool is closed" });
   for (let offset = 0; offset < bytes.byteLength; offset += 16384) {
    const chunk = bytes.subarray(offset, offset + 16384);
    await writer.write(chunk, { signal });
    written += chunk.byteLength;
   }
  },
  async *replay(select?: (reader: { size: number; read(position: number, maxBytes: number): Promise<Uint8Array> }) => Promise<{ start: number; end: number } | undefined>): AsyncIterable<Uint8Array> {
   signal.throwIfAborted();
   if (sealed || closing) throw new FsError("EBADF", { message: "LLM spool is closed" });
   sealed = await writer.finish({ signal });
   if (sealed.size !== written) throw new FsError("EIO", { message: "LLM spool size mismatch" });
   signal.throwIfAborted();
   if (closing) throw new FsError("EBADF", { message: "LLM spool is closed" });
   const opened = await fs.openReadFile!(owner.file.path, { signal });
   if (closing || signal.aborted) {
    await opened.close();
    signal.throwIfAborted();
    throw new FsError("EBADF", { message: "LLM spool is closed" });
   }
   reader = opened;
   verifyRetainedFile(await reader.stat({ signal }), sealed);
   const read = async (position: number, maxBytes: number): Promise<Uint8Array> => {
    signal.throwIfAborted();
    if (closing || !reader) throw new FsError("EBADF", { message: "LLM spool is closed" });
    if (!Number.isSafeInteger(position) || position < 0 || position >= written || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > 16384) throw new FsError("EINVAL", { message: "Invalid LLM spool range" });
    const count = Math.min(maxBytes, written - position);
    verifyRetainedFile(await reader.stat({ signal }), sealed!);
    const bytes = await reader.read(position, count, { signal });
    if (!bytes.byteLength || bytes.byteLength > count) throw new FsError("EIO", { message: "Invalid LLM spool read" });
    verifyRetainedFile(await reader.stat({ signal }), sealed!);
    return bytes;
   };
   const range = await select?.({ size: written, read });
   if (range && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end < range.start || range.end > written)) throw new FsError("EINVAL", { message: "Invalid LLM spool selection" });
   let position = range?.start ?? 0;
   const end = range?.end ?? written;
   while (position < end) {
    const bytes = await read(position, Math.min(16384, end - position));
    position += bytes.byteLength;
    yield bytes;
   }
  },
  close(): Promise<void> {
   closing ??= (async () => {
    try { await reader?.close(); }
    finally { try { await cleanup.remove(); } finally { await cleanup.close(); } }
   })();
   return closing;
  },
 };
}
