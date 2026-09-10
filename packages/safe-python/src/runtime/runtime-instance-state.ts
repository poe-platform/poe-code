import type { ExecutionMeter } from "./execution-budget.js";
import type { DictionaryValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Owned instance storage. Replacing or deleting a dictionary detaches aliases;
 * deleting never clears the old object or removes the layout's storage ability. */
export class RuntimeInstanceState {
  #dictionary?: DictionaryValue;
  #type: TypeValue;

  constructor(type: TypeValue, dictionary: DictionaryValue | undefined, meter: ExecutionMeter) {
    meter.checkpoint(1, 40);
    this.#type = type;
    this.#dictionary = dictionary;
    Object.freeze(this);
  }

  get dictionary(): DictionaryValue | undefined { return this.#dictionary; }
  get type(): TypeValue { return this.#type; }

  /** Adopt only after the object layer validates ownership and layout. */
  assignType(type: TypeValue, meter: ExecutionMeter): void {
    meter.checkpoint(); this.#type = type;
  }

  mutateDictionary(value: DictionaryValue | undefined, values: RuntimeValues, meter: ExecutionMeter): void {
    meter.checkpoint();
    if (this.#dictionary === undefined) throw Error("instance layout has no dictionary storage");
    const replacement = value ?? values.dictionary(this.#dictionary.items.emptyCopy());
    meter.checkpoint(); this.#dictionary = replacement;
  }
}
