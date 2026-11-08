import { FsError, type FileStaging, type FileStagingResolution } from "@poe-code/safe-fs/core";
import { PagedStorage } from "@poe-code/safe-fs/storage";
import type { CommandContext } from "safe-bash-contracts";
import { openFileOutput, writeFileOutput } from "safe-bash-contracts/filesystem-output";

/** Generate privately, then publish. Providers with retained staging can accept
 * bytes immediately; other providers replay a bounded caller-backed spool only
 * after serialization succeeds, preserving their ordinary write semantics. */
export class XmlFileOutput {
  private staging: FileStaging | undefined;
  private resolution: FileStagingResolution | undefined;
  private storage: PagedStorage | undefined;
  private start = 0;
  private size = 0;
  private closing: Promise<void> | undefined;
  private initialized: Promise<void> | undefined;
  private active: Promise<void> | undefined;

  constructor(private readonly context: CommandContext, private readonly path: string) {
    context.registerCleanup?.(() => this.close());
  }

  private async initialize(): Promise<void> {
    const { fs, signal } = this.context;
    signal.throwIfAborted();
    const capabilities = await fs.capabilitiesFor?.(this.path, { signal, stagingResolution: true, followFinalSymlink: true }) ?? fs.capabilities;
    if (capabilities.synchronousFollowedStagingResolution && capabilities.guardedStagingPublication
      && capabilities.atomicFileStaging && capabilities.atomicStagedFileMutation && capabilities.atomicStagingAncestry
      && capabilities.retainedStagingWrite && capabilities.retainedStagingCleanup
      && fs.prepareStagingResolution && fs.createStagedFile && fs.publishStagedFile) {
      this.resolution = await fs.prepareStagingResolution(this.path, { signal, followFinalSymlink: true });
      const target = this.resolution;
      target.validate();
      this.staging = await fs.createStagedFile(`${target.ancestors.at(-1)!.path === "/" ? "" : target.ancestors.at(-1)!.path}/.xmllint-${crypto.randomUUID()}`, "output", {
        type: "file", data: new Uint8Array(),
      }, { parent: target.parent, mode: target.destination ? target.destination.mode & 0o7777 : 0o666, retainCleanup: true, signal });
      signal.throwIfAborted();
      if (!this.staging.writer || !this.staging.cleanup) throw new FsError("ENOTSUP", { path: this.path, message: "XML output requires retained staging handles" });
    } else {
      this.storage = new PagedStorage(this.context, 4);
      this.start = this.storage.allocate(0);
    }
  }

  write(bytes: Uint8Array): Promise<void> {
    if (this.closing) return Promise.reject(new FsError("EBADF", { path: this.path }));
    const task = (async () => {
      await (this.initialized ??= this.initialize());
      this.context.signal.throwIfAborted();
      for (let offset = 0; offset < bytes.length; offset += 16384) {
        const part = bytes.subarray(offset, offset + 16384);
        if (this.staging) await writeFileOutput(this.context, part, data => this.staging!.writer!.write(data, { signal: this.context.signal }));
        else await this.storage!.append(part);
        this.size += part.length;
      }
    })();
    this.active = task;
    return task;
  }

  finish(): Promise<void> {
    if (this.closing) return Promise.reject(new FsError("EBADF", { path: this.path }));
    const task = (async () => {
      await (this.initialized ??= this.initialize());
      const { fs, signal } = this.context;
      signal.throwIfAborted();
      if (this.staging) {
        const target = this.resolution!;
        const stat = await this.staging.writer!.finish({ signal });
        signal.throwIfAborted();
        target.validate();
        await fs.publishStagedFile!({ ...this.staging, file: { ...this.staging.file, stat } }, target.path, {
          parent: target.parent, destination: target.destination, ancestors: target.ancestors,
          preserveIdentity: target.destination !== null, commitGuard: () => { target.validate(); return true; }, signal,
        });
      } else {
        // Admit the complete spool before opening a non-atomic writer. A shell
        // output limit must not truncate an otherwise untouched destination.
        for (let offset = 0; offset < this.size; offset += 16384)
          await writeFileOutput(this.context, await this.storage!.read(this.start + offset, Math.min(16384, this.size - offset)), async () => {});
        const output = await openFileOutput({ ...this.context, outputBudget: "independent" }, this.path, "w");
        try {
          for (let offset = 0; offset < this.size; offset += 16384)
            await output.sink.write(await this.storage!.read(this.start + offset, Math.min(16384, this.size - offset)));
          await output.finish();
        } catch (error) { await output.abort(error).catch(() => {}); throw error; }
      }
    })();
    this.active = task;
    return task;
  }

  close(): Promise<void> {
    return this.closing ??= (async () => {
      await this.active?.catch(() => {});
      await this.initialized?.catch(() => {});
      if (this.staging?.cleanup) {
        try { await this.staging.cleanup.remove(); }
        finally { await this.staging.cleanup.close(); }
      } else if (this.staging) await this.context.fs.removeStagedFile?.(this.staging);
      await this.storage?.close();
    })();
  }
}
