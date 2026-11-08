import { FsError, type FileReadHandle, type FileStat, type FileSystem } from "safe-bash-contracts";

import { yieldTurn } from "safe-bash-contracts/yield";
import { randomBytes } from "./platform-portable.js";

function verify(actual: FileStat, expected: FileStat): void {
 const identity = expected.opaqueIdentity !== undefined ? actual.opaqueIdentity === expected.opaqueIdentity
  : expected.dev !== undefined && expected.ino !== undefined && actual.dev === expected.dev && actual.ino === expected.ino;
 if (!identity || expected.identityScope === undefined || actual.identityScope !== expected.identityScope ||
  actual.type !== "file" || actual.size !== expected.size || actual.revision !== expected.revision ||
  actual.opaqueVersion !== expected.opaqueVersion || actual.mtimeMs !== expected.mtimeMs || actual.ctimeMs !== expected.ctimeMs)
  throw new FsError("EBUSY", { message: "Upload replay storage changed" });
}

/** Caller-owned staging only: no host temporary files or in-memory fallback. */
export async function createReplay(fs: FileSystem, directory: string, signal: AbortSignal) {
 const parent = await fs.stat(directory, { signal });
 const caps = await fs.capabilitiesFor?.(directory, { signal }) ?? fs.capabilities;
 if (!caps.retainedStagingCleanup || !caps.retainedStagingWrite || !caps.retainedRead || !fs.createStagedFile || !fs.openReadFile)
  throw new FsError("ENOTSUP", { message: "Upload replay requires retained caller storage" });
 const name = Array.from(randomBytes(18), byte => byte.toString(16).padStart(2, "0")).join("");
 const stage = await fs.createStagedFile(`${directory === "/" ? "" : directory}/.curl-replay-${name}`, "upload", { type: "file", data: new Uint8Array() }, { parent, mode: 0o600, retainCleanup: true, signal });
 const { writer, cleanup } = stage;
 if (!writer || !cleanup) {
  try { await cleanup?.remove(); } finally { await cleanup?.close(); }
  throw new FsError("EIO", { message: "Missing retained upload handles" });
 }
 let size = 0;
 let sealed: FileStat | undefined;
 let reader: FileReadHandle | undefined;
 let closing: Promise<void> | undefined;
 return {
  async write(bytes: Uint8Array) {
   for (let offset = 0; offset < bytes.length; offset += 16384) {
    const chunk = bytes.slice(offset, offset + 16384);
    await writer.write(chunk, { signal });
    size += chunk.length;
   }
  },
  async *read(replaySignal: AbortSignal) {
   replaySignal.throwIfAborted();
   sealed ??= await writer.finish({ signal: replaySignal });
   if (sealed.size !== size) throw new FsError("EIO", { message: "Incomplete upload replay storage" });
   reader ??= await fs.openReadFile!(stage.file.path, { signal: replaySignal });
   verify(await reader.stat({ signal: replaySignal }), sealed);
   let chunks = 0;
   for (let position = 0; position < size;) {
    if (++chunks % 256 === 0) await yieldTurn(replaySignal);
    replaySignal.throwIfAborted();
    verify(await reader.stat({ signal: replaySignal }), sealed);
    const count = Math.min(16384, size - position);
    const bytes = await reader.read(position, count, { signal: replaySignal });
    if (!bytes.length || bytes.length > count) throw new FsError("EIO", { message: "Invalid upload replay read" });
    verify(await reader.stat({ signal: replaySignal }), sealed);
    position += bytes.length;
    yield bytes.slice();
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
