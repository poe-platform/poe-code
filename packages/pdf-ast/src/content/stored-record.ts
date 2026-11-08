import type { PdfPixelStorage } from "../ast.js";

// Private, ephemeral capture format. Tags cannot collide with PDF dictionary keys.
const enum Tag {
  Null,
  False,
  True,
  Number,
  String,
  Bytes,
  Storage,
  Array,
  Object,
  End
}

/** Walk twice (size, then write), retaining only nesting state and one byte chunk.
 * In particular, byte strings never become JSON number arrays or escaped text. */
function* encodeParts(
  value: unknown,
  storage: PdfPixelStorage,
  key: string,
  ancestors: WeakSet<object>
): Generator<Uint8Array | { value: unknown; key: string }, void, void> {
  if (key === "storage") {
    if (value !== storage) throw new TypeError("Captured resources must share caller backing");
    yield Uint8Array.of(Tag.Storage);
    return;
  }
  if (
    value == null ||
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    yield Uint8Array.of(Tag.Null);
    return;
  }
  if (typeof value === "boolean") {
    yield Uint8Array.of(value ? Tag.True : Tag.False);
    return;
  }
  if (
    typeof value === "number" ||
    typeof value === "string" ||
    value instanceof Uint8Array ||
    Array.isArray(value)
  ) {
    const header = new Uint8Array(9);
    header[0] =
      typeof value === "number"
        ? Tag.Number
        : typeof value === "string"
          ? Tag.String
          : value instanceof Uint8Array
            ? Tag.Bytes
            : Tag.Array;
    new DataView(header.buffer).setFloat64(
      1,
      typeof value === "number" ? value : value.length,
      true
    );
    yield header;
    if (typeof value === "number") return;
    if (typeof value === "string") {
      const bytes = new Uint8Array(Math.min(4096, value.length * 2)),
        view = new DataView(bytes.buffer);
      for (let offset = 0; offset < value.length; offset += 2048) {
        const count = Math.min(2048, value.length - offset);
        for (let i = 0; i < count; i++) view.setUint16(i * 2, value.charCodeAt(offset + i), true);
        yield bytes.subarray(0, count * 2);
      }
      return;
    }
    if (value instanceof Uint8Array) {
      for (let offset = 0; offset < value.length; offset += 4096)
        yield value.subarray(offset, offset + 4096);
      return;
    }
  }
  if (typeof value !== "object") throw new TypeError("Unsupported capture value");
  if (ancestors.has(value)) throw new TypeError("Cyclic capture value");
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      for (const item of value) yield { value: item, key: "" };
    } else {
      yield Uint8Array.of(Tag.Object);
      for (const name in value) {
        if (!Object.hasOwn(value, name)) continue;
        const item = (value as Record<string, unknown>)[name];
        if (
          name !== "storage" &&
          (item === undefined || typeof item === "function" || typeof item === "symbol")
        )
          continue;
        yield { value: name, key: "" };
        yield { value: item, key: name };
      }
      yield Uint8Array.of(Tag.End);
    }
  } finally {
    ancestors.delete(value);
  }
}

/** Visit each part once instead of forwarding every chunk through all ancestor
 * generators. Container iterators retain traversal state, not copies. */
function* encode(value: unknown, storage: PdfPixelStorage): Generator<Uint8Array> {
  const ancestors = new WeakSet<object>();
  const frames = [encodeParts(value, storage, "", ancestors)];
  try {
    while (frames.length) {
      const step = frames[frames.length - 1]!.next();
      if (step.done) { frames.pop(); continue; }
      if (step.value instanceof Uint8Array) yield step.value;
      else frames.push(encodeParts(step.value.value, storage, step.value.key, ancestors));
    }
  } finally {
    while (frames.length) frames.pop()!.return();
  }
}

/** Serialize directly to caller backing with fixed-size scratch. The input and
 * decoded value still belong to the caller; neither has a second full text copy. */
export async function writeStoredRecord(
  storage: PdfPixelStorage,
  value: unknown,
  next = -1,
  signal?: AbortSignal
): Promise<number> {
  signal?.throwIfAborted();
  let length = 0, work = 0;
  for (const bytes of encode(value, storage)) {
    // Resolved capability promises alone do not let abort timers run.
    work += bytes.length;
    if (work >= 65536) { await new Promise<void>(resolve => setTimeout(resolve, 0)); work = 0; }
    signal?.throwIfAborted();
    length += bytes.length;
    if (!Number.isSafeInteger(length + 16)) throw new RangeError("Invalid capture length");
  }
  const position = storage.allocate(16 + length);
  if (
    !Number.isSafeInteger(position) ||
    position < 0 ||
    !Number.isSafeInteger(position + 16 + length)
  )
    throw new RangeError("Invalid capture allocation");
  const bytes = new Uint8Array(4096),
    view = new DataView(bytes.buffer);
  view.setFloat64(0, next, true);
  view.setFloat64(8, length, true);
  let used = 16,
    offset = 0;
  work = 0;
  for (const chunk of encode(value, storage)) {
    work += chunk.length;
    if (work >= 65536) { await new Promise<void>(resolve => setTimeout(resolve, 0)); work = 0; }
    signal?.throwIfAborted();
    for (let at = 0; at < chunk.length; ) {
      const count = Math.min(bytes.length - used, chunk.length - at);
      bytes.set(chunk.subarray(at, at + count), used);
      used += count;
      at += count;
      if (used === bytes.length) {
        if (offset + used > 16 + length)
          throw new Error("Capture value changed during serialization");
        await storage.write(position + offset, bytes, signal ? { signal } : undefined);
        signal?.throwIfAborted();
        offset += used;
        used = 0;
      }
    }
  }
  if (offset + used !== 16 + length) throw new Error("Capture value changed during serialization");
  if (used)
    await storage.write(
      position + offset,
      bytes.subarray(0, used),
      signal ? { signal } : undefined
    );
  signal?.throwIfAborted();
  return position;
}

class RecordReader {
  private bytes: Uint8Array = new Uint8Array();
  private offset = 0;
  private loaded = 0;
  private work = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly position: number,
    private readonly length: number,
    private readonly signal?: AbortSignal
  ) {}
  get remaining(): number {
    return this.length - this.loaded + this.bytes.length - this.offset;
  }
  async take(length: number): Promise<Uint8Array> {
    if (this.work >= 65536) {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.work = 0;
    }
    this.signal?.throwIfAborted();
    if (!Number.isSafeInteger(length) || length < 0 || length > 4096 || length > this.remaining)
      throw new Error("Invalid capture field length");
    this.work += length;
    if (this.offset + length <= this.bytes.length) {
      const result = this.bytes.subarray(this.offset, this.offset + length);
      this.offset += length;
      return result;
    }
    const result = new Uint8Array(length);
    for (let at = 0; at < length; ) {
      if (this.offset === this.bytes.length) {
        const count = Math.min(4096, this.length - this.loaded);
        const bytes = await this.storage.read(
          this.position + this.loaded,
          count,
          this.signal ? { signal: this.signal } : undefined
        );
        this.signal?.throwIfAborted();
        if (bytes.length !== count) throw new Error("Incomplete capture record");
        this.bytes = bytes.slice();
        this.loaded += count;
        this.offset = 0;
      }
      const count = Math.min(length - at, this.bytes.length - this.offset);
      result.set(this.bytes.subarray(this.offset, this.offset + count), at);
      this.offset += count;
      at += count;
    }
    return result;
  }
  private async size(tag: number): Promise<number> {
    const bytes = await this.take(8);
    const size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    if (!Number.isSafeInteger(size) || size < 0 || size > this.remaining ||
        (tag === Tag.String && size * 2 > this.remaining)) throw new Error("Invalid capture field length");
    return size;
  }
  private async discard(length: number): Promise<void> {
    while (length) { const count = Math.min(length, 4096); await this.take(count); length -= count; }
  }
  private async stringEquals(expected: string): Promise<boolean> {
    const length = await this.size(Tag.String);
    let equal = length === expected.length;
    for (let at = 0; at < length; at += 2048) {
      const bytes = await this.take(Math.min(2048, length - at) * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if (equal) for (let i = 0; i < bytes.length / 2; i++) {
        if (view.getUint16(i * 2, true) !== expected.charCodeAt(at + i)) { equal = false; break; }
      }
    }
    return equal;
  }

  /** Skip without constructing arrays, strings or byte payloads. Only 32
   * container counters stay resident; deeper counters use caller backing. */
  private async skip(tag?: number): Promise<void> {
    const frames: number[] = [];
    const spilled = new StoredMetadataStack<number>(this.storage, this.signal);
    let remaining = 1;
    for (;;) {
      if (remaining === 0) {
        const parent = frames.pop() ?? await spilled.pop();
        if (parent === undefined) return;
        remaining = parent;
        continue;
      }
      if (remaining === -1) {
        const field = (await this.take(1))[0];
        if (field === Tag.End) { remaining = 0; continue; }
        if (field !== Tag.String) throw new Error("Invalid capture key");
        await this.discard((await this.size(Tag.String)) * 2);
      } else remaining--;
      const current = tag ?? (await this.take(1))[0];
      tag = undefined;
      if (current === Tag.Object || current === Tag.Array) {
        const children = current === Tag.Object ? -1 : await this.size(Tag.Array);
        if (frames.length === 32) await spilled.push(frames.shift()!);
        frames.push(remaining);
        remaining = children;
      } else if (current === Tag.String || current === Tag.Bytes) {
        await this.discard((await this.size(current)) * (current === Tag.String ? 2 : 1));
      } else if (current === Tag.Number) await this.take(8);
      else if (current !== Tag.Null && current !== Tag.False && current !== Tag.True && current !== Tag.Storage) {
        throw new Error("Invalid capture tag");
      }
    }
  }

  async matches(path: readonly string[], expected: string, depth = 0): Promise<boolean> {
    const tag = (await this.take(1))[0];
    if (depth === path.length && tag === Tag.String) return this.stringEquals(expected);
    if (depth === path.length || tag !== Tag.Object) { await this.skip(tag); return false; }
    let matched = false;
    for (;;) {
      const field = (await this.take(1))[0];
      if (field === Tag.End) return matched;
      if (field !== Tag.String) throw new Error("Invalid capture key");
      if (await this.stringEquals(path[depth]!)) matched = await this.matches(path, expected, depth + 1);
      else await this.skip();
    }
  }

  async value(tag?: number): Promise<unknown> {
    tag ??= (await this.take(1))[0];
    if (tag === Tag.Null) return null;
    if (tag === Tag.False) return false;
    if (tag === Tag.True) return true;
    if (tag === Tag.Storage) return this.storage;
    if (tag === Tag.Object) {
      const value: Record<string, unknown> = {};
      for (;;) {
        const field = (await this.take(1))[0];
        if (field === Tag.End) return value;
        if (field !== Tag.String) throw new Error("Invalid capture key");
        const key = (await this.value(field)) as string;
        Object.defineProperty(value, key, {
          value: await this.value(),
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    }
    if (tag !== Tag.Number && tag !== Tag.String && tag !== Tag.Bytes && tag !== Tag.Array)
      throw new Error("Invalid capture tag");
    const bytes = await this.take(8),
      size = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(0, true);
    if (tag === Tag.Number) return size;
    if (
      !Number.isSafeInteger(size) ||
      size < 0 ||
      size > this.remaining ||
      (tag === Tag.String && size * 2 > this.remaining)
    )
      throw new Error("Invalid capture field length");
    if (tag === Tag.Array) {
      const value: unknown[] = [];
      for (let i = 0; i < size; i++) value.push(await this.value());
      return value;
    }
    if (tag === Tag.Bytes) {
      const value = new Uint8Array(size);
      for (let offset = 0; offset < size; offset += 4096)
        value.set(await this.take(Math.min(4096, size - offset)), offset);
      return value;
    }
    let value = "";
    for (let offset = 0; offset < size; offset += 2048) {
      const bytes = await this.take(Math.min(2048, size - offset) * 2),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      let part = "";
      for (let at = 0; at < bytes.length; at += 2)
        part += String.fromCharCode(view.getUint16(at, true));
      value += part;
    }
    return value;
  }
}

async function openStoredRecord(
  storage: PdfPixelStorage,
  position: number,
  signal?: AbortSignal
): Promise<{ reader: RecordReader; next: number }> {
  signal?.throwIfAborted();
  if (!Number.isSafeInteger(position) || position < 0)
    throw new RangeError("Invalid capture position");
  const header = await storage.read(position, 16, signal ? { signal } : undefined);
  signal?.throwIfAborted();
  if (header.length !== 16) throw new Error("Incomplete capture header");
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength),
    next = view.getFloat64(0, true),
    length = view.getFloat64(8, true);
  if (!Number.isSafeInteger(length) || length < 1 || !Number.isSafeInteger(position + 16 + length))
    throw new RangeError("Invalid capture length");
  return {reader: new RecordReader(storage, position + 16, length, signal), next};
}

export async function readStoredRecord<T>(storage: PdfPixelStorage, position: number, signal?: AbortSignal): Promise<{value: T; next: number}> {
  const {reader, next} = await openStoredRecord(storage, position, signal);
  const value = (await reader.value()) as T;
  if (reader.remaining) throw new Error("Trailing capture bytes");
  signal?.throwIfAborted();
  return { value, next };
}

/** Compare one string property without decoding the rest of a record.
 * Paths are caller-defined; input-controlled nesting is skipped with bounded scratch. */
export async function storedRecordMatches(storage: PdfPixelStorage, position: number, path: readonly string[], expected: string, signal?: AbortSignal): Promise<{matched: boolean; next: number}> {
  const {reader, next} = await openStoredRecord(storage, position, signal);
  const matched = await reader.matches(path, expected);
  if (reader.remaining) throw new Error("Trailing capture bytes");
  signal?.throwIfAborted();
  return {matched, next};
}

/** Persistent linked frames; only the frame currently being read is resident. */
export class StoredMetadataStack<T> {
  private head = -1;
  private count = 0;
  constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {}
  get length(): number {
    return this.count;
  }
  async push(value: T): Promise<void> {
    const position = await writeStoredRecord(this.storage, value, this.head, this.signal);
    this.head = position;
    this.count++;
  }
  async pop(): Promise<T | undefined> {
    this.signal?.throwIfAborted();
    if (!this.count) return undefined;
    const record = await readStoredRecord<T>(this.storage, this.head, this.signal);
    this.head = record.next;
    this.count--;
    return record.value;
  }
}

/** Traverse one caller-backed array element at a time. */
export async function* readStoredItems<T>(items: import("../ast.js").PdfStoredItems, signal?: AbortSignal): AsyncGenerator<T, void> {
  if (!Number.isSafeInteger(items.length) || items.length < 0) throw new RangeError("Invalid stored array length");
  let position = items.position;
  for (let i = 0; i < items.length; i++) {
    if (i && i % 256 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
    const record = await readStoredRecord<T>(items.storage, position, signal);
    yield record.value;
    position = record.next;
  }
  if (position !== -1) throw new Error("Invalid stored array terminator");
}

/** Append one persistent record and link the preceding record only after writing. */
export async function appendStoredRecord(storage: PdfPixelStorage, value: unknown, previous: number, signal?: AbortSignal): Promise<number> {
  const position = await writeStoredRecord(storage, value, -1, signal);
  if (previous !== -1) {
    const next = new Uint8Array(8);
    new DataView(next.buffer).setFloat64(0, position, true);
    await storage.write(previous, next, signal ? {signal} : undefined);
    signal?.throwIfAborted();
  }
  return position;
}
