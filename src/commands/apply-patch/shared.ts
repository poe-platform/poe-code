import { setImmediate } from "node:timers/promises";
import { isFsError, type CommandContext, type FsError } from "../../contracts/index.js";
import type { ApplyPatchLimits } from "./options.js";

export class PatchError extends Error {
  constructor(message: string, readonly status: 1 | 2 = 1) { super(message); }
}

export class FileFailure extends Error {
  constructor(readonly error: FsError, readonly path: string) { super(error.code); }
}

export class Work {
  private units = 0;
  private nextYield = 4096;
  private closed = false;
  private readonly counts = new Map<keyof ApplyPatchLimits, number>();
  readonly cwd: string;

  constructor(readonly context: CommandContext, readonly limits: ApplyPatchLimits) {
    this.cwd = context.cwd;
  }

  close = (): void => { this.closed = true; };

  check(): void {
    this.context.signal.throwIfAborted();
    if (this.closed) throw new Error("apply_patch invocation is closed");
  }

  count(key: keyof ApplyPatchLimits, amount: number): void {
    this.check();
    const previous = this.counts.get(key) ?? 0;
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits[key] - previous) {
      throw new PatchError(`${key} limit exceeded`);
    }
    this.counts.set(key, previous + amount);
  }

  remaining(key: keyof ApplyPatchLimits): number { return this.limits[key] - (this.counts.get(key) ?? 0); }

  step(amount = 1): void {
    this.check();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits.maxWork - this.units) throw new PatchError("maxWork limit exceeded");
    this.units += amount;
  }

  async checkpoint(): Promise<void> {
    this.check();
    if (this.units >= this.nextYield) {
      this.nextYield = this.units + 4096;
      try { await setImmediate(undefined, { signal: this.context.signal }); }
      catch (error) { this.context.signal.throwIfAborted(); throw error; }
      this.check();
    }
  }

  async utf8(text: string, maximum: number, status: 1 | 2 = 1): Promise<number> {
    let bytes = 0;
    let checkpointAt = 2048;
    for (let index = 0; index < text.length; index++) {
      this.step();
      const code = text.charCodeAt(index);
      let width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = text.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new PatchError("unpaired surrogate in text", status);
        index++;
        this.step();
        width = 4;
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new PatchError("unpaired surrogate in text", status);
      if (width > maximum - bytes) throw new PatchError("UTF-8 byte limit exceeded");
      bytes += width;
      if (index >= checkpointAt) { checkpointAt = index + 2048; await this.checkpoint(); }
    }
    await this.checkpoint();
    return bytes;
  }

  async text(bytes: Uint8Array, status: 1 | 2): Promise<string> {
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const end = Math.min(offset + 4096, bytes.length);
      this.step(end - offset);
      for (let index = offset; index < end; index++) if (bytes[index] === 0) throw new PatchError("NUL bytes are unsupported", status);
      await this.checkpoint();
    }
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new PatchError("invalid UTF-8", status); }
  }

  async equal(left: string | Uint8Array, right: string | Uint8Array): Promise<boolean> {
    this.step();
    if (left.length !== right.length) return false;
    for (let offset = 0; offset < left.length; offset += 4096) {
      const end = Math.min(offset + 4096, left.length);
      this.step(end - offset);
      for (let index = offset; index < end; index++) if (left[index] !== right[index]) return false;
      await this.checkpoint();
    }
    return true;
  }

  async fs<Value>(path: string, operation: () => Promise<Value>): Promise<Value> {
    this.count("maxFsCalls", 1);
    this.step();
    await this.checkpoint();
    try {
      this.check();
      const result = await operation();
      this.check();
      return result;
    } catch (error) {
      this.context.signal.throwIfAborted();
      if (isFsError(error)) throw new FileFailure(error, path);
      throw error;
    }
  }
}

export function diagnostic(error: PatchError | FileFailure, maximum: number, ordinal?: number): Uint8Array {
  const suffix = " [truncated]\n";
  const descriptions: Readonly<Record<string, string>> = {
    ENOENT: "no such file or directory", EACCES: "permission denied", EPERM: "operation not permitted",
    EROFS: "read-only file system", ENOTSUP: "operation not supported", EOPNOTSUPP: "operation not supported",
    EEXIST: "file already exists", ENOSPC: "no space left on device", EIO: "input/output error",
    EISDIR: "is a directory", ENOTDIR: "not a directory", EFBIG: "file too large", ELOOP: "too many symbolic links",
  };
  const detail = error instanceof FileFailure ? `${descriptions[error.error.code] ?? error.error.code}: ${error.path}` : error.message;
  const parts = ["apply_patch: ", ...(ordinal === undefined ? [] : [`operation ${ordinal}; prior changes may remain: `]), detail];
  const chunks: string[] = [];
  let bytes = 0;
  const contentMaximum = maximum - Buffer.byteLength(suffix);
  for (const part of parts) {
    for (const character of part) {
      const size = Buffer.byteLength(character);
      if (size > contentMaximum - bytes) return Buffer.from(chunks.join("") + suffix);
      chunks.push(character);
      bytes += size;
    }
  }
  return Buffer.from(chunks.join("") + "\n");
}
