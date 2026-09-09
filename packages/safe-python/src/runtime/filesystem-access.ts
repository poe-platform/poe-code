import { FsError, type FileSystem } from "@poe-code/safe-fs/contracts";
import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";
import { PythonRuntimeError } from "./error.js";

/** Host boundary for whole-file operations, not guest file objects or descriptors.
 * The injected adapter owns path confinement and filesystem operation semantics.
 * FsError is preserved for the eventual guest OSError translation layer.
 */
export class FileSystemAccess {
  readonly #filesystem: FileSystem;
  readonly #meter: ExecutionMeter;
  readonly #maxReadBytes: number;
  readonly #signal: AbortSignal | undefined;
  #cancelled: ExecutionLimitError | undefined;

  constructor(filesystem: FileSystem, meter: ExecutionMeter, maxReadBytes: number, signal?: AbortSignal) {
    if (!Number.isSafeInteger(maxReadBytes) || maxReadBytes < 0) throw new RangeError("maxReadBytes must be a nonnegative safe integer");
    this.#filesystem = filesystem;
    this.#meter = meter;
    this.#maxReadBytes = maxReadBytes;
    this.#signal = signal;
  }

  #checkpoint(steps = 1, bytes = 0): void {
    if (this.#signal?.aborted) {
      this.#cancelled ??= new ExecutionLimitError("cancelled");
      throw this.#cancelled;
    }
    this.#meter.checkpoint(steps, bytes);
  }

  async #run<Result>(path: string, capability: "read" | "write" | "exclusiveCreate" | "append", operation: () => Promise<Result>): Promise<Result> {
    this.#checkpoint(path.length + 1);
    if (path.includes("\0")) throw new PythonRuntimeError("ValueError", "embedded null character");
    try {
      const capabilities = this.#filesystem.capabilitiesFor
        ? await this.#filesystem.capabilitiesFor(path, { signal: this.#signal })
        : this.#filesystem.capabilities;
      this.#checkpoint();
      if (capability !== "read" && (this.#filesystem.capabilities.readOnly || capabilities.readOnly)) throw new FsError("EROFS", { path });
      if (this.#filesystem.capabilities[capability] === false || capabilities[capability] === false) throw new FsError("ENOTSUP", { path });
      return await operation();
    } finally {
      // Cancellation can race with an external mutation; this is deliberately
      // not a transaction and never attempts to undo adapter side effects.
      this.#checkpoint(0);
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    return this.#run(path, "read", async () => {
      // Reserve the adapter's maximum returned buffer before it allocates.
      // This is conservative cumulative accounting, not a refundable quota.
      this.#checkpoint(0, this.#maxReadBytes);
      const bytes = await this.#filesystem.readFile(path, { maxBytes: this.#maxReadBytes, signal: this.#signal });
      this.#checkpoint(0);
      if (bytes.length > this.#maxReadBytes) throw new FsError("EFBIG", { syscall: "readFile", path });
      this.#checkpoint(bytes.length, bytes.byteLength);
      return new Uint8Array(bytes);
    });
  }

  async writeFile(path: string, input: Uint8Array, exclusive = false): Promise<void> {
    this.#checkpoint(input.length + 1, input.byteLength);
    const bytes = new Uint8Array(input);
    await this.#run(path, exclusive ? "exclusiveCreate" : "write", () => this.#filesystem.writeFile(path, bytes, {
      flag: exclusive ? "wx" : "w", signal: this.#signal
    }));
  }

  async appendFile(path: string, input: Uint8Array): Promise<void> {
    this.#checkpoint(input.length + 1, input.byteLength);
    const bytes = new Uint8Array(input);
    await this.#run(path, "append", () => this.#filesystem.appendFile(path, bytes, { signal: this.#signal }));
  }
}
