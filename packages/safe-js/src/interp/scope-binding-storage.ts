// Private scope cells must never pass through replaceable host collection hooks.
// Capture operations before callers can replace native prototypes. In particular,
// do not return native iterators whose next methods could expose stored cells.
const NativeMap = Map;
const NativeSet = Set;
// Bind direct calls once. Reflect.apply would allocate a fresh argument vector
// for every lookup and every step of the frequently rebuilt binding snapshots.
const mapGet = Function.prototype.call.bind(Map.prototype.get) as <K, V>(
  map: Map<K, V>,
  key: K
) => V | undefined;
const mapSet = Function.prototype.call.bind(Map.prototype.set) as <K, V>(
  map: Map<K, V>,
  key: K,
  value: V
) => unknown;
const mapHas = Function.prototype.call.bind(Map.prototype.has) as <K, V>(
  map: Map<K, V>,
  key: K
) => boolean;
const mapDelete = Function.prototype.call.bind(Map.prototype.delete) as <K, V>(
  map: Map<K, V>,
  key: K
) => boolean;
const mapEntries = Function.prototype.call.bind(Map.prototype.entries) as <K, V>(
  map: Map<K, V>
) => IterableIterator<[K, V]>;
const mapValues = Function.prototype.call.bind(Map.prototype.values) as <K, V>(
  map: Map<K, V>
) => IterableIterator<V>;
const mapSize = Function.prototype.call.bind(
  Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!
) as (map: Map<unknown, unknown>) => number;
const mapNext = Function.prototype.call.bind(Object.getPrototypeOf(new Map().values()).next) as <T>(
  iterator: object
) => IteratorResult<T>;
const setAdd = Function.prototype.call.bind(Set.prototype.add) as <T>(
  set: Set<T>,
  value: T
) => unknown;
const setHas = Function.prototype.call.bind(Set.prototype.has) as <T>(
  set: Set<T>,
  value: T
) => boolean;
const setDelete = Function.prototype.call.bind(Set.prototype.delete) as <T>(
  set: Set<T>,
  value: T
) => boolean;
const setValues = Function.prototype.call.bind(Set.prototype.values) as <T>(
  set: Set<T>
) => IterableIterator<T>;
const setNext = Function.prototype.call.bind(Object.getPrototypeOf(new Set().values()).next) as <T>(
  iterator: object
) => IteratorResult<T>;

function privateIterator<T>(
  iterator: object,
  next: (iterator: object) => IteratorResult<T>
): IterableIterator<T> {
  return {
    next() {
      return next(iterator);
    },
    [Symbol.iterator]() {
      return this;
    }
  };
}

export class ScopeBindingMap<K, V> implements Iterable<[K, V]> {
  readonly #data = new NativeMap<K, V>();

  get size(): number {
    return mapSize(this.#data);
  }
  get(key: K): V | undefined {
    return mapGet(this.#data, key);
  }
  has(key: K): boolean {
    return mapHas(this.#data, key);
  }
  set(key: K, value: V): void {
    mapSet(this.#data, key, value);
  }
  delete(key: K): boolean {
    return mapDelete(this.#data, key);
  }
  entries(): IterableIterator<[K, V]> {
    return privateIterator<[K, V]>(mapEntries(this.#data), mapNext);
  }
  values(): IterableIterator<V> {
    return privateIterator<V>(mapValues(this.#data), mapNext);
  }
  [Symbol.iterator](): IterableIterator<[K, V]> {
    return this.entries();
  }
}

export class ScopeBindingSet<T> implements Iterable<T> {
  readonly #data = new NativeSet<T>();

  has(value: T): boolean {
    return setHas(this.#data, value);
  }
  add(value: T): void {
    setAdd(this.#data, value);
  }
  delete(value: T): boolean {
    return setDelete(this.#data, value);
  }
  [Symbol.iterator](): IterableIterator<T> {
    return privateIterator<T>(setValues(this.#data), setNext);
  }
}
