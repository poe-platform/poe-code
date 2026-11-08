import { FsError, isFsError } from "./contracts/errors.js";
import type { FileDescriptor, FileStat, FileSystem } from "./contracts/filesystem.js";

export interface PagedStorageContext {
  readonly fs: FileSystem;
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
}

const defaultPageBytes = 16 * 1024;
let serial = 0;
type Page = { bytes: Uint8Array; dirty: boolean };

/** Shares one resident-page limit across stores, retaining each store's caller
 * filesystem and cleanup ownership. Serializes cache users through eviction IO. */
export class PagedStorageCache {
  private readonly pages = new Map<Page, () => Promise<void>>();
  private active: Promise<unknown> = Promise.resolve();

  constructor(private readonly maxPages: number, readonly pageBytes = defaultPageBytes) {
    if (!Number.isSafeInteger(pageBytes) || pageBytes < defaultPageBytes || pageBytes > 1024 * 1024 || pageBytes % defaultPageBytes !== 0) throw new RangeError("Invalid storage page size");
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError("Invalid storage page cache size");
  }

  get residentBytes(): number { return this.pages.size * this.pageBytes; }

  run<T>(action: () => Promise<T>): Promise<T> {
    const work = this.active.then(action);
    this.active = work.then(() => undefined, () => undefined);
    return work;
  }

  async acquire(): Promise<Page> {
    if (this.pages.size < this.maxPages) return { bytes: new Uint8Array(this.pageBytes), dirty: false };
    const [page, release] = this.pages.entries().next().value!;
    await release();
    this.pages.delete(page);
    page.bytes.fill(0);
    return page;
  }

  retain(page: Page, release: () => Promise<void>): void {
    this.pages.delete(page);
    this.pages.set(page, release);
  }

  touch(page: Page): void {
    const release = this.pages.get(page)!;
    this.pages.delete(page);
    this.pages.set(page, release);
  }

  forget(page: Page): void { this.pages.delete(page); }
}

/** A bounded page cache backed only by the caller filesystem. The default is
 * one MiB; callers own close() on every outcome. Memory filesystems still retain
 * spilled data in RAM, so large workloads require an external backing provider. */
export class PagedStorage {
  private readonly pages = new Map<number, Page>();
  private readonly pageBytes: number;
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

  constructor(private readonly context: PagedStorageContext, private readonly maxPages = 64, private readonly cache?: PagedStorageCache) {
    if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError("Invalid storage page cache size");
    this.pageBytes = cache?.pageBytes ?? defaultPageBytes;
    this.signal = AbortSignal.any([context.signal, this.controller.signal]);
  }

  allocate(length: number): number {
    this.signal.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0 || length > Number.MAX_SAFE_INTEGER - this.end) throw new FsError("EFBIG");
    const offset = this.end;
    this.end += length;
    return offset;
  }

  /** Acquire and unlink backing storage before observing a directory snapshot. */
  async prepare(): Promise<void> {
    await this.operation(async () => { if (!this.descriptor) await this.spill(); });
  }

  private operation<T>(action: () => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    const execute = () => {
      this.signal.throwIfAborted();
      return action();
    };
    const work = this.active.then(() => this.cache ? this.cache.run(execute) : execute());
    this.active = work.then(() => undefined, () => undefined);
    return work;
  }

  private async spill(): Promise<void> {
    const { fs, cwd, env } = this.context;
    if (!fs.open || !fs.removeFileConditional) throw new FsError("ENOTSUP", { message: "spill storage requires retained read/write handles and conditional removal" });
    const selected = env.TMPDIR || cwd;
    const directory = selected.startsWith("/") ? selected : `${cwd}/${selected}`;
    this.parent = await fs.stat(directory, { signal: this.signal });
    this.signal.throwIfAborted();
    if (this.parent.type !== "directory") throw new FsError("ENOTDIR", { path: directory });
    for (let attempt = 0; attempt < 128; attempt++) {
      const path = `${directory.endsWith("/") ? directory : directory + "/"}.storage-${++serial}`;
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
    while (offset < this.pageBytes) {
      this.signal.throwIfAborted();
      const count = await this.descriptor!.write(page.bytes.subarray(offset), number * this.pageBytes + offset, { signal: this.signal });
      this.signal.throwIfAborted();
      if (!Number.isSafeInteger(count) || count <= 0 || count > this.pageBytes - offset) throw new FsError("EIO");
      offset += count;
    }
    this.diskLength = Math.max(this.diskLength, (number + 1) * this.pageBytes);
    page.dirty = false;
  }

  private async page(number: number): Promise<Page> {
    this.signal.throwIfAborted();
    const cached = this.pages.get(number);
    if (cached) {
      this.pages.delete(number);
      this.pages.set(number, cached);
      this.cache?.touch(cached);
      return cached;
    }
    let reusable: Page | undefined;
    if (this.pages.size === this.maxPages) {
      if (!this.descriptor) await this.spill();
      const [oldNumber, oldPage] = this.pages.entries().next().value!;
      await this.flush(oldNumber, oldPage);
      this.pages.delete(oldNumber);
      this.cache?.forget(oldPage);
      reusable = oldPage;
    }
    // Flush owns the bytes until its awaited write completes. Reuse only then;
    // zero new/unwritten ranges so the previous page cannot leak into them.
    const page: Page = reusable ?? (this.cache ? await this.cache.acquire() : { bytes: new Uint8Array(this.pageBytes), dirty: false });
    // Shared eviction may await IO owned by a different, still-live signal.
    this.signal.throwIfAborted();
    if (reusable) page.bytes.fill(0);
    if (number * this.pageBytes < this.diskLength) {
      let offset = 0;
      while (offset < this.pageBytes) {
        const count = await this.descriptor!.read(page.bytes.subarray(offset), number * this.pageBytes + offset, { signal: this.signal });
        this.signal.throwIfAborted();
        if (!Number.isSafeInteger(count) || count <= 0 || count > this.pageBytes - offset) throw new FsError("EIO");
        offset += count;
      }
    }
    this.pages.set(number, page);
    this.cache?.retain(page, async () => {
      if (!this.descriptor) await this.spill();
      await this.flush(number, page);
      this.pages.delete(number);
    });
    return page;
  }

  write(position: number, bytes: Uint8Array): Promise<void> {
    if (!Number.isSafeInteger(position) || position < 8 || position + bytes.length > this.end) throw new RangeError("Invalid paged storage range");
    return this.operation(async () => {
      for (let offset = 0; offset < bytes.length;) {
        const target = position + offset;
        const page = await this.page(Math.floor(target / this.pageBytes));
        const count = Math.min(bytes.length - offset, this.pageBytes - target % this.pageBytes);
        page.bytes.set(bytes.subarray(offset, offset + count), target % this.pageBytes);
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
    if (!Number.isSafeInteger(position) || position < 8 || !Number.isSafeInteger(length) || length < 0 || length > defaultPageBytes || position + length > this.end) throw new RangeError("Invalid paged storage range");
    return this.operation(async () => {
      const bytes = new Uint8Array(length);
      for (let offset = 0; offset < length;) {
        const source = position + offset;
        const page = await this.page(Math.floor(source / this.pageBytes));
        const count = Math.min(length - offset, this.pageBytes - source % this.pageBytes);
        bytes.set(page.bytes.subarray(source % this.pageBytes, source % this.pageBytes + count), offset);
        offset += count;
      }
      return bytes;
    });
  }

  close(): Promise<void> {
    this.controller.abort(new FsError("ECANCELED"));
    return this.closing ??= (async () => {
      await this.active.catch(() => {});
      const retire = async () => {
        for (const page of this.pages.values()) this.cache?.forget(page);
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
      };
      await (this.cache ? this.cache.run(retire) : retire());
    })();
  }
}

/** Fixed-depth radix index: both dense and sparse 64-bit keys use bounded RAM. */
export class IntegerTable {
  private root = 0;
  private revision = 0;
  private readonly branches = new Map<bigint, number>();
  private readonly cache = new Map<bigint, { value: bigint; dirty: boolean }>();
  constructor(private readonly storage: Pick<PagedStorage, "allocate" | "read" | "write">, private readonly maxEntries = 4096) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) throw new RangeError("Invalid integer table cache size");
  }

  private async retain(key: bigint, value: bigint, dirty: boolean): Promise<void> {
    if (this.cache.size === this.maxEntries && !this.cache.has(key)) {
      const [oldKey, old] = this.cache.entries().next().value!;
      // Flush the bounded dirty window together, before the caller touches other
      // stored data. One dirty leaf per insertion otherwise thrashes a page cache.
      if (old.dirty) for (const [key, entry] of this.cache) if (entry.dirty) {
        await this.persist(key, entry.value); entry.dirty = false;
      }
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
    if (key < 0n || key > 0xffffffffffffffffn || value < 0n || value >= 0xffffffffffffffffn) throw new RangeError("Invalid storage integer table value");
    this.revision++;
    await this.retain(key, value, true);
  }

  /** Ordered replay with a fixed 16-level radix stack (at most 2 KiB of
   * owned node bytes) and 128 output records. Batches avoid alternating sparse
   * index reads with consumer writes on every record. Mutation is not permitted. */
  async *entries(start = 0n, end = 0x10000000000000000n): AsyncGenerator<readonly [bigint, bigint]> {
    if (start < 0n || start > end || end > 0x10000000000000000n) throw new RangeError("Invalid integer table range");
    if (start === end) return;
    const revision = this.revision;
    const check = () => { if (revision !== this.revision) throw new Error("Integer table changed during iteration"); };
    for (const [key, entry] of this.cache) if (entry.dirty) {
      check(); await this.persist(key, entry.value); check(); entry.dirty = false;
    }
    const storage = this.storage;
    async function* visit(position: number, shift: bigint, prefix: bigint): AsyncGenerator<readonly [bigint, bigint]> {
      check();
      if (!position) return;
      const bytes = new Uint8Array(await storage.read(position, 128));
      check();
      if (bytes.length !== 128) throw new RangeError("Truncated integer table node");
      const node = new DataView(bytes.buffer);
      for (let slot = 0; slot < 16; slot++) {
        check(); const value = node.getBigUint64(slot * 8, true);
        if (!value) continue;
        const key = prefix | BigInt(slot) << shift;
        if (key >= end || key + (1n << shift) <= start) continue;
        if (shift === 0n) yield [key, value - 1n];
        else yield* visit(Number(value), shift - 4n, key);
      }
    }
    const batch: (readonly [bigint, bigint])[] = [];
    for await (const entry of visit(this.root, 60n, 0n)) {
      batch.push(entry);
      if (batch.length === 128) {
        for (const entry of batch) { check(); yield entry; }
        batch.length = 0;
      }
    }
    for (const entry of batch) { check(); yield entry; }
    check();
  }

  /** Hot radix paths must not evict dirty leaf pages in a one-page backend. */
  private branch(key: bigint, shift: bigint, position?: number): number | undefined {
    const prefix = key >> shift | 1n << (64n - shift);
    const value = position ?? this.branches.get(prefix);
    if (value !== undefined) {
      this.branches.delete(prefix); this.branches.set(prefix, value);
      if (this.branches.size > 128) this.branches.delete(this.branches.keys().next().value!);
    }
    return value;
  }

  private async lookup(key: bigint): Promise<bigint | undefined> {
    let node = this.root;
    for (let shift = 60n; shift >= 0n; shift -= 4n) {
      if (!node) return undefined;
      const cached = shift === 0n ? undefined : this.branch(key, shift);
      if (cached !== undefined) { node = cached; continue; }
      const slot = node + Number((key >> shift) & 15n) * 8;
      const bytes = await this.storage.read(slot, 8);
      const value = new DataView(bytes.buffer, bytes.byteOffset, 8).getBigUint64(0, true);
      if (shift === 0n) return value === 0n ? undefined : value - 1n;
      node = Number(value);
      if (node) this.branch(key, shift, node);
    }
    return undefined;
  }

  private async persist(key: bigint, value: bigint): Promise<void> {
    if (!this.root) this.root = this.storage.allocate(128);
    let node = this.root;
    for (let shift = 60n; shift >= 0n; shift -= 4n) {
      const cached = shift === 0n ? undefined : this.branch(key, shift);
      if (cached !== undefined) { node = cached; continue; }
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
      this.branch(key, shift, child);
    }
  }
}
