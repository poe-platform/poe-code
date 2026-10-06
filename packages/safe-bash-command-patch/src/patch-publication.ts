import { compareCopyIdentity } from "safe-bash-contracts/filesystem-identity";
import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { dirname,FsError,isFsError,type ByteSource,type CommandContext,type FileStaging,type FileStagingEntry,type FileStat,type FileSystem } from "safe-bash-contracts";
import { host,ToolError } from "safe-bash-diff-engine/shared";
import { targetBytes } from "./stored-target.js";
import { readBytes } from "safe-bash-contracts";

/** Retains admission receipts; trusted host staging requires external tree isolation. */
export class PatchPublication {
  private readonly directories = new Map<string, FileStat>();
  private readonly removals = new Map<string, FileSystem>();
  private readonly pruning = new Map<string, FileSystem>();

  constructor(private readonly context: CommandContext, readonly trusted = false) {}

  async capture(path: string, prune: readonly string[] = []): Promise<void> {
    const paths: string[] = [];
    for (let parent = dirname(path);; parent = dirname(parent)) {
      paths.unshift(parent);
      if (parent === "/") break;
    }
    for (const parent of paths) {
      if (this.directories.has(parent)) continue;
      let stat: FileStat;
      try { stat = await host(this.context, () => this.context.fs.lstat(parent, { signal: this.context.signal })); }
      catch (error) { if (isFsError(error, "ENOENT")) break; throw error; }
      if (stat.type !== "directory") throw new ToolError(`unsafe patch parent: ${parent}`);
      this.directories.set(parent, stat);
    }
    if (this.trusted) return;
    if (this.directories.has(dirname(path)) && !this.removals.has(path)) {
      this.removals.set(path, await host(this.context, () => this.context.fs.confineExtraction!([dirname(path)], { signal: this.context.signal })));
    }
    const parents = prune.filter(parent => this.directories.has(parent) && !this.pruning.has(parent));
    if (this.directories.has(dirname(path)) && parents.length) {
      const view = await host(this.context, () => this.context.fs.confineExtraction!([dirname(path), parents.at(-1)!], { signal: this.context.signal }));
      for (const parent of parents) this.pruning.set(parent, view);
    }
  }

  private async validate(path: string): Promise<void> {
    const parents: string[] = [];
    for (let parent = dirname(path);; parent = dirname(parent)) {
      parents.unshift(parent);
      if (parent === "/") break;
    }
    for (const parent of parents) {
      const expected = this.directories.get(parent);
      const current = await host(this.context, () => this.context.fs.lstat(parent, { signal: this.context.signal }));
      if (current.type !== "directory" || compareCopyIdentity(current, expected) !== "same") {
        throw new FsError("EAGAIN", { syscall: "patch", path: parent });
      }
    }
  }

  async mkdir(path: string): Promise<void> {
    await this.capture(path);
    await this.validate(path);
    const stat = await host(this.context, () => this.context.fs.prepareDirectory!(path, {
      parent: this.directories.get(dirname(path))!, expected: null, signal: this.context.signal,
    }));
    this.directories.set(path, stat);
  }

  async write(path: string, source: ByteSource | string, destination: FileStat | undefined, mode?: number, mtimeMs?: number): Promise<void> {
    await this.capture(path);
    const ancestors: FileStagingEntry[] = [];
    for (let parent = dirname(path);; parent = dirname(parent)) {
      const stat = this.directories.get(parent);
      if (!stat) throw new ToolError(`patch parent does not exist: ${parent}`);
      ancestors.unshift({ path: parent, stat });
      if (parent === "/") break;
    }
    const context = this.context;
    const capabilities = await host(context, async () =>
      await context.fs.capabilitiesFor?.(path, { signal: context.signal, create: true }) ?? context.fs.capabilities);
    // An unspecified writer facet may still return an owned writer; validate
    // that handle below. Explicitly unsupported writers use conditional writes.
    const retained = !this.trusted && capabilities.retainedStagingCleanup === true && capabilities.retainedStagingWrite !== false;
    if (!retained && (!context.fs.writeFileConditional
      || (capabilities.atomicFileMutation !== true && capabilities.trustedOwnedStaging !== true))) {
      throw new ToolError("filesystem does not support conditional staging writes");
    }
    const parent = ancestors[ancestors.length - 1]!.stat;
    let staging: FileStaging | undefined;
    let operation: Promise<void> | undefined;
    let closed = false;
    const release = retainFileSystemCleanup(context.fs, async view => {
      await operation?.catch(() => {});
      if (staging?.cleanup) await staging.cleanup.remove();
      else if (staging) await view.removeStagedFile!(staging);
    }, { maxOperations: 1 });
    const cleanup = () => { closed = true; return release(); };
    context.registerCleanup?.(cleanup);
    try {
      // Install ownership before calling a host that may close the invocation.
      operation = Promise.resolve().then(async () => {
        context.signal.throwIfAborted();
        if (closed) throw new ToolError("patch publication is closed");
        if (this.trusted) await this.validate(path);
        staging = await context.fs.createStagedFile!(`${dirname(path) === "/" ? "" : dirname(path)}/.patch-${globalThis.crypto.randomUUID()}`, "file", {
          type: "file", data: new Uint8Array(),
        }, { parent, ...(retained ? { retainCleanup: true } : {}), signal: context.signal, ...(mode === undefined ? {} : { mode }),
          ...(mtimeMs === undefined ? {} : { atimeMs: mtimeMs, mtimeMs }) });
        if (retained && (!staging.writer || !staging.cleanup)) throw new ToolError("filesystem does not support retained staging writes");
        for await (const bytes of readBytes(typeof source === "string" ? targetBytes(source) : source, context.signal)) {
          if (closed) throw new ToolError("patch publication is closed");
          if (!retained) {
            const stat = await context.fs.writeFileConditional!(staging.file.path, bytes, {
              parent: staging.directory.stat, expected: staging.file.stat, append: true, signal: context.signal,
              ...(mode === undefined ? {} : { mode }),
              ...(mtimeMs === undefined ? {} : { atimeMs: mtimeMs, mtimeMs }),
            });
            // Refresh the revision without replacing the immutable ownership entries.
            staging = { ...staging, file: { ...staging.file, stat } };
          } else await staging.writer!.write(bytes, { signal: context.signal });
        }
        const stat = !retained ? staging.file.stat : await staging.writer!.finish({ signal: context.signal });
        context.signal.throwIfAborted();
        if (closed) throw new ToolError("patch publication is closed");
        if (this.trusted) await this.validate(path);
        await context.fs.publishStagedFile!({ ...staging, file: { ...staging.file, stat } }, path, {
          parent, destination: destination ?? null, ...(this.trusted ? {} : { ancestors }), signal: context.signal,
        });
      });
      await host(context, () => operation!);
    } finally { await cleanup(); }
  }

  async remove(path: string, expected: FileStat): Promise<void> {
    if (this.trusted) {
      await this.validate(path);
      await host(this.context, () => this.context.fs.removeFileConditional!(path, {
        parent: this.directories.get(dirname(path))!, expected, signal: this.context.signal,
      }));
      return;
    }
    const fs = this.removals.get(path);
    if (!fs) throw new ToolError(`patch removal was not admitted: ${path}`);
    await host(this.context, () => fs.rm(path, { signal: this.context.signal }));
  }

  async prune(path: string): Promise<void> {
    if (this.trusted) {
      await this.validate(`${path}/.patch-prune`);
      if (!this.context.fs.rmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path });
      await host(this.context, () => this.context.fs.rmdir!(path, { signal: this.context.signal }));
      this.directories.delete(path);
      return;
    }
    const fs = this.pruning.get(path);
    if (!fs) throw new ToolError(`patch directory pruning was not admitted: ${path}`);
    if (!fs.rmdir) throw new FsError("ENOTSUP", { syscall: "rmdir", path });
    await host(this.context, () => fs.rmdir!(path, { signal: this.context.signal }));
  }
}
