import type { ArchiveMetadataFactory, ArchiveMetadataSpool, ArchiveReadSource } from "./metadata-types.js";
export type { ArchiveMetadataFactory, ArchiveMetadataSpool, ArchiveReadSource } from "./metadata-types.js";
import { fail } from "./internal.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

const pendingByteWindow = 128 * 1024;

// Conservative retained-object estimate; payload serialization is only done on spill.
function retainedBytes(value: unknown): number {
  if (typeof value === "string") return 24 + value.length * 2;
  if (value instanceof Uint8Array) return 64 + value.byteLength;
  if (value instanceof Date) return 32;
  if (Array.isArray(value)) return 32 + value.reduce((size, item) => size + 8 + retainedBytes(item), 0);
  if (value !== null && typeof value === "object") {
    let size = 64;
    for (const [key, item] of Object.entries(value)) size += 32 + key.length * 2 + retainedBytes(item);
    return size;
  }
  return 8;
}

// Tagged containers preserve dates, bytes and undefined without reserved user keys.
function pack(value: unknown): unknown {
  if (value instanceof Uint8Array) return ["bytes", [...value]];
  if (value instanceof Date) return ["date", value.getTime()];
  if (value === undefined) return ["undefined"];
  if (Array.isArray(value)) return ["array", value.map(pack)];
  if (value !== null && typeof value === "object") return ["object", Object.entries(value).map(([key, item]) => [key, pack(item)])];
  if (typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") fail("ZIP metadata must be serializable");
  return value;
}
function unpack(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  const [type, body] = value;
  if (type === "bytes") return Uint8Array.from(body);
  if (type === "date") return new Date(body);
  if (type === "undefined") return undefined;
  if (type === "array") return body.map(unpack);
  if (type === "object") return Object.fromEntries(body.map(([key, item]: [string, unknown]) => [key, unpack(item)]));
  fail("ZIP invalid staged metadata");
}
interface RecordValue<T> { key: string; value?: T | undefined; deleted: boolean }
interface Run<T> {
  count: number;
  data: ArchiveReadSource;
  index: ArchiveReadSource;
  close(): Promise<void>;
  get(index: number): Promise<RecordValue<T>>;
}

/** Immutable sorted runs, a fixed pending window, and at most 53 occupied levels. */
class Records<T> {
  private readonly pending = new Map<string, RecordValue<T>>();
  private readonly levels: Array<Run<T> | undefined> = [];
  private pendingBytes = 0;
  constructor(private readonly factory: ArchiveMetadataFactory, private readonly signal: AbortSignal, private readonly window: number) {}
  async get(key: string): Promise<RecordValue<T> | undefined> {
    this.signal.throwIfAborted();
    const pending = this.pending.get(key);
    if (pending) return pending;
    for (const run of this.levels) {
      if (!run) continue;
      let low = 0, high = run.count;
      while (low < high) {
        const middle = Math.floor((low + high) / 2);
        const item = await run.get(middle);
        if (item.key === key) return item;
        if (item.key < key) low = middle + 1;
        else high = middle;
      }
    }
    return undefined;
  }
  async put(key: string, value: T | undefined, deleted = false): Promise<void> {
    this.signal.throwIfAborted();
    const record = { key, value, deleted };
    const bytes = retainedBytes(record);
    const prior = this.pending.get(key);
    const previousBytes = prior === undefined ? 0 : retainedBytes(prior);
    if (this.pending.size && bytes > pendingByteWindow - (this.pendingBytes - previousBytes)) await this.flush();
    else this.pendingBytes -= previousBytes;
    this.pending.set(key, record);
    this.pendingBytes += bytes;
    if (this.pending.size >= this.window || this.pendingBytes >= pendingByteWindow) await this.flush();
  }
  private async run(records: AsyncIterable<RecordValue<T>>): Promise<Run<T>> {
    const owned: ArchiveMetadataSpool[] = [];
    let closing: Promise<void> | undefined;
    const close = () => closing ??= Promise.all(owned.map(spool => spool.close())).then(() => {});
    try {
      const dataSpool = await this.factory(); owned.push(dataSpool);
      const indexSpool = await this.factory(); owned.push(indexSpool);
      let count = 0, size = 0;
      for await (const record of records) {
        this.signal.throwIfAborted();
        const bytes = encoder.encode(JSON.stringify(pack(record)));
        const pointer = new Uint8Array(16);
        const view = new DataView(pointer.buffer);
        view.setBigUint64(0, BigInt(size), true);
        view.setBigUint64(8, BigInt(bytes.length), true);
        await indexSpool.append(pointer);
        for (let offset = 0; offset < bytes.length; offset += 65536) await dataSpool.append(bytes.subarray(offset, offset + 65536));
        size += bytes.length; count++;
        if (!Number.isSafeInteger(size) || !Number.isSafeInteger(count)) fail("ZIP metadata index overflow");
      }
      const data = await dataSpool.finish(), index = await indexSpool.finish();
      return { count, data, index, close, get: async ordinal => {
        this.signal.throwIfAborted();
        if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= count) fail("ZIP metadata ordinal out of range");
        const bytes = await exact(index, ordinal * 16, 16);
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const offset = Number(view.getBigUint64(0, true)), length = Number(view.getBigUint64(8, true));
        return unpack(JSON.parse(decoder.decode(await exact(data, offset, length)))) as RecordValue<T>;
      } };
    } catch (error) { await close(); throw error; }
  }
  private async flush(): Promise<void> {
    if (!this.pending.size) return;
    const records = [...this.pending.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    let run = await this.run((async function* () { yield* records; })());
    this.pending.clear();
    this.pendingBytes = 0;
    try {
      for (let level = 0; ; level++) {
        const prior = this.levels[level];
        if (!prior) { this.levels[level] = run; return; }
        const fresh = run;
        const merged = await this.run((async function* () {
          let a = 0, b = 0;
          let left = a < fresh.count ? await fresh.get(a++) : undefined;
          let right = b < prior.count ? await prior.get(b++) : undefined;
          while (left || right) {
            if (left && (!right || left.key <= right.key)) {
              const same = left.key === right?.key;
              yield left;
              left = a < fresh.count ? await fresh.get(a++) : undefined;
              if (same) right = b < prior.count ? await prior.get(b++) : undefined;
            } else {
              yield right!;
              right = b < prior.count ? await prior.get(b++) : undefined;
            }
          }
        })());
        this.levels[level] = undefined;
        await Promise.all([run.close(), prior.close()]);
        run = merged;
      }
    } catch (error) { await run.close(); throw error; }
  }
  async *entries(): AsyncIterable<RecordValue<T>> {
    await this.flush();
    const cursors = this.levels.flatMap(run => run ? [{ run, ordinal: 0, item: undefined as RecordValue<T> | undefined }] : []);
    for (const cursor of cursors) if (cursor.run.count) cursor.item = await cursor.run.get(cursor.ordinal++);
    for (;;) {
      this.signal.throwIfAborted();
      let chosen: typeof cursors[number] | undefined;
      for (const cursor of cursors) if (cursor.item && (!chosen || cursor.item.key < chosen.item!.key)) chosen = cursor;
      if (!chosen) return;
      const record = chosen.item!;
      for (const cursor of cursors) if (cursor.item?.key === record.key) cursor.item = cursor.ordinal < cursor.run.count ? await cursor.run.get(cursor.ordinal++) : undefined;
      if (!record.deleted) yield record;
    }
  }
  async close(): Promise<void> {
    this.pending.clear();
    this.pendingBytes = 0;
    const runs = this.levels.splice(0);
    await Promise.all(runs.map(run => run?.close()));
  }
}

async function exact(source: ArchiveReadSource, offset: number, length: number): Promise<Uint8Array> {
  if (!Number.isSafeInteger(offset + length) || offset < 0 || length < 0 || offset + length > source.size) fail("ZIP truncated staged metadata");
  const result = new Uint8Array(length);
  for (let done = 0; done < length;) {
    const bytes = await source.read(offset + done, Math.min(65536, length - done));
    if (!bytes.length || bytes.length > length - done) fail("ZIP truncated staged metadata");
    result.set(bytes, done); done += bytes.length;
  }
  return result;
}

/** Map insertion order and replacement semantics backed by bounded sorted runs. */
export class ArchiveMetadataMap<T> {
  private readonly keys: Records<{ ordinal: number; value: T }>;
  private readonly order: Records<string>;
  private ordinal = 0;
  private count = 0;
  constructor(factory: ArchiveMetadataFactory, signal: AbortSignal, window = 64) {
    if (!Number.isSafeInteger(window) || window < 1 || window > 1024) fail("ZIP invalid metadata window");
    this.keys = new Records(factory, signal, window);
    this.order = new Records(factory, signal, window);
  }
  get size(): number { return this.count; }
  async get(key: string): Promise<T | undefined> { const record = await this.keys.get(key); return record?.deleted ? undefined : record?.value?.value; }
  async has(key: string): Promise<boolean> { const record = await this.keys.get(key); return record !== undefined && !record.deleted; }
  async set(key: string, value: T): Promise<void> {
    const prior = await this.keys.get(key);
    const ordinal = prior && !prior.deleted ? prior.value!.ordinal : this.ordinal++;
    if (!Number.isSafeInteger(this.ordinal)) fail("ZIP metadata insertion count overflow");
    if (!prior || prior.deleted) { this.count++; await this.order.put(String(ordinal).padStart(16, "0"), key); }
    await this.keys.put(key, { ordinal, value });
  }
  async delete(key: string): Promise<boolean> {
    const prior = await this.keys.get(key);
    if (!prior || prior.deleted) return false;
    await this.keys.put(key, undefined, true);
    await this.order.put(String(prior.value!.ordinal).padStart(16, "0"), undefined, true);
    this.count--; return true;
  }
  async *entries(): AsyncIterable<[string, T]> {
    for await (const record of this.order.entries()) {
      const value = await this.keys.get(record.value!);
      if (value && !value.deleted) yield [record.value!, value.value!.value];
    }
  }
  async *sortedEntries(): AsyncIterable<[string, T]> {
    for await (const record of this.keys.entries()) yield [record.key, record.value!.value];
  }
  async *values(): AsyncIterable<T> { for await (const [, value] of this.entries()) yield value; }
  async close(): Promise<void> { await Promise.all([this.keys.close(), this.order.close()]); }
}
