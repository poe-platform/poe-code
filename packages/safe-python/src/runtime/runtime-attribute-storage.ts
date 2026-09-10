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
    return this.#dictionary === undefined ? this.#attributes.size : this.#dictionary.items.size;
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
