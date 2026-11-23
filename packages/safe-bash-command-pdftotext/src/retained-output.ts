import type { CommandContext } from "safe-bash-contracts/command";
import { FsError, isFsError } from "safe-bash-contracts/errors";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
export async function publishPdfOutput(context: CommandContext, path: string, source: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  const fs = context.fs;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup
    || !fs.createStagedFile || !fs.publishStagedFile) {
    throw new FsError("ENOTSUP", { path, message: "PDF text output requires retained atomic staging" });
  }
  // Remote providers can atomically compare parent and destination receipts,
  // even though they cannot execute a synchronous JavaScript commit callback.
  const resolution = capabilities.atomicStagingAncestry && fs.prepareStagingResolution
    ? await fs.prepareStagingResolution(path, { signal })
    : await (async () => {
      if (!fs.realpath) throw new FsError("ENOTSUP", { path });
      const parentPath = await fs.realpath(resolvePath(path, ".."), { signal });
      const target = resolvePath(parentPath, path.slice(path.lastIndexOf("/") + 1));
      const parent = await fs.stat(parentPath, { signal });
      let destination = null;
      try { destination = await fs.lstat(target, { signal }); }
      catch (error) { if (!isFsError(error, "ENOENT")) throw error; }
      if (destination && destination.type !== "file") throw new FsError("EINVAL", { path });
      return { path: target, parent, destination, ancestors: undefined, validate: undefined };
    })();
  const directory = resolvePath(resolution.path, "..");
  const staging = await fs.createStagedFile(`${directory}/.pdf-text-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
    { parent: resolution.parent, retainCleanup: true, signal });
  let failed = false;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "PDF backend omitted retained staging handles" });
    for await (const bytes of source) {
      await writeFileOutput({ ...context, signal }, bytes, data => staging.writer!.write(data, { signal }));
    }
    const stat = await staging.writer.finish({ signal });
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: resolution.destination, ...(resolution.ancestors && resolution.validate ? { ancestors: resolution.ancestors, commitGuard: resolution.validate } : {}), signal });
  } catch (error) { failed = true; throw error; }
  finally {
    const cleanup = async () => { try { await staging.cleanup?.remove(); } finally { await staging.cleanup?.close(); } };
    await cleanup().catch(error => { if (!failed) throw error; });
  }
}

