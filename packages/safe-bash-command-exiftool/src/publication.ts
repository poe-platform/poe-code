import type { CommandContext } from "safe-bash-contracts/command";
import type { FileStaging, FileStat } from "safe-bash-contracts/filesystem";
import { FsError } from "safe-bash-contracts/errors";

export class Publication {
  readonly #context: CommandContext;
  readonly #pending = new Set<Promise<unknown>>();
  readonly #stages: FileStaging[] = [];
  #closed = false;
  #closing: Promise<void> | undefined;
  #serial = 0;
  constructor(context: CommandContext) { this.#context = context; }
  async track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#closed) throw new Error("ExifTool invocation closed");
    this.#context.signal.throwIfAborted();
    const pending = Promise.resolve().then(operation);
    this.#pending.add(pending);
    try { return await pending; }
    finally { this.#pending.delete(pending); }
  }
  close(): Promise<void> {
    if (this.#closing) return this.#closing;
    this.#closed = true;
    this.#closing = (async () => {
      await Promise.allSettled([...this.#pending]);
      const failures: unknown[] = [];
      // Cleanup must still run after invocation cancellation, on its own signal.
      const signal = new AbortController().signal;
      for (const staging of this.#stages.splice(0).reverse()) {
        try { await this.#context.fs.removeStagedFile!(staging, { signal }); }
        catch (error) { failures.push(error); }
      }
      if (failures.length) throw new AggregateError(failures, "ExifTool staging cleanup failed");
    })();
    return this.#closing;
  }
  async publish(path: string, bytes: Uint8Array, expected: FileStat | null, inPlace: boolean): Promise<void> {
    const { fs, signal } = this.#context;
    const slash = path.lastIndexOf("/");
    const directory = path.slice(0, slash) || "/";
    const parent = await this.track(() => fs.stat(directory, { signal }));
    const capabilities = fs.capabilitiesFor ? await this.track(() => fs.capabilitiesFor!(path, { signal })) : fs.capabilities;
    if (inPlace) {
      if (!expected || !fs.writeFileConditional || !capabilities.atomicFileMutation) throw new Error("VFS atomic in-place publication not supported");
      await this.track(() => fs.writeFileConditional!(path, bytes, { expected, parent, signal }));
      return;
    }
    if (expected && expected.nlink !== 1) throw new Error("VFS hardlink replacement is not yet supported");
    if (!fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile || !capabilities.atomicFileStaging) throw new Error("VFS atomic replacement publication not supported");
    let stage: FileStaging | undefined;
    for (let attempt = 0; attempt < 32; attempt++) {
      try {
        stage = await this.track(async () => {
          const owned = await fs.createStagedFile!(directory + (directory === "/" ? "" : "/") + ".exiftool-" + ++this.#serial,
            "output", { type: "file", data: bytes }, { parent, signal, mode: expected ? expected.mode & 0o7777 : 0o666 });
          this.#stages.push(owned);
          return owned;
        });
        break;
      } catch (error) { if (!(error instanceof FsError) || error.code !== "EEXIST") throw error; }
    }
    if (!stage) throw new Error("ExifTool staging collision limit exceeded");
    await this.track(() => fs.publishStagedFile!(stage!, path, { destination: expected, parent, signal }));
  }
}
