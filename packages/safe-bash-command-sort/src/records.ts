import { PagedStorage } from "@poe-code/safe-fs/storage";
import { FsError, type ByteSource, type CommandContext } from "safe-bash-contracts";
import { SortRecordBudget } from "./sort-admission.js";
import { SortWork } from "./work.js";

export interface SortLimits {
  readonly memoryBytes: number;
  readonly maxInputBytes: number;
  readonly maxRecords: number;
  readonly mergeFanIn: number;
}

export const defaultSortLimits: SortLimits = Object.freeze({
  memoryBytes: 8 * 1024 * 1024, maxInputBytes: Infinity, maxRecords: Infinity, mergeFanIn: 16,
});

export class SortStorage {
  readonly context: CommandContext;
  readonly recordBytes: number;
  readonly admission = new SortRecordBudget();
  private readonly controller = new AbortController();
  private readonly stores = new Set<PagedStorage>();
  private readonly readers = new Set<() => Promise<void>>();
  private closing: Promise<void> | undefined;
  private inputBytes = 0;
  private inputRecords = 0;

  constructor(context: CommandContext, readonly limits: SortLimits, readonly work = new SortWork(context.signal)) {
    this.context = Object.create(context, { signal: { value: AbortSignal.any([context.signal, this.controller.signal]) } }) as CommandContext;
    this.recordBytes = Math.min(16 * 1024, Math.floor(limits.memoryBytes / (8 * (limits.mergeFanIn + 4))));
    context.registerCleanup?.(() => this.close());
  }

  acquire(pages = 1): PagedStorage {
    this.context.signal.throwIfAborted();
    const store = new PagedStorage(this.context, pages);
    this.stores.add(store);
    return store;
  }

  async release(store: PagedStorage): Promise<void> {
    await store.close();
    this.stores.delete(store);
  }

  reader(source: ByteSource): { iterator: AsyncIterator<Uint8Array>; close(): Promise<void> } {
    this.context.signal.throwIfAborted();
    const iterator = source[Symbol.asyncIterator]();
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => closing ??= Promise.resolve().then(async () => {
      try { await iterator.return?.(); }
      finally { this.readers.delete(close); }
    });
    this.readers.add(close);
    return { iterator, close };
  }

  admitInput(bytes: number): void {
    this.context.signal.throwIfAborted();
    if (bytes > this.limits.maxInputBytes - this.inputBytes) throw new FsError("EFBIG", { message: "sort input byte limit exceeded" });
    this.inputBytes += bytes;
  }

  admitRecord(length: number): void {
    this.context.signal.throwIfAborted();
    if (this.inputRecords >= this.limits.maxRecords) throw new FsError("EFBIG", { message: "sort input record limit exceeded" });
    this.admission.admit(length);
    this.inputRecords++;
  }

  close(): Promise<void> {
    this.controller.abort(new FsError("ECANCELED"));
    return this.closing ??= (async () => {
      const results = await Promise.allSettled([...this.readers].map(close => close()).concat([...this.stores].map(store => store.close())));
      this.stores.clear();
      const failed = results.find(result => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
    })();
  }
}

/** A record owns either a small array or a caller-backed region. No record-size
 * cutoff is needed by the reader, run store, merge heap or output writer. */
export class SortRecord {
  private released = false;
  private closing: Promise<void> | undefined;
  constructor(
    readonly length: number,
    readonly bytes: Uint8Array | undefined,
    readonly storage: PagedStorage | undefined,
    readonly offset: number,
    readonly node = 0,
    private readonly retire?: () => Promise<void> | void,
  ) {}

  async read(offset: number, length: number): Promise<Uint8Array> {
    if (this.released) throw new FsError("EBADF");
    const count = Math.min(length, this.length - offset, 16 * 1024);
    if (offset < 0 || count < 0) throw new RangeError("Invalid sort record range");
    return this.bytes ? this.bytes.subarray(offset, offset + count) : this.storage!.read(this.offset + offset, count);
  }

  async *chunks(): ByteSource {
    for (let offset = 0; offset < this.length; offset += 16 * 1024) yield await this.read(offset, 16 * 1024);
  }

  async materialize(): Promise<Uint8Array> {
    if (this.bytes) return this.bytes;
    const result = new Uint8Array(this.length);
    let offset = 0;
    for await (const chunk of this.chunks()) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.released = true;
    return this.closing = Promise.resolve().then(() => this.retire?.());
  }
}

export async function* readRecords(source: ByteSource, delimiter: number, resources: SortStorage): AsyncGenerator<SortRecord> {
  const { iterator, close } = resources.reader(source);
  let buffer: Uint8Array | undefined;
  let length = 0;
  let store: PagedStorage | undefined;
  let offset = 0;
  let failed = false;
  const append = async (bytes: Uint8Array): Promise<void> => {
    if (!bytes.length) return;
    if (!store && bytes.length <= resources.recordBytes - length) {
      buffer ??= new Uint8Array(resources.recordBytes);
      buffer.set(bytes, length);
    } else {
      if (!store) {
        store = resources.acquire();
        offset = store.allocate(0);
        if (length) await store.append(buffer!.subarray(0, length));
        buffer = undefined;
      }
      // PagedStorage copies before resolving; reusable producer bytes never escape.
      await store.append(bytes);
    }
    length += bytes.length;
  };
  const finish = (admitted = false, complete?: Uint8Array): SortRecord => {
    if (!admitted) resources.admitRecord(length);
    const owned = store;
    const size = length;
    const bytes = owned ? undefined : new Uint8Array(size);
    if (bytes && size) bytes.set(complete ?? buffer!.subarray(0, size));
    const record = new SortRecord(size, bytes, owned, offset, 0, async () => {
      resources.admission.release(size);
      if (owned) await resources.release(owned);
    });
    buffer = undefined; store = undefined; length = 0;
    return record;
  };
  try {
    while (true) {
      resources.context.signal.throwIfAborted();
      const next = await iterator.next();
      if (next.done) break;
      const chunk = next.value;
      resources.admitInput(chunk.length);
      await resources.work.charge(chunk.length);
      let start = 0;
      while (start < chunk.length) {
        const end = chunk.indexOf(delimiter, start);
        if (end < 0) { await append(chunk.subarray(start)); break; }
        resources.admitRecord(length + end - start);
        if (!length && end - start <= resources.recordBytes) {
          length = end - start;
          yield finish(true, chunk.subarray(start, end));
        } else {
          await append(chunk.subarray(start, end));
          yield finish(true);
        }
        start = end + 1;
      }
    }
    resources.context.signal.throwIfAborted();
    if (length) yield finish();
  } catch (error) { failed = true; throw error;
  } finally {
    await Promise.allSettled([
      close(),
      ...(store ? [resources.release(store)] : []),
    ]).then(results => {
      const failure = results.find(result => result.status === "rejected");
      if (!failed && failure?.status === "rejected") throw failure.reason;
    });
  }
}
