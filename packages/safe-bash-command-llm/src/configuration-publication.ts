import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { FsError, toByteSource, type FileStaging, type FileStagingEntry, type FileStat, type FileSystem } from "safe-bash-contracts";

let stagingSerial = 0;

export async function publishConfiguration(
  fs: FileSystem, directory: string, path: string, bytes: Uint8Array,
  parent: FileStat, expected: FileStat | null, signal: AbortSignal,
): Promise<void> {
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: expected === null }) ?? fs.capabilities;
  if (capabilities.atomicFilePublication === true && fs.publishFileConditional) {
    await fs.publishFileConditional(path, toByteSource(bytes), { parent, expected, mode: 0o600, signal, maxBytes: bytes.byteLength });
    return;
  }
  if ((capabilities.atomicFileMutation === true || capabilities.trustedOwnedStaging === true) && fs.writeFileConditional) {
    await fs.writeFileConditional(path, bytes, { parent, expected, mode: 0o600, signal });
    return;
  }
  if (capabilities.atomicFileStaging !== true || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile) {
    throw new FsError("ENOTSUP", { path, message: "LLM configuration requires atomic conditional publication" });
  }
  const ancestors: FileStagingEntry[] = [];
  let current = "/";
  for (const component of ["", ...directory.split("/").filter(Boolean)]) {
    if (component) current = `${current === "/" ? "" : current}/${component}`;
    const stat = await fs.lstat(current, { signal });
    if (stat.type !== "directory") throw new FsError("ENOTDIR", { path: current });
    ancestors.push({ path: current, stat });
  }
  let staging: FileStaging | undefined;
  const cleanup = retainFileSystemCleanup(fs, async view => {
    if (staging) await view.removeStagedFile!(staging);
  }, { maxOperations: 1 });
  try {
    for (let attempt = 0; attempt < 16; attempt++) {
      try {
        staging = await fs.createStagedFile(`${directory}/.llm-config-${++stagingSerial}`, "entry", { type: "file", data: bytes }, { parent, mode: 0o600, signal });
        break;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof FsError) || error.code !== "EEXIST") throw error;
      }
    }
    if (!staging) throw new FsError("EEXIST", { path: directory, message: "LLM configuration staging names exhausted" });
    await fs.publishStagedFile(staging, path, { parent, destination: expected, ancestors, signal });
  } finally { await cleanup(); }
}
