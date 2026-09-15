import type { ExecutionMeter } from "./execution-budget.js";
import { OrderedKeyMap, type KeyOperations } from "./ordered-key-map.js";
import { runtimeDictionaryStorage } from "./runtime-dictionary-storage.js";
import type { DictionaryValue, RuntimeValue, RuntimeValues } from "./runtime-values.js";

/** String-keyed attributes before reflection, a live guest dictionary afterward.
 * Promotion preserves order and values; replacement adopts the supplied object,
 * including non-string keys and its ordinary guest hashing/equality policy. */
export class RuntimeAttributeStorage {
  readonly #attributes = new Map<string, RuntimeValue>();
  #dictionary?: DictionaryValue;

  constructor(private readonly values: RuntimeValues, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 64);
    Object.freeze(this);
  }

  get size(): number {
    if (this.#dictionary === undefined) return this.#attributes.size;
    let count = 0;
    for (const [key] of this.#dictionary.items.snapshot()) { this.meter.checkpoint(); if (key.kind === "str") count++; }
    return count;
  }

  /** Attribute-name view; non-string guest dictionary keys remain untouched. */
  *[Symbol.iterator](): IterableIterator<readonly [string, RuntimeValue]> {
    if (this.#dictionary === undefined) {
      for (const entry of this.#attributes) { this.meter.checkpoint(); yield entry; }
      return;
    }
    for (const [key, value] of this.#dictionary.items.snapshot()) {
      this.meter.checkpoint();
      if (key.kind !== "str") continue;
      let name = "";
      for (const point of key.value) { this.meter.checkpoint(1, point > 0xffff ? 4 : 2); name += String.fromCodePoint(point); }
      yield [name, value];
    }
  }

  has(name: string): boolean {
    this.meter.checkpoint();
    return this.#dictionary === undefined ? this.#attributes.has(name) : this.#dictionary.items.lookup(this.values.string(name)) !== undefined;
  }

  get(name: string): RuntimeValue | undefined {
    this.meter.checkpoint();
    return this.#dictionary === undefined ? this.#attributes.get(name) : this.#dictionary.items.lookup(this.values.string(name))?.value;
  }

  set(name: string, value: RuntimeValue): void {
    this.meter.checkpoint();
    if (this.#dictionary !== undefined) { this.#dictionary.items.set(this.values.string(name), value); return; }
    this.meter.checkpoint(1, this.#attributes.has(name) ? 0 : 48 + 2 * name.length);
    this.#attributes.set(name, value);
  }

  delete(name: string): boolean {
    this.meter.checkpoint();
    return this.#dictionary === undefined ? this.#attributes.delete(name) : this.#dictionary.items.delete(this.values.string(name));
  }

  dictionary(keys: KeyOperations<RuntimeValue>): DictionaryValue {
    this.meter.checkpoint();
    if (this.#dictionary !== undefined) return this.#dictionary;
    const dictionary = this.values.dictionary(new OrderedKeyMap<RuntimeValue, RuntimeValue>(keys, this.meter, runtimeDictionaryStorage));
    for (const [name, value] of this.#attributes) {
      this.meter.checkpoint(); dictionary.items.set(this.values.string(name), value);
    }
    this.meter.checkpoint();
    this.#dictionary = dictionary; this.#attributes.clear();
    return dictionary;
  }

  replace(dictionary: DictionaryValue): void {
    this.meter.checkpoint();
    this.#dictionary = dictionary; this.#attributes.clear();
  }
}
