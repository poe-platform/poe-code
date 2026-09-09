import type { ExecutionMeter } from "./execution-budget.js";

export interface KeyOperations<Key> {
  /** Equal keys must produce the same stable hash. The runtime owns __hash__,
   * reflected equality, truth conversion and guest exception translation. */
  hash(key: Key): bigint;
  equal(stored: Key, incoming: Key): boolean;
}

interface Entry<Key, Value> { readonly key: Key; value: Value }

/** Ordered storage with Python identity-or-equality key matching. Hash buckets
 * accelerate lookup; a separate ordered set retains the original key and its
 * position on overwrite. No host equality is used as guest value equality.
 * Equality may mutate this map: deleted candidates/replaced buckets restart
 * lookup, while a value-only update remains visible. Pathological retries are
 * step-bounded. This is not yet a guest dict, its views or mutation-aware iterator.
 * Logical storage is charged before growth; exact host Map/Set heap costs and
 * synchronous callback recursion remain the enclosing runtime's responsibility.
 */
export class OrderedKeyMap<Key, Value> {
  readonly #buckets: Map<bigint, Set<Entry<Key, Value>>>;
  readonly #entries: Set<Entry<Key, Value>>;

  constructor(private readonly operations: KeyOperations<Key>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    this.#buckets = new Map();
    this.#entries = new Set();
    Object.freeze(this);
  }

  get size(): number { this.meter.checkpoint(); return this.#entries.size; }

  lookup(key: Key): Readonly<{ value: Value }> | undefined {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const entry = this.#find(key, hash);
    if (entry === undefined) return undefined;
    this.meter.checkpoint(0, 16);
    return Object.freeze({ value: entry.value });
  }

  set(key: Key, value: Value): void {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const existing = this.#find(key, hash);
    if (existing !== undefined) { existing.value = value; return; }
    this.#insert(key, hash, value);
  }

  /** Single hash/lookup: never implement this as lookup followed by set, since
   * guest hashing/equality can mutate state or return different results. */
  setdefault(key: Key, value: Value): Value {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const existing = this.#find(key, hash);
    if (existing !== undefined) return existing.value;
    this.#insert(key, hash, value);
    return value;
  }

  /** Absence is separate from a stored undefined value. The guest method layer
   * applies its default or raises KeyError, without performing another lookup. */
  pop(key: Key): Readonly<{ value: Value }> | undefined {
    this.meter.checkpoint();
    // CPython skips hashing entirely on an empty dictionary.
    if (this.#entries.size === 0) return undefined;
    const hash = this.operations.hash(key);
    const entry = this.#find(key, hash);
    if (entry === undefined) return undefined;
    this.meter.checkpoint(0, 16);
    const result = Object.freeze({ value: entry.value });
    this.#remove(entry, hash);
    return result;
  }

  delete(key: Key): boolean {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const entry = this.#find(key, hash);
    if (entry === undefined) return false;
    this.#remove(entry, hash);
    return true;
  }

  clear(): void {
    this.meter.checkpoint(1 + this.#entries.size);
    this.#entries.clear();
    this.#buckets.clear();
  }

  /** A detached host snapshot, not a guest dict view or iteration API. */
  snapshot(): readonly (readonly [Key, Value])[] {
    this.meter.checkpoint(1, 32 + this.#entries.size * 48);
    const rows: (readonly [Key, Value])[] = [];
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      rows.push(Object.freeze([entry.key, entry.value] as const));
    }
    return Object.freeze(rows);
  }

  #insert(key: Key, hash: bigint, value: Value): void {
    let bucket = this.#buckets.get(hash);
    this.meter.checkpoint(0, 80 + (bucket === undefined ? 32 : 0));
    const entry: Entry<Key, Value> = { key, value };
    if (bucket === undefined) { bucket = new Set(); this.#buckets.set(hash, bucket); }
    bucket.add(entry);
    this.#entries.add(entry);
  }

  #remove(entry: Entry<Key, Value>, hash: bigint): void {
    const bucket = this.#buckets.get(hash)!;
    bucket.delete(entry);
    if (bucket.size === 0) this.#buckets.delete(hash);
    this.#entries.delete(entry);
  }

  #find(key: Key, hash: bigint): Entry<Key, Value> | undefined {
    while (true) {
      this.meter.checkpoint();
      const bucket = this.#buckets.get(hash);
      if (bucket === undefined) return undefined;
      let restart = false;
      for (const entry of bucket) {
        this.meter.checkpoint();
        if (Object.is(entry.key, key)) return entry;
        const equal = this.operations.equal(entry.key, key);
        this.meter.checkpoint();
        if (this.#buckets.get(hash) !== bucket || !bucket.has(entry)) { restart = true; break; }
        if (equal) return entry;
      }
      if (!restart) return undefined;
    }
  }
}
