import { retainFileSystemCleanup } from "@poe-code/safe-fs/core";
import { dirname, isFsError, type CommandContext, type FileStat, type FileSystem, type FileStaging, type FileStagingEntry } from "../../contracts/index.js";
import { host, ToolError } from "./shared.js";

/** Keeps admission receipts until the backend atomically publishes each file. */
export class PatchPublication {
  private readonly directories = new Map<string, FileStat>();
  private readonly removals = new Map<string, FileSystem>();

  constructor(private readonly context: CommandContext) {}

  async capture(path: string): Promise<void> {
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
    if (this.directories.has(dirname(path)) && !this.removals.has(path)) {
      this.removals.set(path, await host(this.context, () => this.context.fs.confineExtraction!([dirname(path)], { signal: this.context.signal })));
    }
  }

  async write(path: string, text: string, destination: FileStat | undefined, mode?: number, mtimeMs?: number): Promise<void> {
    await this.capture(path);
    const ancestors: FileStagingEntry[] = [];
    for (let parent = dirname(path);; parent = dirname(parent)) {
      const stat = this.directories.get(parent);
      if (!stat) throw new ToolError(`patch parent does not exist: ${parent}`);
      ancestors.unshift({ path: parent, stat });
      if (parent === "/") break;
    }
    const context = this.context;
    const parent = ancestors[ancestors.length - 1]!.stat;
    let staging: FileStaging | undefined;
    let operation: Promise<void> | undefined;
    let closed = false;
    const release = retainFileSystemCleanup(context.fs, async view => {
      await operation?.catch(() => {});
      if (staging) await view.removeStagedFile!(staging);
    }, { maxOperations: 1 });
    const cleanup = () => { closed = true; return release(); };
    context.registerCleanup?.(cleanup);
    try {
      // Install ownership before calling a host that may close the invocation.
      operation = Promise.resolve().then(async () => {
        context.signal.throwIfAborted();
        if (closed) throw new ToolError("patch publication is closed");
        staging = await context.fs.createStagedFile!(`${dirname(path)}/.patch-${globalThis.crypto.randomUUID()}`, "file", {
          type: "file", data: Buffer.from(text),
        }, { parent, signal: context.signal, ...(mode === undefined ? {} : { mode }),
          ...(mtimeMs === undefined ? {} : { atimeMs: mtimeMs, mtimeMs }) });
        context.signal.throwIfAborted();
        if (closed) throw new ToolError("patch publication is closed");
        await context.fs.publishStagedFile!(staging, path, {
          parent, destination: destination ?? null, ancestors, signal: context.signal,
        });
      });
      await host(context, () => operation!);
    } finally { await cleanup(); }
  }

  async remove(path: string): Promise<void> {
    const fs = this.removals.get(path);
    if (!fs) throw new ToolError(`patch removal was not admitted: ${path}`);
    await host(this.context, () => fs.rm(path, { signal: this.context.signal }));
  }
}
