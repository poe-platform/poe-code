import { PagedStorage } from "@poe-code/safe-fs/storage";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { dirname } from "@poe-code/safe-fs/core";
import { type ByteSource, type FileStat, type FileStaging, type FileStagingEntry } from "safe-bash-contracts";
import { writeFileOutputCounted } from "safe-bash-contracts/filesystem-output-budget";
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
  if (!capabilities.atomicFileStaging || !capabilities.atomicStagingAncestry || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup
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

/** Store accumulated results in caller backing, keeping UTF-8 writes bounded. */
export class InPlaceOutput {
  private readonly storage: PagedStorage;
  private readonly start: number;
  private size = 0;
  constructor(private readonly work: NativeWork) {
    this.storage = new PagedStorage({ ...work.context, signal: work.signal }, 4);
    this.start = this.storage.allocate(0);
    work.register(() => this.storage.close());
  }
  async append(text: string): Promise<void> {
    const encoder = new TextEncoder();
    for (let offset = 0; offset < text.length;) {
      this.work.assertOpen();
      let end = Math.min(text.length, offset + 4096);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(text.slice(offset, end));
      await this.work.track(this.storage.append(bytes)); this.size += bytes.length; offset = end;
      const checkpoint = this.work.tick(); if (checkpoint) await checkpoint;
    }
  }
  async *bytes(): AsyncGenerator<Uint8Array> {
    for (let offset = 0; offset < this.size; offset += 16384) {
      this.work.assertOpen();
      yield await this.work.track(this.storage.read(this.start + offset, Math.min(16384, this.size - offset)));
    }
  }
}

export async function publishInPlace(target: InPlaceTarget, data: Uint8Array | ByteSource, work: NativeWork): Promise<void> {
  const fs = work.context.fs, directory = dirname(target.path), parent = target.ancestors.at(-1)!.stat;
  let owned: FileStaging | undefined;
  const fallbackCleanup = retainFileSystemCleanup(fs, async view => {
    if (owned) await view.removeStagedFile!(owned);
  }, { maxOperations: 1 });
  const staging = await work.acquire(async () => {
    const token = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, "0")).join("");
    owned = await fs.createStagedFile!(`${directory === "/" ? "" : directory}/.yq-${token}`, "file", {
      type: "file", data: new Uint8Array(),
    }, { parent, mode: target.original.mode & 0o7777, retainCleanup: true, signal: work.signal });
    return owned;
  }, async receipt => {
    if (!receipt.cleanup) { await fallbackCleanup(); return; }
    let failure: { error: unknown } | undefined;
    try { await receipt.cleanup.remove(); } catch (error) { failure = { error }; }
    try { await receipt.cleanup.close(); } catch (error) { failure ??= { error }; }
    if (failure) throw failure.error;
  });
  if (!staging.writer || !staging.cleanup) throw new MikeError("in-place update requires retained VFS staging handles");
  const source = data instanceof Uint8Array ? (async function* () { yield data; })() : data;
  for await (const chunk of source) for (let offset = 0; offset < chunk.length; offset += 16384) {
    work.assertOpen(); const bytes = chunk.subarray(offset, offset + 16384);
    await work.track(writeFileOutputCounted({ signal: work.signal, preserveWriteReceipt: true,
      ...(work.context.registerCleanup ? { registerCleanup: work.context.registerCleanup } : {}) }, bytes, async () => {
      await staging.writer!.write(bytes, { signal: work.signal }); return bytes.length;
    }));
  }
  const stat = await work.track(staging.writer.finish({ signal: work.signal }));
  work.assertOpen();
  await work.track(fs.publishStagedFile!({ ...staging, file: { ...staging.file, stat } }, target.path, {
    parent, destination: target.original, ancestors: target.ancestors, signal: work.signal,
  }));
  work.assertOpen();
}
