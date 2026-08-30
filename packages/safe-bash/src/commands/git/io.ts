import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import { FsError, createOutputOperation, dirname, resolvePath, type CommandContext, type DirectoryEntry, type FileStat, type OutputOperation } from "../../contracts/index.js";
import { ConsumerClosed, GIT_LIMITS, GitFailure, demand } from "./limits.js";

export class Session {
  readonly operation: OutputOperation;
  readonly boundary: string;
  private readonly owned = new WeakMap<Uint8Array, number>();
  private readonly counts = new Map<string, number>();
  private sinceYield = 0;
  private resident = 0;
  private readonly observations = new Map<string, string>();
  private readonly extraObservations: (() => Promise<void>)[] = [];
  private readonly finalizers: (() => void)[] = [];

  constructor(readonly context: CommandContext, boundary: string) {
    this.boundary = resolvePath("/", boundary);
    this.operation = createOutputOperation(context, context.stdout);
  }

  check(): void {
    this.context.signal.throwIfAborted();
    if (this.operation.signal.aborted) {
      if (this.context.stdout.ownedOutput?.consumerClosed.aborted) throw new ConsumerClosed("Git output consumer closed");
      throw this.operation.signal.reason;
    }
  }

  charge(key: keyof typeof GIT_LIMITS, amount: number): void {
    this.check();
    const total = (this.counts.get(key) ?? 0) + amount;
    demand(Number.isSafeInteger(amount) && amount >= 0 && Number.isSafeInteger(total) && total <= GIT_LIMITS[key], `Git ${key} exceeded`);
    this.counts.set(key, total);
  }

  async step(amount = 1): Promise<void> {
    this.charge("maxSteps", amount);
    this.sinceYield += amount;
    while (this.sinceYield >= 4096) {
      this.sinceYield -= 4096;
      await setImmediate();
      this.check();
    }
  }

  reserve(size: number): void {
    demand(Number.isSafeInteger(size) && size >= 0 && size <= GIT_LIMITS.maxResidentBytes - this.resident, "Git resident reservation exceeded");
    this.resident += size;
  }

  unreserve(size: number): void { this.resident -= size; }

  allocate(size: number): Buffer {
    this.reserve(size);
    try {
      const bytes = Buffer.alloc(size);
      this.owned.set(bytes, size);
      return bytes;
    } catch (error) { this.unreserve(size); throw error; }
  }

  copy(bytes: Uint8Array): Buffer {
    const result = this.allocate(bytes.length);
    result.set(bytes);
    return result;
  }

  release(bytes: Uint8Array): void {
    const amount = this.owned.get(bytes);
    if (amount !== undefined) { this.unreserve(amount); this.owned.delete(bytes); }
  }

  text(bytes: Uint8Array): string {
    this.reserve(bytes.length * 2);
    try { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
    catch { throw new GitFailure("invalid UTF-8 in Git metadata/text"); }
  }

  async hash(bytes: Uint8Array, type?: string): Promise<string> {
    const hash = createHash("sha1");
    if (type) hash.update(`${type} ${bytes.length}\0`);
    for (let offset = 0; offset < bytes.length; offset += 4096) {
      const part = bytes.subarray(offset, offset + 4096);
      await this.step(part.length);
      hash.update(part);
    }
    return hash.digest("hex");
  }

  path(base: string, name: string): string {
    demand(!name.includes("\0") && Buffer.byteLength(name) <= GIT_LIMITS.maxPathBytes, "invalid Git path");
    const path = resolvePath(base, name);
    demand(path === this.boundary || path.startsWith(this.boundary === "/" ? "/" : this.boundary + "/"), "Git path outside discovery boundary");
    demand(Buffer.byteLength(path) <= GIT_LIMITS.maxPathBytes, "Git path limit exceeded");
    return path;
  }

  async call<Value>(start: () => Promise<Value>): Promise<Value> {
    this.check();
    try { const value = await start(); this.check(); return value; }
    catch (error) {
      this.context.signal.throwIfAborted();
      if (error instanceof ConsumerClosed) throw error;
      if (error instanceof FsError && !this.operation.signal.aborted) throw new GitFailure(`${error.code}: ${error.path ?? "VFS read"}`);
      throw error;
    }
  }

  async stat(path: string): Promise<FileStat | undefined> {
    await this.step();
    this.path("/", path);
    try {
      const stat = await this.context.fs.lstat(path, { signal: this.operation.signal });
      this.check();
      return stat;
    } catch (error) {
      this.context.signal.throwIfAborted();
      if (error instanceof FsError && error.code === "ENOENT" && !this.operation.signal.aborted) return undefined;
      if (error instanceof FsError && !this.operation.signal.aborted) throw new GitFailure(`${error.code}: ${path}`);
      throw error;
    }
  }

  async safe(path: string, leafLink = false): Promise<void> {
    const relative = this.path("/", path).slice(this.boundary === "/" ? 1 : this.boundary.length + 1);
    let current = this.boundary;
    const root = await this.stat(current);
    demand(root?.type === "directory", "Git boundary is not a real directory");
    const parts = relative ? relative.split("/") : [];
    demand(parts.length <= GIT_LIMITS.maxDepth, "Git path depth exceeded");
    for (let index = 0; index < parts.length; index++) {
      current = this.path(current, parts[index]!);
      const stat = await this.stat(current);
      if (!stat) return;
      demand(stat.type !== "symlink" || leafLink && index === parts.length - 1, "Git metadata/path symlink refused");
      if (index < parts.length - 1) demand(stat.type === "directory", "Git path obstruction");
    }
    if (!(leafLink && (await this.stat(path))?.type === "symlink")) {
      const actual = await this.call(() => this.context.fs.realpath(path, { signal: this.operation.signal }));
      demand(actual === path, "Git namespace case/normalization/alias mismatch");
    }
  }

  async list(path: string): Promise<DirectoryEntry[]> {
    await this.safe(path);
    const entries = await this.call(() => this.context.fs.readdir(path, { signal: this.operation.signal }));
    demand(Array.isArray(entries), "invalid Git directory listing");
    this.charge("maxEntries", entries.length);
    this.reserve(entries.length * 64);
    const seen = new Set<string>();
    for (const entry of entries) {
      await this.step(entry.name.length + 1);
      component(entry.name);
      this.reserve(Buffer.byteLength(entry.name) * 2);
      demand(!seen.has(entry.name), "duplicate Git directory entry");
      seen.add(entry.name);
    }
    return entries;
  }

  async read(path: string, maximum: number, optional = false, observe = false): Promise<Buffer | undefined> {
    await this.safe(path);
    const before = await this.stat(path);
    if (!before) { if (optional) return undefined; throw new GitFailure(`missing Git file: ${path}`); }
    demand(before.type === "file", `Git input is not a regular file: ${path}`);
    demand(Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maximum, "Git file admission size exceeded");
    const pieces: Buffer[] = [];
    let total = 0;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let closing: Promise<unknown> | undefined;
    const close = (): Promise<unknown> => closing ??= Promise.resolve().then(() => iterator?.return?.());
    let failed = false;
    try {
      if (this.context.fs.readStream) {
        await this.operation.acquire(() => iterator = this.context.fs.readStream!(path, { signal: this.operation.signal, chunkSize: GIT_LIMITS.maxChunkBytes })[Symbol.asyncIterator](), async () => { await close(); });
        for (;;) {
          const row = await this.call(() => iterator!.next());
          if (row.done) break;
          demand(row.value instanceof Uint8Array, "Git source yielded nonbytes");
          this.charge("maxChunks", 1);
          demand(row.value.length <= GIT_LIMITS.maxChunkBytes && row.value.length <= maximum - total, "Git read chunk/size exceeded");
          this.charge("maxReadBytes", row.value.length);
          await this.step(Math.max(1, row.value.length));
          pieces.push(this.copy(row.value));
          total += row.value.length;
        }
      } else {
        const bytes = await this.call(() => this.context.fs.readFile(path, { signal: this.operation.signal, maxBytes: maximum }));
        demand(bytes instanceof Uint8Array && bytes.length <= maximum, "Git bounded readFile exceeded");
        this.charge("maxReadBytes", bytes.length);
        await this.step(bytes.length);
        pieces.push(this.copy(bytes)); total = bytes.length;
      }
      const after = await this.stat(path);
      demand(after && snapshot(before) === snapshot(after) && total === before.size, "Git input changed during read");
      const result = this.allocate(total);
      let position = 0;
      for (const piece of pieces) { result.set(piece, position); position += piece.length; }
      if (observe) this.observations.set(path, await this.hash(result));
      return result;
    } catch (error) { failed = true; throw error; }
    finally {
      for (const piece of pieces) this.release(piece);
      if (failed) await close().catch(() => {});
      else await close();
    }
  }

  async unchanged(): Promise<void> {
    for (const observation of this.extraObservations) await observation();
    for (const [path, hash] of this.observations) {
      const bytes = await this.read(path, GIT_LIMITS.maxIndexBytes);
      try { demand(await this.hash(bytes!) === hash, "Git metadata changed before output"); }
      finally { this.release(bytes!); }
    }
  }

  observe(check: () => Promise<void>): void { this.reserve(64); this.extraObservations.push(check); }

  onFinish(close: () => void): void { this.reserve(64); this.finalizers.push(close); }

  finish(): void { for (const close of this.finalizers.splice(0)) close(); }

  async visitFile(path: string, maximum: number, consume: (bytes: Uint8Array, offset: number) => Promise<void>): Promise<void> {
    await this.safe(path);
    const before = await this.stat(path);
    demand(before?.type === "file" && Number.isSafeInteger(before.size) && before.size >= 0 && before.size <= maximum, "Git file admission size exceeded");
    let total = 0;
    let iterator: AsyncIterator<Uint8Array> | undefined;
    let closing: Promise<unknown> | undefined;
    const close = (): Promise<unknown> => closing ??= Promise.resolve().then(() => iterator?.return?.());
    let failed = false;
    try {
      if (this.context.fs.readStream) {
        await this.operation.acquire(() => iterator = this.context.fs.readStream!(path, { signal: this.operation.signal, chunkSize: GIT_LIMITS.maxChunkBytes })[Symbol.asyncIterator](), async () => { await close(); });
        for (;;) {
          const row = await this.call(() => iterator!.next());
          if (row.done) break;
          this.charge("maxChunks", 1);
          demand(row.value instanceof Uint8Array && row.value.length <= GIT_LIMITS.maxChunkBytes && row.value.length <= before.size - total, "Git exact read chunk/size exceeded");
          this.charge("maxReadBytes", row.value.length);
          await this.step();
          await consume(row.value, total);
          total += row.value.length;
        }
      } else {
        const bytes = await this.call(() => this.context.fs.readFile(path, { signal: this.operation.signal, maxBytes: maximum }));
        demand(bytes instanceof Uint8Array && bytes.length === before.size, "Git exact readFile size mismatch");
        this.charge("maxReadBytes", bytes.length);
        await consume(bytes, 0);
        total = bytes.length;
      }
      const after = await this.stat(path);
      demand(after && snapshot(before) === snapshot(after) && total === before.size, "Git input changed during exact read");
    } catch (error) { failed = true; throw error; }
    finally {
      if (failed) await close().catch(() => {});
      else await close();
    }
  }

  async copyInto(target: Uint8Array, source: Uint8Array, offset = 0): Promise<void> {
    demand(Number.isSafeInteger(offset) && offset >= 0 && source.length <= target.length - offset, "Git copy extent exceeded");
    for (let position = 0; position < source.length; position += 4096) {
      const part = source.subarray(position, position + 4096);
      await this.step(part.length);
      target.set(part, offset + position);
    }
  }

  async readExact(path: string, maximum: number): Promise<Buffer> {
    await this.safe(path);
    const stat = await this.stat(path);
    demand(stat?.type === "file" && Number.isSafeInteger(stat.size) && stat.size >= 0 && stat.size <= maximum, "Git exact file admission exceeded");
    const body = this.allocate(stat.size);
    let success = false;
    try {
      await this.visitFile(path, maximum, (bytes, offset) => this.copyInto(body, bytes, offset));
      const after = await this.stat(path);
      demand(after && snapshot(stat) === snapshot(after), "Git exact file changed before fill");
      success = true;
      return body;
    } finally { if (!success) this.release(body); }
  }

  async observeExact(path: string, maximum: number, body: Uint8Array): Promise<void> {
    const expected = await this.hash(body);
    this.observe(async () => {
      const hash = createHash("sha1");
      await this.visitFile(path, maximum, async bytes => {
        for (let offset = 0; offset < bytes.length; offset += 4096) {
          const part = bytes.subarray(offset, offset + 4096);
          await this.step(part.length);
          hash.update(part);
        }
      });
      demand(hash.digest("hex") === expected, "Git packed input changed before output");
    });
  }

  async output(bytes: Uint8Array | string): Promise<void> {
    const length = typeof bytes === "string" ? Buffer.byteLength(bytes) : bytes.length;
    this.charge("maxOutputBytes", length);
    if (typeof bytes === "string") this.reserve(length);
    const content = typeof bytes === "string" ? Buffer.from(bytes) : bytes;
    try {
      for (let offset = 0; offset < content.length; offset += GIT_LIMITS.maxChunkBytes) {
        this.check();
        await this.operation.output.write(content.subarray(offset, offset + GIT_LIMITS.maxChunkBytes));
      }
    } finally { if (typeof bytes === "string") this.unreserve(length); }
  }

  async sorted(paths: Iterable<string>): Promise<string[]> {
    const values = Array.from(paths);
    this.reserve(values.length * 16);
    for (let width = 1; width < values.length; width *= 2) {
      for (let start = 0; start < values.length; start += width * 2) {
        const middle = Math.min(start + width, values.length), end = Math.min(start + width * 2, values.length);
        const merged: string[] = [];
        let left = start, right = middle;
        while (left < middle || right < end) {
          if (left < middle && right < end) await this.step(values[left]!.length + values[right]!.length + 1);
          merged.push(right >= end || left < middle && compare(values[left]!, values[right]!) <= 0 ? values[left++]! : values[right++]!);
        }
        for (let index = 0; index < merged.length; index++) values[start + index] = merged[index]!;
      }
    }
    return values;
  }
}

function snapshot(stat: FileStat): string { return `${stat.type}:${stat.size}:${stat.mode}:${stat.mtimeMs}:${stat.ctimeMs}`; }

export function component(name: string): void {
  demand(typeof name === "string" && name.length > 0 && name !== "." && name !== ".." && !name.includes("/") && !name.includes("\0") && Buffer.byteLength(name) <= GIT_LIMITS.maxPathBytes, "invalid Git path component");
  demand(Buffer.from(name).toString("utf8") === name, "nonroundtrippable Git path");
}

export function objectPath(name: string): void {
  demand(name.length > 0 && !name.startsWith("/") && !name.endsWith("/"), "invalid repository path");
  for (const part of name.split("/")) { component(part); demand(part.toLowerCase() !== ".git", "reserved Git path"); }
}

export function compare(left: string, right: string): number { return Buffer.compare(Buffer.from(left), Buffer.from(right)); }

export function parent(path: string): string { return dirname(path); }
