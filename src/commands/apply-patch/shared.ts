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

  admit(amount: number): void {
    this.check();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits.maxWork - this.units) throw new PatchError("maxWork limit exceeded");
  }

  step(amount = 1): void {
    this.admit(amount);
    this.units += amount;
  }

  get due(): boolean { return this.units >= this.nextYield; }

  async checkpoint(): Promise<void> {
    this.check();
    if (this.units >= this.nextYield) {
      this.nextYield += 4096;
      try { await setImmediate(undefined, { signal: this.context.signal }); }
      catch (error) { this.context.signal.throwIfAborted(); throw error; }
      this.check();
    }
  }

  async charge(amount: number): Promise<void> {
    this.admit(amount);
    while (amount > 0) {
      await this.checkpoint();
      const count = Math.min(amount, this.nextYield - this.units);
      this.step(count);
      amount -= count;
    }
    await this.checkpoint();
  }

  async copyInto(bytes: Uint8Array, target: Uint8Array, start: number): Promise<void> {
    this.admit(bytes.length);
    let offset = 0;
    while (offset < bytes.length) {
      await this.checkpoint();
      const count = Math.min(bytes.length - offset, this.nextYield - this.units);
      this.step(count);
      target.set(bytes.subarray(offset, offset + count), start + offset);
      offset += count;
    }
    await this.checkpoint();
  }

  async copy(bytes: Uint8Array): Promise<Uint8Array> {
    this.admit(bytes.length);
    const result = new Uint8Array(bytes.length);
    await this.copyInto(bytes, result, 0);
    return result;
  }

  async slice(text: string, start: number, end = text.length): Promise<string> {
    await this.charge(end - start);
    return text.slice(start, end);
  }

  async encodeInto(text: string, target: Uint8Array, start: number): Promise<number> {
    const encoder = new TextEncoder();
    let offset = start;
    for (let index = 0; index < text.length;) {
      let end = Math.min(text.length, index + 1024);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      await this.charge(end - index);
      const chunk = text.slice(index, end);
      const bytes = await this.utf8(chunk, target.length - offset);
      await this.charge(bytes);
      const encoded = encoder.encodeInto(chunk, target.subarray(offset, offset + bytes));
      if (encoded.read !== chunk.length || encoded.written !== bytes) throw new Error("apply_patch encoding size mismatch");
      offset += bytes;
      index = end;
    }
    await this.checkpoint();
    return offset;
  }

  async utf8(text: string, maximum: number, status: 1 | 2 = 1): Promise<number> {
    let bytes = 0;
    for (let index = 0; index < text.length; index++) {
      if (this.due) await this.checkpoint();
      this.step();
      const code = text.charCodeAt(index);
      let width = code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
      if (code >= 0xd800 && code <= 0xdbff) {
        if (this.due) await this.checkpoint();
        this.step();
        const next = text.charCodeAt(index + 1);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new PatchError("unpaired surrogate in text", status);
        index++;
        width = 4;
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new PatchError("unpaired surrogate in text", status);
      if (width > maximum - bytes) throw new PatchError("UTF-8 byte limit exceeded");
      bytes += width;
    }
    await this.checkpoint();
    return bytes;
  }

  async text(bytes: Uint8Array, status: 1 | 2): Promise<string> {
    this.admit(bytes.length * 2);
    for (let offset = 0; offset < bytes.length; offset += 2048) {
      const end = Math.min(offset + 2048, bytes.length);
      await this.charge(end - offset);
      for (let index = offset; index < end; index++) if (bytes[index] === 0) throw new PatchError("NUL bytes are unsupported", status);
    }
    const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
    const parts: string[] = [];
    let length = 0;
    for (let offset = 0; offset < bytes.length; offset += 2048) {
      const end = Math.min(offset + 2048, bytes.length);
      await this.charge(end - offset);
      let part: string;
      try { part = decoder.decode(bytes.subarray(offset, end), { stream: true }); }
      catch { throw new PatchError("invalid UTF-8", status); }
      parts.push(part);
      length += part.length;
    }
    let last: string;
    try { last = decoder.decode(); }
    catch { throw new PatchError("invalid UTF-8", status); }
    parts.push(last);
    await this.charge(length + last.length);
    return parts.join("");
  }

  async equal(left: string | Uint8Array, right: string | Uint8Array): Promise<boolean> {
    await this.charge(1);
    if (left.length !== right.length) return false;
    for (let offset = 0; offset < left.length;) {
      const end = Math.min(offset + this.nextYield - this.units, left.length);
      this.step(end - offset);
      let matched = true;
      for (let index = offset; index < end; index++) if (left[index] !== right[index]) { matched = false; break; }
      await this.checkpoint();
      if (!matched) return false;
      offset = end;
    }
    return true;
  }

  async fs<Value>(path: string, operation: () => Promise<Value>): Promise<Value> {
    this.count("maxFsCalls", 1);
    await this.charge(1);
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
