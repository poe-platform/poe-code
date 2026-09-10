import type { ExecutionMeter } from "./execution-budget.js";
import type { DictionaryValue, RuntimeValues } from "./runtime-values.js";

/** Owned instance storage. Replacing or deleting a dictionary detaches aliases;
 * deleting never clears the old object or removes the layout's storage ability. */
export class RuntimeInstanceState {
  #dictionary?: DictionaryValue;

  constructor(dictionary: DictionaryValue | undefined, meter: ExecutionMeter) {
    meter.checkpoint(1, 32);
    this.#dictionary = dictionary;
    Object.freeze(this);
  }

  get dictionary(): DictionaryValue | undefined { return this.#dictionary; }

  mutateDictionary(value: DictionaryValue | undefined, values: RuntimeValues, meter: ExecutionMeter): void {
    meter.checkpoint();
    if (this.#dictionary === undefined) throw Error("instance layout has no dictionary storage");
    const replacement = value ?? values.dictionary(this.#dictionary.items.emptyCopy());
    meter.checkpoint(); this.#dictionary = replacement;
  }
}
