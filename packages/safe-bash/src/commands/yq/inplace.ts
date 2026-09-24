import { randomBytes } from "node:crypto";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { dirname, type FileStat, type FileStaging, type FileStagingEntry } from "../../contracts/index.js";
import { writeFileOutputCounted } from "../../contracts/filesystem-output.js";
import { MikeError, type NativeWork } from "./native-work.js";

export interface InPlaceTarget {
  readonly path: string;
  readonly original: FileStat;
  readonly ancestors: readonly FileStagingEntry[];
}

export async function captureInPlace(path: string, work: NativeWork): Promise<InPlaceTarget> {
  const fs = work.context.fs;
  const resolved = await work.track(fs.realpath(path, { signal: work.signal }));
  work.assertOpen();
  const capabilities = fs.capabilitiesFor ? await work.track(fs.capabilitiesFor(resolved, { signal: work.signal })) : fs.capabilities;
  work.assertOpen();
  if (!capabilities.atomicFileStaging || !capabilities.atomicStagingAncestry
    || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile) {
    throw new MikeError("in-place update requires atomic VFS staging and ancestry publication");
  }
  const ancestors: FileStagingEntry[] = [];
  for (let parent = dirname(resolved);; parent = dirname(parent)) {
    const stat = await work.track(fs.lstat(parent, { signal: work.signal }));
    work.assertOpen();
    if (stat.type !== "directory") throw new MikeError("in-place target ancestry changed");
    ancestors.unshift({ path: parent, stat });
    if (parent === "/") break;
  }
  const original = await work.track(fs.lstat(resolved, { signal: work.signal }));
  work.assertOpen();
  if (original.type !== "file" || original.nlink !== 1) throw new MikeError("in-place update requires a singly linked regular file");
  return { path: resolved, original, ancestors };
}

export async function publishInPlace(target: InPlaceTarget, data: Uint8Array, work: NativeWork): Promise<void> {
  const fs = work.context.fs;
  const directory = dirname(target.path);
  const parent = target.ancestors.at(-1)!.stat;
  let owned: FileStaging | undefined;
  const cleanup = retainFileSystemCleanup(fs, async view => {
    if (owned) await view.removeStagedFile!(owned);
  }, { maxOperations: 1 });
  const staging = await work.acquire(async () => {
    let receipt!: FileStaging;
    try {
      await writeFileOutputCounted({ signal: work.signal, preserveWriteReceipt: true, ...(work.context.registerCleanup ? { registerCleanup: work.context.registerCleanup } : {}) }, data, async () => {
        receipt = await fs.createStagedFile!(`${directory === "/" ? "" : directory}/.yq-${randomBytes(12).toString("hex")}`, "file", {
          type: "file", data,
        }, { parent, mode: target.original.mode & 0o7777, signal: work.signal });
        owned = receipt;
        return data.byteLength;
      });
    } catch (error) { await cleanup(); throw error; }
    return receipt;
  }, cleanup);
  await work.track(fs.publishStagedFile!(staging, target.path, {
    parent, destination: target.original, ancestors: target.ancestors, signal: work.signal,
  }));
  work.assertOpen();
}
