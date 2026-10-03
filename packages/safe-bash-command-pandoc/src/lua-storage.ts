import {PandocError} from "./errors.js";
import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";

export type LuaReference = {readonly kind: "string" | "table" | "function"; readonly id: number};
export type LuaInteger = {readonly kind: "integer"; readonly value: number};
export type StoredLuaValue = undefined | boolean | number | LuaInteger | LuaReference;
const tags = ["nil", "boolean", "number", "string", "table", "function", "integer"] as const;

function encode(value: StoredLuaValue): Uint8Array {
  if (typeof value === "object" && value.kind === "integer" && (value.value | 0) !== value.value)
    throw new TypeError("Lua integer must fit signed 32 bits");
  const bytes = new Uint8Array(16), view = new DataView(bytes.buffer);
  const tag = value === undefined ? 0 : typeof value === "boolean" ? 1 : typeof value === "number" ? 2 : tags.indexOf(value.kind);
  view.setFloat64(0, tag, true);
  view.setFloat64(8, value === undefined ? 0 : typeof value === "object" ? value.kind === "integer" ? value.value | 0 : value.id : Number(value), true);
  return bytes;
}
function decode(bytes: Uint8Array): StoredLuaValue {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  const tag = view.getFloat64(0, true), value = view.getFloat64(8, true);
  if (!tag) return undefined;
  if (tag === 1) return Boolean(value);
  if (tag === 2) return value;
  if (tag === 6) return {kind: "integer", value};
  return {kind: tag === 3 ? "string" : tag === 4 ? "table" : "function", id: value};
}
function hash(bytes: Uint8Array, initial = 2166136261): number {
  let value = initial;
  for (const byte of bytes) value = Math.imul(value ^ byte, 16777619) >>> 0;
  return value;
}

/** Invocation-owned Lua value storage. Strings are byte sequences; tables retain
 * their indexes, values and iteration links in the supplied storage. Only a fixed
 * 64-entry radix cache and current I/O slices are resident. Callers serialize heap
 * mutations and close the supplied storage on every outcome. This is the storage
 * layer for a retained runtime, not an adapter that makes Fengari's objects spill. */
export class LuaStorage {
  private readonly buckets: IntegerTable;
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.buckets = new IntegerTable(storage, 64);
  }
  private async fields(position: number, count: number): Promise<number[]> {
    const bytes = await this.storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async put(position: number, ...values: number[]): Promise<void> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat64(index * 8, value, true));
    await this.storage.write(position, bytes);
  }

  async string(source: Iterable<Uint8Array> | AsyncIterable<Uint8Array>): Promise<LuaReference> {
    const iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
    let exhausted = false;
    let failure: {reason: unknown} | undefined, result: LuaReference | undefined;
    try {
      const id = this.storage.allocate(32);
      let length = 0, first = 0, last = 0, digest = 2166136261;
      while (true) {
        const next = await iterator.next();
        if (next.done) {exhausted = true; break;}
        const chunk = next.value;
        if (!(chunk instanceof Uint8Array)) throw new TypeError("Lua string source must yield bytes");
        if (!chunk.length) await this.cooperate(1);
        for (let offset = 0; offset < chunk.length; offset += 8192) {
          const bytes = chunk.subarray(offset, offset + 8192);
          const position = this.storage.allocate(16 + bytes.length);
          await this.put(position, 0, bytes.length);
          await this.storage.write(position + 16, bytes);
          if (last) await this.put(last, position);
          else first = position;
          last = position;
          length += bytes.length;
          digest = hash(bytes, digest);
          await this.cooperate(bytes.length);
        }
      }
      await this.put(id, length, first, last, digest);
      result = {kind: "string", id};
    } catch (reason) {failure = {reason};}
    if (!exhausted) {
      try {await iterator.return?.();}
      catch (reason) {failure ??= {reason};}
    }
    if (failure) throw failure.reason;
    return result!;
  }

  async byteLength(value: LuaReference): Promise<number> {
    if (value.kind !== "string") throw new TypeError("Expected Lua string");
    return (await this.fields(value.id, 1))[0]!;
  }
  async *bytes(value: LuaReference): AsyncGenerator<Uint8Array> {
    if (value.kind !== "string") throw new TypeError("Expected Lua string");
    let position = (await this.fields(value.id + 8, 1))[0]!;
    while (position) {
      const [next, length] = await this.fields(position, 2);
      const bytes = await this.storage.read(position + 16, length!);
      await this.cooperate(bytes.length);
      yield bytes;
      position = next!;
    }
  }
  async table(): Promise<LuaReference> {
    const id = this.storage.allocate(24);
    await this.put(id, 0, 0, 0);
    return {kind: "table", id};
  }
  async metatable(table: LuaReference): Promise<LuaReference | undefined> {
    if (table.kind !== "table") throw new TypeError("Expected Lua table");
    const id = (await this.fields(table.id + 16, 1))[0]!;
    return id ? {kind: "table", id} : undefined;
  }
  async setMetatable(table: LuaReference, value: LuaReference | undefined): Promise<void> {
    if (table.kind !== "table" || value && value.kind !== "table") throw new TypeError("Expected Lua table");
    await this.put(table.id + 16, value?.id ?? 0);
  }
  /** Cells have stable identity. Closing a scope detaches its registers from
   * captured cells; closures keep the old cells and continue sharing mutations. */
  async cell(value?: StoredLuaValue): Promise<number> {
    return this.storage.append(encode(value));
  }
  async value(cell: number): Promise<StoredLuaValue> {
    return decode(await this.storage.read(cell, 16));
  }
  async assign(cell: number, value: StoredLuaValue): Promise<void> {
    await this.storage.write(cell, encode(value));
  }
  async closure(prototype: number, captures: Iterable<number> | AsyncIterable<number>): Promise<LuaReference> {
    const upvalues = await this.table();
    let count = 0;
    for await (const cell of captures) {
      await this.set(upvalues, count++, cell);
    }
    const id = this.storage.allocate(16);
    await this.put(id, prototype, upvalues.id);
    return {kind: "function", id};
  }
  async prototype(closure: LuaReference): Promise<number> {
    if (closure.kind !== "function") throw new TypeError("Expected Lua function");
    return (await this.fields(closure.id, 1))[0]!;
  }
  async capture(closure: LuaReference, index: number): Promise<number | undefined> {
    if (closure.kind !== "function") throw new TypeError("Expected Lua function");
    const id = (await this.fields(closure.id + 8, 1))[0]!;
    return await this.get({kind: "table", id}, index) as number | undefined;
  }
  async equal(a: StoredLuaValue, b: StoredLuaValue): Promise<boolean> {
    if (typeof a === "object" && a.kind === "integer") a = a.value;
    if (typeof b === "object" && b.kind === "integer") b = b.value;
    if (typeof a !== "object" || typeof b !== "object") return a === b;
    if (a.kind !== b.kind) return false;
    if (a.id === b.id) return true;
    if (a.kind !== "string") return false;
    if (await this.byteLength(a) !== await this.byteLength(b)) return false;
    const right = this.bytes(b);
    let bytes: Uint8Array = new Uint8Array(0);
    let offset = 0;
    try {
      for await (const left of this.bytes(a)) {
        for (const byte of left) {
          if (offset === bytes.length) {bytes = (await right.next()).value!; offset = 0;}
          if (byte !== bytes[offset++]) return false;
        }
      }
      return true;
    } finally {await right.return(undefined);}
  }
  private async bucket(table: LuaReference, key: StoredLuaValue): Promise<bigint> {
    if (table.kind !== "table") throw new TypeError("Expected Lua table");
    if (typeof key === "object" && key.kind === "integer") key = key.value;
    const digest = typeof key === "object" && key.kind === "string"
      ? (await this.fields(key.id + 24, 1))[0]!
      : hash(encode(typeof key === "number" && key === 0 ? 0 : key));
    return BigInt(hash(encode(table))) << 32n | BigInt(digest);
  }
  private async find(table: LuaReference, key: StoredLuaValue, bucket: bigint): Promise<number> {
    let position = Number(await this.buckets.get(bucket) ?? 0n);
    while (position) {
      await this.cooperate(56);
      const [owner, next] = await this.fields(position, 2);
      if (owner === table.id && await this.equal(key, decode(await this.storage.read(position + 24, 16)))) return position;
      position = next!;
    }
    return 0;
  }
  async get(table: LuaReference, key: StoredLuaValue): Promise<StoredLuaValue> {
    if (key === undefined || typeof key === "number" && Number.isNaN(key)) return undefined;
    const position = await this.find(table, key, await this.bucket(table, key));
    return position ? decode(await this.storage.read(position + 40, 16)) : undefined;
  }
  async set(table: LuaReference, key: StoredLuaValue, value: StoredLuaValue): Promise<void> {
    if (key === undefined) throw new PandocError("E_AST", "convert", "Table index is nil");
    if (typeof key === "number" && Number.isNaN(key)) throw new PandocError("E_AST", "convert", "Table index is NaN");
    await this.cooperate();
    const bucket = await this.bucket(table, key);
    let position = await this.find(table, key, bucket);
    if (!position) {
      if (value === undefined) return;
      position = this.storage.allocate(56);
      await this.put(position, table.id, Number(await this.buckets.get(bucket) ?? 0n), 0);
      await this.storage.write(position + 24, encode(key));
      const [first, last] = await this.fields(table.id, 2);
      if (last) await this.put(last + 16, position);
      await this.put(table.id, first || position, position);
      await this.buckets.set(bucket, BigInt(position));
    }
    await this.storage.write(position + 40, encode(value));
  }
  /** Deletion retains the iteration cursor, matching next(t, deletedKey). */
  async next(table: LuaReference, after?: StoredLuaValue): Promise<{key: StoredLuaValue; value: StoredLuaValue} | undefined> {
    if (table.kind !== "table") throw new TypeError("Expected Lua table");
    let position: number;
    if (after === undefined) position = (await this.fields(table.id, 1))[0]!;
    else {
      const previous = await this.find(table, after, await this.bucket(table, after));
      if (!previous) throw new PandocError("E_AST", "convert", "Invalid key to next");
      position = (await this.fields(previous + 16, 1))[0]!;
    }
    while (position) {
      await this.cooperate(56);
      const value = decode(await this.storage.read(position + 40, 16));
      if (value !== undefined) return {key: decode(await this.storage.read(position + 24, 16)), value};
      position = (await this.fields(position + 16, 1))[0]!;
    }
    return undefined;
  }
  /** Lua permits any boundary for a table with holes. Find one without retaining
   * an array or scanning unrelated hash keys. Dense arrays return their length. */
  async length(table: LuaReference): Promise<number> {
    let lower = 0, upper = 1;
    while (await this.get(table, upper) !== undefined) {
      lower = upper;
      if (upper === Number.MAX_SAFE_INTEGER) return upper;
      upper = Math.min(Number.MAX_SAFE_INTEGER, upper * 2);
    }
    while (upper - lower > 1) {
      const middle = lower + Math.floor((upper - lower) / 2);
      if (await this.get(table, middle) === undefined) upper = middle;
      else lower = middle;
    }
    return lower;
  }
}
