import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedMapIterator } from "./ordered-map-iterator.js";
import { OrderedMapReverseIterator } from "./ordered-map-reverse-iterator.js";
import { PythonRuntimeError } from "./error.js";
import { DictionaryEntrySlots } from "./dictionary-entry-slots.js";
import { DictionaryStorageIterator } from "./dictionary-storage-iterator.js";

export interface DictionaryStorageOptions<Key> {
  /** Pure trusted type inspection; must not run guest code or mutate storage. */
  isExactString(key: Key): boolean;
  readonly minimumEntries?: number;
  readonly exactStrings?: boolean;
}

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
  #sealed = false;
  #keySetHash: bigint | undefined;
  #dictionaryEntries: DictionaryEntrySlots<Entry<Key, Value>> | undefined;

  constructor(private readonly operations: KeyOperations<Key>, private readonly meter: ExecutionMeter, private readonly dictionaryOptions?: DictionaryStorageOptions<Key>) {
    meter.checkpoint(1, 64);
    if (dictionaryOptions) this.#dictionaryEntries = new DictionaryEntrySlots(meter, dictionaryOptions.minimumEntries, dictionaryOptions.exactStrings);
    this.#buckets = new Map();
    this.#entries = new Set();
    Object.freeze(this);
  }

  get size(): number { this.meter.checkpoint(); return this.#entries.size; }

  /** Raw mutation-tolerant scan, distinct from the size-checking guest iterator.
   * Captures a pair before guest repr can mutate either entry or dictionary.
   * Copy/update currently retain their existing construction policies, not all
   * CPython bulk-layout optimizations. Set storage opts out of this extra index.
   */
  nextDictionaryEntry(position: number, reverse = false): Readonly<{ position: number; key: Key; value: Value }> | undefined {
    this.meter.checkpoint();
    if (!this.#dictionaryEntries) throw new Error("dictionary positional storage is not enabled");
    const next = reverse ? this.#dictionaryEntries.previous(position) : this.#dictionaryEntries.next(position);
    if (next === undefined) return undefined;
    this.meter.checkpoint(0, 40);
    return Object.freeze({ position: next.position, key: next.entry.key, value: next.entry.value });
  }

  /** Permanently close owned storage before publishing an immutable value. */
  seal(): void { this.meter.checkpoint(); this.#sealed = true; }

  /** Python's 64-bit frozenset hash over cached key hashes, not payloads.
   * Mutable sets can request the equivalent hash for membership probes; only
   * sealed storage caches it. No guest hash/equality callbacks run here. */
  keySetHash(): bigint {
    this.meter.checkpoint();
    if (this.#keySetHash !== undefined) return this.#keySetHash;
    let hash = 0n;
    for (const entry of this.#entries) {
      this.meter.checkpoint(1, 64);
      const h = BigInt.asUintN(64, entry.hash);
      hash ^= BigInt.asUintN(64, ((h ^ 89869747n) ^ (h << 16n)) * 3644798167n);
    }
    hash ^= BigInt.asUintN(64, (BigInt(this.#entries.size) + 1n) * 1927868237n);
    hash ^= (hash >> 11n) ^ (hash >> 25n);
    hash = BigInt.asIntN(64, hash * 69069n + 907133923n);
    if (hash === -1n) hash = 590923713n;
    this.meter.checkpoint(1, 64);
    if (this.#sealed) this.#keySetHash = hash;
    return hash;
  }

  lookup(key: Key, knownHash?: bigint): Readonly<{ value: Value }> | undefined {
    this.meter.checkpoint();
    const hash = knownHash === undefined ? this.operations.hash(key) : knownHash;
    const entry = this.#find(key, hash);
    if (entry === undefined) return undefined;
    this.meter.checkpoint(0, 16);
    return Object.freeze({ value: entry.value });
  }

  /** Boolean lookup. A trusted caller may supply the equivalent frozen hash
   * for a mutable-set probe without constructing or hashing a new guest key. */
  containsKey(key: Key, knownHash?: bigint): boolean {
    this.meter.checkpoint();
    const hash = knownHash === undefined ? this.operations.hash(key) : knownHash;
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
    this.#assertWritable();
    const hash = this.operations.hash(key);
    const existing = this.#find(key, hash);
    if (existing !== undefined) { this.#assertWritable(); existing.value = value; return; }
    this.#insert(key, hash, value);
  }

  /** Single hash/lookup: never implement this as lookup followed by set, since
   * guest hashing/equality can mutate state or return different results. */
  setdefault(key: Key, value: Value): Value {
    this.meter.checkpoint();
    this.#assertWritable();
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
    this.#assertWritable();
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
    this.#assertWritable();
    const entry = this.#last;
    if (entry === undefined) return undefined;
    this.meter.checkpoint(0, 48);
    const result = project ? project(entry.key, entry.value) : Object.freeze([entry.key, entry.value] as const);
    this.meter.checkpoint();
    this.#remove(entry, true);
    return result;
  }

  /** Known hashes support exact mutable-set removal probes. */
  delete(key: Key, knownHash?: bigint): boolean {
    this.meter.checkpoint();
    this.#assertWritable();
    const hash = knownHash === undefined ? this.operations.hash(key) : knownHash;
    const entry = this.#find(key, hash);
    if (entry === undefined) return false;
    this.#remove(entry);
    return true;
  }

  clear(): void {
    this.meter.checkpoint(1 + this.#entries.size);
    this.#assertWritable();
    this.#dictionaryEntries?.clear();
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
   * Dictionary scans retain numeric positions across clear/refill and compaction.
   */
  *compareValues(other: OrderedKeyMap<Key, Value>): Generator<readonly [Value, Value], boolean, boolean> {
    this.meter.checkpoint(0, 64);
    this.meter.checkpoint();
    if (this.#entries.size !== other.#entries.size) return false;
    const entries = this.#dictionaryEntries ? undefined : this.#entries.values();
    let position = 0;
    while (true) {
      this.meter.checkpoint();
      let entry: Entry<Key, Value>;
      if (this.#dictionaryEntries) {
        const next = this.#dictionaryEntries.next(position);
        if (next === undefined) break;
        entry = next.entry; position = next.position;
      } else {
        const next = entries!.next();
        if (next.done) break;
        entry = next.value;
      }
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
    this.#assertWritable();
    if (source === this && !rejectDuplicate && replacement === undefined) return;
    // An empty destination can copy a dense combined dictionary table without
    // comparing its already-distinct keys. In particular, call ** expansion
    // must not repeat equality callbacks between colliding keyword subtypes.
    if (this.#entries.size === 0 && this.#dictionaryEntries !== undefined && source.#dictionaryEntries?.mergeCloneable && this.operations === source.operations && replacement === undefined) {
      this.#dictionaryEntries.clear();
      for (const entry of source.#entries) {
        this.meter.checkpoint();
        this.#insert(entry.key, entry.hash, entry.value);
      }
      return;
    }
    const size = source.#entries.size;
    const checkDuplicate = this.#entries.size === 0 ? undefined : rejectDuplicate;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const { key } = entry;
      const value = replacement === undefined ? entry.value : replacement.value;
      const hash = this.operations === source.operations ? entry.hash : this.operations.hash(key);
      // Call ** merges into a nonempty dictionary check containment first,
      // then perform the insertion lookup independently. Equality can change
      // its answer or mutate either mapping between these two operations.
      if (checkDuplicate && this.#find(key, hash) !== undefined) checkDuplicate(key);
      const existing = this.#find(key, hash);
      if (existing === undefined) this.#insert(key, hash, value);
      else {
        this.#assertWritable();
        existing.value = value;
      }
      this.meter.checkpoint();
      if (source.#entries.size !== size) throw new PythonRuntimeError("RuntimeError", "dict mutated during update");
    }
  }

  /** Native fromkeys insertion retains cached hashes and scans a dictionary by
   * entry position. Equality callbacks may clear, refill or compact the source;
   * the next step resumes at the saved numeric position in its current table.
   * Capture the incoming key before callbacks, including when source is this.
   * Storage without dictionary slots uses its native entry traversal instead.
   */
  assignKeys(source: OrderedKeyMap<Key, Value>, value: Value): void {
    this.meter.checkpoint();
    this.#assertWritable();
    this.#dictionaryEntries?.prepareFromKeys(source.#entries.size, source.#dictionaryEntries);
    const entries = source.#dictionaryEntries ? undefined : source.#entries.values();
    let position = 0;
    while (true) {
      this.meter.checkpoint();
      let entry: Entry<Key, Value>;
      if (source.#dictionaryEntries) {
        const next = source.#dictionaryEntries.next(position);
        if (next === undefined) return;
        entry = next.entry;
        position = next.position;
      } else {
        const next = entries!.next();
        if (next.done) return;
        entry = next.value;
      }
      const { key } = entry;
      const hash = this.operations === source.operations ? entry.hash : this.operations.hash(key);
      const existing = this.#find(key, hash);
      this.#assertWritable();
      if (existing === undefined) this.#insert(key, hash, value);
      else existing.value = value;
      this.meter.checkpoint();
    }
  }

  /** Remove equal key/value pairs while reporting unmatched incoming pairs.
   * Source traversal reuses native hashes and permits source mutation. Values
   * are compared before any tuple hashing, so unhashable common item values can
   * cancel. A key lost during the second lookup is returned for guest KeyError. */
  subtractMatchingItems(other: OrderedKeyMap<Key, Value>, equalValue: (left: Value, right: Value) => boolean, unmatched: (key: Key, value: Value) => void): Readonly<{ key: Key }> | undefined {
    this.meter.checkpoint();
    this.#assertWritable();
    for (const entry of other.#entries) {
      this.meter.checkpoint();
      const { key, value } = entry;
      const hash = this.operations === other.operations ? entry.hash : this.operations.hash(key);
      const found = this.#find(key, hash);
      const equal = found !== undefined && (Object.is(found.value, value) || equalValue(found.value, value));
      this.meter.checkpoint();
      if (equal) {
        if (!this.delete(key, hash)) {
          this.meter.checkpoint(0, 16);
          return Object.freeze({ key });
        }
      } else unmatched(key, value);
      this.meter.checkpoint();
    }
    return undefined;
  }

  /** Fresh empty storage in this execution's hash-policy and budget domain. */
  emptyCopy(): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint();
    return new OrderedKeyMap<Key, Value>(this.operations, this.meter, this.dictionaryOptions);
  }

  /** Copy live entries and their cached hashes without invoking guest methods.
   * Key/value references are shared, but buckets, entries and links are fresh.
   * The copy stays in the same runtime/hash-policy and execution-budget domain.
   */
  copy(): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint();
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter, this.dictionaryOptions);
    for (const entry of this.#entries) {
      this.meter.checkpoint();
      result.#insert(entry.key, entry.hash, entry.value);
    }
    return result;
  }

  /** Capture iteration state now, not lazily on the first next call. */
  iterate<Result>(project: (key: Key, value: Value) => Result, kind: "dictionary" | "set" = "dictionary"): OrderedMapIterator<Key, Value, Result> | DictionaryStorageIterator<Key, Value, Result> {
    if (kind === "dictionary" && this.#dictionaryEntries) return new DictionaryStorageIterator(this, 0, false, project, this.meter);
    return new OrderedMapIterator(this.#entries, project, this.meter, kind);
  }

  /** Equality may reject distinct cached frozenset hashes before invoking any
   * element comparisons. Never compute a hash here: hashing only one operand,
   * or comparing subsets, must preserve the normal guest callback sequence. */
  hasEqualKeys(other: OrderedKeyMap<Key, Value>): boolean {
    this.meter.checkpoint();
    if (this.#entries.size !== other.#entries.size) return false;
    if (this.operations === other.operations && this.#keySetHash !== undefined && other.#keySetHash !== undefined && this.#keySetHash !== other.#keySetHash) return false;
    return this.isKeySubsetOf(other);
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

  /** Exact set disjointness traverses the smaller side, retaining cached hashes
   * and choosing the right side on ties. Equal source/target needs no callbacks. */
  isKeyDisjointFrom(other: OrderedKeyMap<Key, Value>): boolean {
    this.meter.checkpoint();
    if (this === other) return this.#entries.size === 0;
    const source = this.#entries.size < other.#entries.size ? this : other;
    const target = source === this ? other : this;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const hash = source.operations === target.operations ? entry.hash : target.operations.hash(entry.key);
      if (target.#find(entry.key, hash) !== undefined) return false;
    }
    this.meter.checkpoint();
    return true;
  }

  /** Generic set intersection hashes incoming keys once and stops only after a
   * match fills the result. An empty receiver still consumes/hashes its input.
   * Acquire the iterator after result allocation; never close it on an early
   * return. Supplied payloads let set callers store their canonical None. */
  intersectKeysFrom(source: () => Iterator<Key>, value: Value): OrderedKeyMap<Key, Value> {
    this.meter.checkpoint(1, 32);
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter, this.dictionaryOptions);
    const iterator = source();
    this.meter.checkpoint();
    while (true) {
      this.meter.checkpoint();
      const item = iterator.next();
      this.meter.checkpoint();
      if (item.done) return result;
      const key = item.value, hash = this.operations.hash(key);
      if (this.#find(key, hash) === undefined) continue;
      if (result.#find(key, hash) === undefined) result.#insert(key, hash, value);
      if (result.#entries.size >= this.#entries.size) return result;
    }
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
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter, this.dictionaryOptions);
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
    this.#assertWritable();
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
   * survive later callback/resource failures. A replacement payload supports
   * dictionary-to-set merges, which must compare even into an empty receiver. */
  mergeKeysInPlace(source: OrderedKeyMap<Key, Value>, operator: "|" | "^", replacement?: { readonly value: Value }): void {
    this.meter.checkpoint();
    this.#assertWritable();
    if (source === this) {
      if (operator === "^") this.clear();
      return;
    }
    // Empty union copies distinct, already validated source keys without
    // re-comparing collisions. Foreign policies must still validate their keys.
    const clean = operator === "|" && replacement === undefined && this.#entries.size === 0 && this.operations === source.operations;
    for (const entry of source.#entries) {
      this.meter.checkpoint();
      const { key } = entry;
      const value = replacement === undefined ? entry.value : replacement.value;
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
    const result = new OrderedKeyMap<Key, Value>(this.operations, this.meter, this.dictionaryOptions);
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
    this.meter.checkpoint();
    this.#assertWritable();
    const result = this.intersectKeys(other);
    // Preserve live cursors for the unchanged self-intersection. Still compute
    // the copy above so its resource checks precede successful completion.
    if (this === other) return;
    this.takeContents(result);
  }

  /** Consume private mutable storage from the same execution/hash domain. No key
   * callbacks run during publication. Precharge all transfer work before the
   * first write; emptied source storage can subsequently be reused independently. */
  takeContents(source: OrderedKeyMap<Key, Value>): void {
    this.meter.checkpoint();
    this.#assertWritable();
    source.#assertWritable();
    if (source === this) return;
    if (this.operations !== source.operations || this.meter !== source.meter) throw new Error("cannot transfer keys across execution domains");
    if (this.dictionaryOptions !== source.dictionaryOptions) throw new Error("cannot transfer keys across dictionary layouts");
    const emptySourceEntries = source.#dictionaryEntries ? new DictionaryEntrySlots<Entry<Key, Value>>(this.meter) : undefined;
    this.meter.checkpoint(1 + this.#entries.size + source.#entries.size * 2, 32 * source.#entries.size);
    this.#assertWritable();
    source.#assertWritable();
    this.#dictionaryEntries = source.#dictionaryEntries;
    source.#dictionaryEntries = emptySourceEntries;
    this.#entries.clear();
    this.#buckets.clear();
    for (const entry of source.#entries) this.#entries.add(entry);
    for (const [hash, bucket] of source.#buckets) this.#buckets.set(hash, bucket);
    this.#last = source.#last;
    source.#entries.clear();
    source.#buckets.clear();
    source.#last = undefined;
  }

  reversed<Result>(project: (key: Key, value: Value) => Result): OrderedMapReverseIterator<Key, Value, Result> | DictionaryStorageIterator<Key, Value, Result> {
    if (this.#dictionaryEntries) return new DictionaryStorageIterator(this, this.#dictionaryEntries.lastPosition, true, project, this.meter);
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
    const exactString = this.dictionaryOptions?.isExactString(key) ?? false;
    let bucket = this.#buckets.get(hash);
    this.meter.checkpoint(0, 104 + (bucket === undefined ? 32 : 0));
    this.#assertWritable();
    const entry: Entry<Key, Value> = { key, hash, value, previous: this.#last, next: undefined };
    // Every remaining hash/link mutation is callback-free and already charged.
    this.#dictionaryEntries?.append(entry, exactString);
    if (bucket === undefined) { bucket = new Set(); this.#buckets.set(hash, bucket); }
    bucket.add(entry);
    this.#entries.add(entry);
    if (this.#last !== undefined) this.#last.next = entry;
    this.#last = entry;
  }

  #remove(entry: Entry<Key, Value>, truncate = false): void {
    this.#assertWritable();
    if (truncate) this.#dictionaryEntries?.pop();
    else this.#dictionaryEntries?.delete(entry);
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

  #assertWritable(): void {
    if (this.#sealed) throw new Error("key storage is sealed");
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
