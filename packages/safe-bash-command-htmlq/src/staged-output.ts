import { normalizePath } from "@poe-code/safe-fs/core";
import type { FileStaging, FileSystem } from "safe-bash-contracts/filesystem";
import type { ByteSource } from "safe-bash-contracts/io";
import { HtmlError } from "./contracts.js";

/** The retained writer owns unpublished bytes. No output-sized client spool is
 * needed, and publication checks the destination and traversed ancestry again. */
export async function publishStagedHtmlq(
  fs: FileSystem, path: string, source: ByteSource, signal: AbortSignal
): Promise<void> {
  const target = await fs.prepareStagingResolution!(normalizePath(path), { signal });
  target.validate();
  if (target.destination && target.destination.type !== "file")
    throw new HtmlError("E_UNSUPPORTED", "Output must be a regular VFS file");
  let stage: FileStaging | undefined;
  let failure: { error: unknown } | undefined;
  try {
    const parentPath = target.path.slice(0, target.path.lastIndexOf("/"));
    stage = await fs.createStagedFile!(
      `${parentPath}/.htmlq-${crypto.randomUUID()}`, "output",
      { type: "file", data: new Uint8Array() },
      { parent: target.parent, retainCleanup: true, signal,
        mode: target.destination ? target.destination.mode & 0o7777 : 0o666 }
    );
    if (!stage.writer || !stage.cleanup)
      throw new HtmlError("E_UNSUPPORTED", "Output requires retained staging handles");
    signal.throwIfAborted();
    for await (const bytes of source) {
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        signal.throwIfAborted();
        await stage.writer.write(bytes.slice(offset, offset + 16384), { signal });
      }
    }
    const stat = await stage.writer.finish({ signal });
    signal.throwIfAborted();
    target.validate();
    await fs.publishStagedFile!({ ...stage, file: { ...stage.file, stat } }, target.path, {
      parent: target.parent, destination: target.destination, ancestors: target.ancestors,
      commitGuard: target.validate, preserveIdentity: target.destination !== null, signal
    });
  } catch (error) { failure = { error }; }
  const cleanupErrors: unknown[] = [];
  if (stage?.cleanup) {
    try { await stage.cleanup.remove(); } catch (error) { cleanupErrors.push(error); }
    try { await stage.cleanup.close(); } catch (error) { cleanupErrors.push(error); }
  } else if (stage) {
    try { await fs.removeStagedFile!(stage); } catch (error) { cleanupErrors.push(error); }
  }
  if (cleanupErrors.length) {
    if (failure) cleanupErrors.unshift(failure.error);
    throw new AggregateError(cleanupErrors, "htmlq staged output cleanup failed");
  }
  if (failure) throw failure.error;
}
