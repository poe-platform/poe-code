import { dirname, writeBytes, type ByteSink, type FileStat } from "../../../contracts/index.js";
import { writeFileOutput } from "../../../contracts/filesystem-output.js";
import { checkPath, hasIdentity, sameIdentity, vfsPath } from "../internal.js";
import { ZipFailure } from "./options.js";
import type { ZipScope } from "./safety.js";

/** Persistent log bytes are intentional effects, never invocation scratch files. */
export class ZipLog {
  failed = false;
  password: Uint8Array | undefined;
  private path = "";
  private parent: FileStat | undefined;
  private expected: FileStat | undefined;
  private bytes = 0;
  private append = false;
  started = false;
  private readonly pending: Uint8Array[] = [];
  constructor(private readonly scope: ZipScope, private readonly info: boolean) {}
  async open(name: string, append: boolean, protectedNames: readonly string[]): Promise<void> {
    const { context, limits } = this.scope;
    try {
      const path = vfsPath(context.cwd, name);
      checkPath(path, limits);
      const parent = await this.scope.operation(() => context.fs.realpath(dirname(path), { signal: context.signal }));
      this.path = `${parent === "/" ? "" : parent}/${path.slice(path.lastIndexOf("/") + 1)}`;
      this.parent = await this.scope.stat(parent);
      this.expected = await this.scope.stat(this.path);
      if (!this.parent || !hasIdentity(this.parent) || this.parent.type !== "directory"
        || this.expected && (this.expected.type !== "file" || this.expected.nlink !== 1 || !hasIdentity(this.expected))) throw new Error("unsafe log identity");
      await this.protect(protectedNames);
      const capabilities = await this.scope.operation(() => context.fs.capabilitiesFor?.(this.path, { signal: context.signal, create: true }) ?? context.fs.capabilities);
      if (capabilities.atomicFileMutation !== true || !context.fs.writeFileConditional) throw new Error("conditional log writes unavailable");
      this.bytes = append ? this.expected?.size ?? 0 : 0;
      if (!Number.isSafeInteger(this.bytes) || this.bytes < 0 || this.bytes > limits.maxTextBytes) throw new Error("log byte limit");
      this.append = append;
      // Reserve a new destination, but preserve existing bytes until selection
      // has ruled out aliases reached through recursive patterns.
      if (!this.expected) this.expected = await this.scope.operation(() => context.fs.writeFileConditional!(this.path, new Uint8Array(), {
        signal: context.signal, parent: this.parent!, expected: null,
      }));
    } catch {
      context.signal.throwIfAborted();
      this.failed = true;
      throw new ZipFailure(16, "Invalid command arguments", "ZIP log path is unavailable or unsafe");
    }
  }
  async protect(names: readonly string[]): Promise<void> {
    const { context } = this.scope;
    try {
      for (const name of names) {
        if (name === "-") continue;
        const path = vfsPath(context.cwd, name);
        const stat = await this.scope.stat(path);
        if (this.path === path || this.expected && stat && sameIdentity(this.expected, stat)) throw new Error("log alias");
        if (stat?.type === "directory") {
          const canonical = await this.scope.operation(() => context.fs.realpath(path, { signal: context.signal }));
          if (this.path.startsWith(`${canonical === "/" ? "" : canonical}/`)) throw new Error("log within selected directory");
        }
      }
    } catch {
      context.signal.throwIfAborted();
      this.failed = true;
      throw new ZipFailure(16, "Invalid command arguments", "ZIP log path is unavailable or unsafe");
    }
  }
  async start(): Promise<void> {
    if (this.started || this.failed) return;
    const { context } = this.scope;
    try {
      this.expected = await this.scope.operation(() => context.fs.writeFileConditional!(this.path, new Uint8Array(), {
        signal: context.signal, parent: this.parent!, expected: this.expected!, append: this.append,
      }));
    } catch {
      context.signal.throwIfAborted();
      this.failed = true;
      throw new ZipFailure(16, "Invalid command arguments", "ZIP log path is unavailable or unsafe");
    }
    try {
      for (const bytes of this.pending) await this.write(bytes);
      this.pending.length = 0;
      this.started = true;
    } catch {
      context.signal.throwIfAborted();
      this.failed = true;
      throw new ZipFailure(11, "Error writing to a file", "ZIP log write failed or exceeded its byte limit");
    }
  }
  private async write(bytes: Uint8Array): Promise<void> {
    const { context } = this.scope;
    await writeFileOutput(context, bytes, data => this.scope.operation(async () => {
      this.expected = await context.fs.writeFileConditional!(this.path, data, {
        signal: context.signal, parent: this.parent!, expected: this.expected!, append: true,
      });
    }));
  }
  sink(destination: ByteSink, quiet = false): ByteSink {
    const { context, limits } = this.scope;
    return { write: async chunk => {
      if (!this.failed && (this.info || Buffer.from(chunk).toString().includes("warning:") || Buffer.from(chunk).toString().includes("error:") || destination === context.stderr)) {
        try {
          const input = Buffer.from(chunk);
          const secret = this.password;
          const fragments: Uint8Array[] = [];
          let start = 0;
          let size = 0;
          if (secret?.length) {
            for (;;) {
              const offset = input.indexOf(secret, start);
              if (offset < 0) break;
              size += offset - start + 10;
              if (size > limits.maxTextBytes - this.bytes) throw new Error("log byte limit");
              fragments.push(input.subarray(start, offset), Buffer.from("[redacted]"));
              start = offset + secret.length;
            }
          }
          size += input.length - start;
          if (size > limits.maxTextBytes - this.bytes) throw new Error("log byte limit");
          fragments.push(input.subarray(start));
          const redacted = fragments.length === 1 ? input : Buffer.concat(fragments, size);
          if (redacted.length > limits.maxTextBytes - this.bytes) throw new Error("log byte limit");
          if (this.started) await this.write(redacted);
          else this.pending.push(Uint8Array.from(redacted));
          this.bytes += redacted.length;
        } catch {
          context.signal.throwIfAborted();
          this.failed = true;
          throw new ZipFailure(11, "Error writing to a file", "ZIP log write failed or exceeded its byte limit");
        }
      }
      const message = Buffer.from(chunk).toString();
      if (!quiet || message.includes("zip error:") || message.startsWith("zip:")) await writeBytes(destination, chunk, context.signal);
    } };
  }
}
