import { FsError, isFsError, type CommandContext } from "safe-bash-contracts";
import type { FileDescriptor, FileStat } from "@poe-code/safe-fs/core";

const pageBytes = 16 * 1024;
let serial = 0;
type Page = { bytes: Uint8Array; dirty: boolean };

/** A one-MiB working set, backed only by the invocation's filesystem. */
export class ShufStorage {
  private readonly pages = new Map<number, Page>();
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private descriptor: FileDescriptor | undefined;
  private parent: FileStat | undefined;
  private initial: FileStat | undefined;
  private path: string | undefined;
  private diskLength = 0;
  private unlinked = false;
  private end = 8; // Zero is the absent-pointer sentinel.
  private active: Promise<unknown> = Promise.resolve();
  private closing: Promise<void> | undefined;

  constructor(private readonly context: CommandContext, private readonly maxPages = 64) {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError("Invalid shuf page cache size");
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
  }

  allocate(length: number): number {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER - this.end) throw new FsError("EFBIG");
    const offset = this.end;
    this.end += length;
    return offset;
  }

  private operation<T>(action: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const work = this.active.then(() => {
      this.signal.throwIfAborted();
      return action();
    });
    this.active = work.then(() => undefined, () => undefined);
    return work;
  }

  private async spill(): Promise<void> {
    const { fs, cwd, env } = this.context;
    if (!fs.open || !fs.removeFileConditional) throw new FsError("ENOTSUP", { message: "shuf spill storage requires retained read/write handles and conditional removal" });
    const selected = env.TMPDIR || cwd;
    const directory = selected.startsWith("/") ? selected : `${cwd}/${selected}`;
    this.parent = await fs.stat(directory, { signal: this.signal });
    this.signal.throwIfAborted();
    if (this.parent.type !== "directory") throw new FsError("ENOTDIR", { path: directory });
    for (let attempt = 0; attempt < 128; attempt++) {
      const path = `${directory.endsWith("/") ? directory : directory + "/"}.shuf-${++serial}`;
      try {
        this.descriptor = await fs.open(path, { access: "readwrite", creation: "exclusive", mode: 0o600, signal: this.signal });
        this.path = path;
        break;
      } catch (error) {
        this.signal.throwIfAborted();
        if (!isFsError(error) || error.code !== "EEXIST") throw error;
      }
    }
    if (!this.descriptor) throw new FsError("EEXIST", { path: directory });
    // Retain the acquisition receipt even if cancellation wins immediately after open.
    this.initial = await this.descriptor.stat();
    this.signal.throwIfAborted();
    if (!this.descriptor.capabilities.positionedRead || !this.descriptor.capabilities.positionedWrite) throw new FsError("ENOTSUP");
    // Detach the name before storing input. A later output or random-source path
    // cannot alias our scratch file; the retained descriptor owns its lifetime.
    await fs.removeFileConditional(this.path!, { parent: this.parent, expected: this.initial, signal: this.signal });
    this.unlinked = true;
    for (const [number, page] of this.pages) await this.flush(number, page);
  }

  private async flush(number: number, page: Page): Promise<void> {
    if (!page.dirty) return;
    let offset = 0;
    while (offset < pageBytes) {
      this.signal.throwIfAborted();
      const count = await this.descriptor!.write(page.bytes.subarray(offset), number * pageBytes + offset, { signal: this.signal });
      this.signal.throwIfAborted();
      if (!Number.isSafeInteger(count) || count <= 0 || count > pageBytes - offset) throw new FsError("EIO");
      offset += count;
    }
    this.diskLength = Math.max(this.diskLength, (number + 1) * pageBytes);
    page.dirty = false;
  }

  private async page(number: number): Promise<Page> {
    this.signal.throwIfAborted();
    const cached = this.pages.get(number);
    if (cached) {
      this.pages.delete(number);
      this.pages.set(number, cached);
      return cached;
    }
    if (this.pages.size === this.maxPages) {
      if (!this.descriptor) await this.spill();
      const [oldNumber, oldPage] = this.pages.entries().next().value!;
      await this.flush(oldNumber, oldPage);
      this.pages.delete(oldNumber);
    }
    const page: Page = { bytes: new Uint8Array(pageBytes), dirty: false };
    if (number * pageBytes < this.diskLength) {
      let offset = 0;
      while (offset < pageBytes) {
        const count = await this.descriptor!.read(page.bytes.subarray(offset), number * pageBytes + offset, { signal: this.signal });
        this.signal.throwIfAborted();
        if (!Number.isSafeInteger(count) || count <= 0 || count > pageBytes - offset) throw new FsError("EIO");
        offset += count;
      }
    }
    this.pages.set(number, page);
    return page;
  }

  write(position: number, bytes: Uint8Array): Promise<void> {
    if (position < 8 || position + bytes.length > this.end) throw new RangeError("Invalid shuf storage range");
    return this.operation(async () => {
      for (let offset = 0; offset < bytes.length;) {
        const target = position + offset;
        const page = await this.page(Math.floor(target / pageBytes));
        const count = Math.min(bytes.length - offset, pageBytes - target % pageBytes);
        page.bytes.set(bytes.subarray(offset, offset + count), target % pageBytes);
        page.dirty = true;
        offset += count;
      }
    });
  }

  async append(bytes: Uint8Array): Promise<number> {
    const position = this.allocate(bytes.length);
    await this.write(position, bytes);
    return position;
  }

  read(position: number, length: number): Promise<Uint8Array> {
    if (!Number.isSafeInteger(position) || position < 8 || !Number.isSafeInteger(length) || length < 0 || length > pageBytes || position + length > this.end) throw new RangeError("Invalid shuf storage range");
    return this.operation(async () => {
      const bytes = new Uint8Array(length);
      for (let offset = 0; offset < length;) {
        const source = position + offset;
        const page = await this.page(Math.floor(source / pageBytes));
        const count = Math.min(length - offset, pageBytes - source % pageBytes);
        bytes.set(page.bytes.subarray(source % pageBytes, source % pageBytes + count), offset);
        offset += count;
      }
      return bytes;
    });
  }

  close(): Promise<void> {
    this.controller.abort(new FsError("ECANCELED"));
    return this.closing ??= (async () => {
      await this.active.catch(() => {});
      this.pages.clear();
      const descriptor = this.descriptor;
      if (!descriptor) return;
      const cancellation = new FsError("ECANCELED");
      try {
        if (!this.unlinked) {
          const expected = this.initial ?? await descriptor.stat();
          await this.context.fs.removeFileConditional!(this.path!, { parent: this.parent!, expected }).catch(error => {
            if (!isFsError(error) || error.code !== "ENOENT") throw error;
          });
        }
      } finally {
        // Conditional descriptors must discard their private staged writes, not
        // publish the scratch data when the command retires its handle.
        await descriptor.close({ signal: AbortSignal.abort(cancellation) }).catch(error => {
          if (error !== cancellation) throw error;
        });
      }
    })();
  }
}

/** Fixed-depth radix index: both dense and sparse 64-bit keys use bounded RAM. */
export class IntegerTable {
  private root = 0;
  private readonly cache = new Map<bigint, { value: bigint; dirty: boolean }>();
  constructor(private readonly storage: ShufStorage, private readonly maxEntries = 4096) {}

  private async retain(key: bigint, value: bigint, dirty: boolean): Promise<void> {
    if (this.cache.size === this.maxEntries && !this.cache.has(key)) {
      const [oldKey, old] = this.cache.entries().next().value!;
      if (old.dirty) await this.persist(oldKey, old.value);
      this.cache.delete(oldKey);
    }
    this.cache.delete(key);
    this.cache.set(key, { value, dirty });
  }

  async get(key: bigint): Promise<bigint | undefined> {
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return cached.value;
    }
    const value = await this.lookup(key);
    if (value !== undefined) await this.retain(key, value, false);
    return value;
  }

  async set(key: bigint, value: bigint): Promise<void> {
    if (key < 0n || key > 0xffffffffffffffffn || value < 0n || value >= 0xffffffffffffffffn) throw new RangeError("Invalid shuf integer table value");
    await this.retain(key, value, true);
  }

  private async lookup(key: bigint): Promise<bigint | undefined> {
    let node = this.root;
    for (let shift = 60n; shift >= 0n; shift -= 4n) {
      if (!node) return undefined;
      const slot = node + Number((key >> shift) & 15n) * 8;
      const bytes = await this.storage.read(slot, 8);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
      if (shift === 0n) return value === 0n ? undefined : value - 1n;
      node = Number(value);
    }
    return undefined;
  }

  private async persist(key: bigint, value: bigint): Promise<void> {
    if (!this.root) this.root = this.storage.allocate(128);
    let node = this.root;
    for (let shift = 60n; shift >= 0n; shift -= 4n) {
      const slot = node + Number((key >> shift) & 15n) * 8;
      const bytes = await this.storage.read(slot, 8);
      const view = new DataView(bytes.buffer, bytes.byteOffset, 8);
      if (shift === 0n) {
        view.setBigUint64(0, value + 1n, true);
        await this.storage.write(slot, bytes);
        return;
      }
      let child = Number(view.getBigUint64(0, true));
      if (!child) {
        child = this.storage.allocate(128);
        view.setBigUint64(0, BigInt(child), true);
        await this.storage.write(slot, bytes);
      }
      node = child;
    }
  }
}
