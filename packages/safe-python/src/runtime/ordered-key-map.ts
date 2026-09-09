import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedMapIterator } from "./ordered-map-iterator.js";
import { OrderedMapReverseIterator } from "./ordered-map-reverse-iterator.js";
import { PythonRuntimeError } from "./error.js";

export interface KeyOperations<Key> {
  /** Equal keys must produce the same stable hash. The runtime owns __hash__,
   * reflected equality, truth conversion and guest exception translation. */
  hash(key: Key): bigint;
  equal(stored: Key, incoming: Key): boolean;
}

interface Entry<Key, Value> {
  readonly key: Key;
  readonly hash: bigint;
  value: Value;
  previous: Entry<Key, Value> | undefined;
  next: Entry<Key, Value> | undefined;
}

/** Ordered storage with Python identity-or-equality key matching. Hash buckets
 * accelerate lookup; a separate ordered set retains the original key and its
 * position on overwrite. No host equality is used as guest value equality.
 * Equality may mutate this map: deleted candidates/replaced buckets restart
 * lookup, while a value-only update remains visible. Pathological retries are
 * step-bounded. This is not yet a guest dict or its view objects.
 * Logical storage is charged before growth; exact host Map/Set heap costs and
 * synchronous callback recursion remain the enclosing runtime's responsibility.
 */
export class OrderedKeyMap<Key, Value> {
  readonly #buckets: Map<bigint, Set<Entry<Key, Value>>>;
  readonly #entries: Set<Entry<Key, Value>>;
  #last: Entry<Key, Value> | undefined;

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

  /** Boolean key lookup avoids allocating a presence/value result record. */
  containsKey(key: Key): boolean {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    return this.#find(key, hash) !== undefined;
  }

  /** Value views use iteration fallback, including its mutation checks. */
  containsValue(value: Value, equalValue: (stored: Value, incoming: Value) => boolean): boolean {
    this.meter.checkpoint();
    const iterator = this.iterate((_key, item) => item);
    while (true) {
      const item = iterator.next();
      if (item.done) return false;
      if (Object.is(item.value, value)) return true;
      const equal = equalValue(item.value, value);
      this.meter.checkpoint();
      if (equal) return true;
    }
  }

  /** Item-view callers first validate a two-element guest tuple; this storage
   * operation accepts its already-separated key/value, not arbitrary sequences. */
  containsItem(key: Key, value: Value, equalValue: (stored: Value, incoming: Value) => boolean): boolean {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const found = this.#find(key, hash);
    if (found === undefined) return false;
    if (Object.is(found.value, value)) return true;
    const equal = equalValue(found.value, value);
    this.meter.checkpoint();
    return equal;
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
    this.#remove(entry);
    return result;
  }

  /** LIFO removal without guest hashing/equality. A trusted projection may
   * allocate the guest result before removal; it must not mutate this storage
   * or invoke guest code. Empty storage is reported as absence. */
  popitem(): readonly [Key, Value] | undefined;
  popitem<Result>(project: (key: Key, value: Value) => Result): Result | undefined;
  popitem<Result>(project?: (key: Key, value: Value) => Result): Result | readonly [Key, Value] | undefined {
    this.meter.checkpoint();
    const entry = this.#last;
    if (entry === undefined) return undefined;
    this.meter.checkpoint(0, 48);
    const result = project ? project(entry.key, entry.value) : Object.freeze([entry.key, entry.value] as const);
    this.meter.checkpoint();
    this.#remove(entry);
    return result;
  }

  delete(key: Key): boolean {
    this.meter.checkpoint();
    const hash = this.operations.hash(key);
    const entry = this.#find(key, hash);
    if (entry === undefined) return false;
    this.#remove(entry);
    return true;
  }

  clear(): void {
    this.meter.checkpoint(1 + this.#entries.size);
    this.#entries.clear();
    this.#buckets.clear();
    this.#last = undefined;
  }

  /** Dictionary equality ignores insertion order. The caller owns reflected
   * value equality/truth conversion and recursive-container comparison guards.
   * Keep the left value alive across right-key lookup callbacks. No self-map
   * shortcut: collisions can still invoke key equality even when maps coincide.
   */
  equals(other: OrderedKeyMap<Key, Value>, equalValue: (left: Value, right: Value) => boolean): boolean {
    const comparisons = this.compareValues(other);
    let next = comparisons.next();
    while (!next.done) {
      const equal = equalValue(next.value[0], next.value[1]);
      this.meter.checkpoint();
      next = comparisons.next(equal);
    }
    return next.value;
  }

  /** Suspend each non-identical value comparison so an interpreter can drive
   * recursive equality with its own explicit stack. Resume with that pair's
   * equality result; keys still use this map's trusted synchronous policy.
   * Captured values survive callback mutation, and shared policies reuse hashes.
   */
  *compareValues(other: OrderedKeyMap<Key, Value>): Generator<readonly [Value, Value], boolean, boolean> {
    this.meter.checkpoint(0, 64);
    this.meter.checkpoint();
    if (this.#entries.size !== other.#entries.size) return false;
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      const { key, value } = entry;
      const hash = this.operations === other.operations ? entry.hash : other.operations.hash(key);
      const found = other.#find(key, hash);
      if (found === undefined) return false;
      if (!Object.is(value, found.value)) {
        this.meter.checkpoint(0, 48);
        const equal = yield Object.freeze([value, found.value] as const);
        this.meter.checkpoint();
        if (!equal) return false;
      }
    }
    return true;
  }

  /** Direct storage merge. Cached source hashes are valid only in the same
   * hash-policy domain; foreign policies must hash with the destination policy.
   * Values are captured before destination callbacks. Like exact-dict update,
   * a changed source size is reported after the current successful insertion.
   * Call keyword merges supply a rejecting duplicate handler; it receives the
   * incoming key before any overwrite and preserves earlier successful entries.
   * An explicit replacement supplies one shared value for fromkeys-style merges.
   */
  update(source: OrderedKeyMap<Key, Value>, rejectDuplicate?: (key: Key) => never, replacement?: { readonly value: Value }): void {
    this.meter.checkpoint();
    if (source === this && !rejectDuplicate && replacement === undefined) return;
    const size = source.#entries.size;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const { key } = entry;
      const value = replacement === undefined ? entry.value : replacement.value;
      const hash = this.operations === source.operations ? entry.hash : this.operations.hash(key);
      const existing = this.#find(key, hash);
      if (existing === undefined) this.#insert(key, hash, value);
      else {
        if (rejectDuplicate) rejectDuplicate(key);
        existing.value = value;
      }
      this.meter.checkpoint();
      if (source.#entries.size !== size) throw new PythonRuntimeError("RuntimeError", "dict mutated during update");
    }
  }

  /** Copy live entries and their cached hashes without invoking guest methods.
   * Key/value references are shared, but buckets, entries and links are fresh.
   * The copy stays in the same runtime/hash-policy and execution-budget domain.
   */
  copy(): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint();
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter);
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      result.#insert(entry.key, entry.hash, entry.value);
    }
    return result;
  }

  /** Capture iteration state now, not lazily on the first next call. */
  iterate<Result>(project: (key: Key, value: Value) => Result, kind: "dictionary" | "set" = "dictionary"): OrderedMapIterator<Key, Value, Result> {
    return new OrderedMapIterator(this.#entries, project, this.meter, kind);
  }

  /** Key-only containment for set comparisons, preserving cached hashes within
   * the same policy domain. Payload values never participate in comparison. */
  isKeySubsetOf(other: OrderedKeyMap<Key, Value>): boolean {
    this.meter.checkpoint();
    if (this === other) return true;
    if (this.#entries.size > other.#entries.size) return false;
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      const hash = this.operations === other.operations ? entry.hash : other.operations.hash(entry.key);
      if (other.#find(entry.key, hash) === undefined) return false;
    }
    this.meter.checkpoint();
    return true;
  }

  /** Fresh left-only keys. CPython switches to copy-and-remove when the left
   * side is much larger; this also determines guest equality call direction.
   * Retained entries keep their left key/value identities and cached hashes. */
  differenceKeys(other: OrderedKeyMap<Key, Value>): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint();
    if (Math.floor(this.#entries.size / 4) > other.#entries.size) {
      const result = this.copy();
      result.subtractKeysInPlace(other);
      return result;
    }
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter);
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      const { key, value, hash } = entry;
      const otherHash = this.operations === other.operations ? hash : other.operations.hash(key);
      if (other.#find(key, otherHash) !== undefined) continue;
      if (result.#find(key, hash) === undefined) result.#insert(key, hash, value);
    }
    this.meter.checkpoint();
    return result;
  }

  /** Streaming exact-set subtraction preserves completed removals on failure.
   * For a much larger source, first intersect it with the receiver, matching
   * Python's bounded lookup strategy and its pre-removal callback phase. */
  subtractKeysInPlace(other: OrderedKeyMap<Key, Value>): void {
    this.meter.checkpoint();
    if (other === this) { this.clear(); return; }
    const source = Math.floor(other.#entries.size / 8) > this.#entries.size ? this.intersectKeys(other) : other;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const hash = this.operations === source.operations ? entry.hash : this.operations.hash(entry.key);
      const found = this.#find(entry.key, hash);
      if (found !== undefined) this.#remove(found);
    }
    this.meter.checkpoint();
  }

  /** Set-style merge: union retains existing entries; symmetric difference
   * removes matches and inserts misses. Unlike dictionary update, callbacks
   * may mutate source size without a dictionary-specific error. Cached hashes
   * are reused only within a shared policy domain. Successful earlier writes
   * survive later callback/resource failures. */
  mergeKeysInPlace(source: OrderedKeyMap<Key, Value>, operator: "|" | "^"): void {
    this.meter.checkpoint();
    if (source === this) {
      if (operator === "^") this.clear();
      return;
    }
    // Empty union copies distinct, already validated source keys without
    // re-comparing collisions. Foreign policies must still validate their keys.
    const clean = operator === "|" && this.#entries.size === 0 && this.operations === source.operations;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const { key, value } = entry;
      const hash = this.operations === source.operations ? entry.hash : this.operations.hash(key);
      if (clean) { this.#insert(key, hash, value); continue; }
      const existing = this.#find(key, hash);
      if (operator === "^" && existing !== undefined) this.#remove(existing);
      else if (existing === undefined) {
        // Symmetric difference performs discard followed by add, including
        // the second equality lookup and its possible guest side effects.
        const added = operator === "^" ? this.#find(key, hash) : undefined;
        if (added === undefined) this.#insert(key, hash, value);
      }
    }
    this.meter.checkpoint();
  }

  /** Fresh key intersection, retaining entries from the smaller input (right
   * on a tie). Payloads follow those retained keys. Shared policies reuse
   * hashes; foreign-policy probes and insertions use their destination policy.
   * Like set intersection, source traversal is not a dictionary iterator and
   * does not impose dictionary-size mutation errors on equality callbacks. */
  intersectKeys(other: OrderedKeyMap<Key, Value>): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint();
    if (this === other) return this.copy();
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter);
    const source = other.#entries.size > this.#entries.size ? this : other;
    const target = source === this ? other : this;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const { key, value } = entry;
      const hash = source.operations === target.operations ? entry.hash : target.operations.hash(key);
      if (target.#find(key, hash) === undefined) continue;
      const resultHash = source.operations === this.operations ? entry.hash : hash;
      const existing = result.#find(key, resultHash);
      if (existing === undefined) result.#insert(key, resultHash, value);
    }
    this.meter.checkpoint();
    return result;
  }

  /** Compute before publishing: guest comparison/allocation failures leave the
   * receiver unchanged except for mutations performed by callbacks themselves.
   * Keep the live entry set so existing iterators still observe size changes.
   * Precharge the callback-free transfer before its first destructive write. */
  intersectKeysInPlace(other: OrderedKeyMap<Key, Value>): void {
    const result = this.intersectKeys(other);
    // Preserve live cursors for the unchanged self-intersection. Still compute
    // the copy above so its resource checks precede successful completion.
    if (this === other) return;
    this.meter.checkpoint(1 + this.#entries.size + result.#entries.size, 32 * result.#entries.size);
    this.#entries.clear();
    this.#buckets.clear();
    for (const entry of result.#entries) this.#entries.add(entry);
    for (const [hash, bucket] of result.#buckets) this.#buckets.set(hash, bucket);
    this.#last = result.#last;
  }

  reversed<Result>(project: (key: Key, value: Value) => Result): OrderedMapReverseIterator<Key, Value, Result> {
    return new OrderedMapReverseIterator(this.#entries, this.#last, project, this.meter);
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
    this.meter.checkpoint(0, 104 + (bucket === undefined ? 32 : 0));
    const entry: Entry<Key, Value> = { key, hash, value, previous: this.#last, next: undefined };
    if (bucket === undefined) { bucket = new Set(); this.#buckets.set(hash, bucket); }
    bucket.add(entry);
    this.#entries.add(entry);
    if (this.#last !== undefined) this.#last.next = entry;
    this.#last = entry;
  }

  #remove(entry: Entry<Key, Value>): void {
    const bucket = this.#buckets.get(entry.hash)!;
    bucket.delete(entry);
    if (bucket.size === 0) this.#buckets.delete(entry.hash);
    this.#entries.delete(entry);
    if (entry.previous !== undefined) entry.previous.next = entry.next;
    if (entry.next !== undefined) entry.next.previous = entry.previous;
    else this.#last = entry.previous;
    // A reverse cursor may already point at this removed entry. Keep its
    // predecessor route so the cursor can skip it and continue backwards.
    entry.next = undefined;
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
