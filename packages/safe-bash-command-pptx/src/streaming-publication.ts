import { FsError, type ByteSource, type CommandContext, type FileStat } from "safe-bash-contracts";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output";
import { sameRetainedIdentity } from "./streaming-inputs.js";

/** Publish only after all source bytes have reached an owned retained staging file. */
export async function publishPptxSource(context: CommandContext, path: string, source: ByteSource,
  expected: FileStat | null, parent: FileStat, verify: () => Promise<void>): Promise<void> {
  const { fs, signal } = context;
  await assertPptxStreamPublication(context, path);
  const resolution = await fs.prepareStagingResolution!(path, { signal });
  const directory = resolution.path.slice(0, resolution.path.lastIndexOf("/")) || "/";
  const current = resolution.destination;
  if ((expected === null) !== (current === null)) throw new FsError("EAGAIN");
  if (expected && current && (expected.revision !== current.revision || expected.opaqueVersion !== current.opaqueVersion
    || expected.type !== current.type || expected.size !== current.size || expected.mode !== current.mode
    || expected.nlink !== current.nlink || expected.mtimeMs !== current.mtimeMs || expected.ctimeMs !== current.ctimeMs
    || !sameRetainedIdentity(expected, current))) throw new FsError("EAGAIN");
  if (!sameRetainedIdentity(parent, resolution.parent)) throw new FsError("EAGAIN");
  const staging = await fs.createStagedFile!(`${directory}/.pptx-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
    { parent: resolution.parent, retainCleanup: true, ...(expected ? { mode: expected.mode & 0o7777 } : {}), signal });
  let failure: { error: unknown } | undefined;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP");
    for await (const chunk of source) {
      signal.throwIfAborted();
      if (!(chunk instanceof Uint8Array)) throw new FsError("EIO");
      for (let offset = 0; offset < chunk.length; offset += 16384) {
        const owned = new Uint8Array(chunk.subarray(offset, offset + 16384));
        await writeFileOutput(context, owned, bytes => staging.writer!.write(bytes, { signal }));
      }
    }
    signal.throwIfAborted();
    const stat = await staging.writer.finish({ signal });
    await verify();
    await fs.publishStagedFile!({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: expected, ancestors: resolution.ancestors, commitGuard: resolution.validate, signal });
  } catch (error) { failure = { error }; }
  try { await staging.cleanup?.remove(); } catch (error) { failure ??= { error }; }
  try { await staging.cleanup?.close(); } catch (error) { failure ??= { error }; }
  if (failure) throw failure.error;
}

/** Validate staging support without creating output or consuming its source. */
export async function assertPptxStreamPublication(context: CommandContext, path: string): Promise<void> {
  const { fs, signal } = context;
  signal.throwIfAborted();
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup
    || !capabilities.atomicStagingAncestry || !capabilities.guardedStagingPublication
    || !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile) throw new FsError("ENOTSUP");
  signal.throwIfAborted();
}
