import type { ExecutionMeter } from "./execution-budget.js";
import type { DictionaryValue, InstanceValue, RuntimeValues, TypeValue } from "./runtime-values.js";
import { runtimeDictionaryPayload } from "./runtime-dictionary-payload.js";
import { RuntimeSlotStorage } from "./runtime-slot-storage.js";

/** Owned instance storage. Replacing or deleting a dictionary detaches aliases;
 * deleting never clears the old object or removes the layout's storage ability. */
export class RuntimeInstanceState {
  #dictionary?: DictionaryValue | InstanceValue | (() => DictionaryValue);
  #type: TypeValue;
  readonly slots: RuntimeSlotStorage;

  constructor(type: TypeValue, dictionary: DictionaryValue | (() => DictionaryValue) | undefined, meter: ExecutionMeter) {
    meter.checkpoint(1, 40);
    this.#type = type;
    this.#dictionary = dictionary;
    this.slots = new RuntimeSlotStorage(type.value.slotCount, meter);
    Object.freeze(this);
  }

  get dictionary(): DictionaryValue | undefined { const object=this.dictionaryObject;return object===undefined?undefined:runtimeDictionaryPayload(object); }
  get dictionaryObject(): DictionaryValue | InstanceValue | undefined { return typeof this.#dictionary==="function"?undefined:this.#dictionary; }
  get type(): TypeValue { return this.#type; }

  /** Reads can inspect absent storage without allocation. Explicit dictionary
   * access and attribute mutation materialize it through this trusted factory. */
  ensureDictionary(meter:ExecutionMeter):DictionaryValue | InstanceValue | undefined {
    meter.checkpoint();
    if(typeof this.#dictionary==="function") {
      const dictionary=this.#dictionary();
      meter.checkpoint();this.#dictionary=dictionary;
    }
    return this.#dictionary;
  }

  /** Adopt only after the object layer validates ownership and layout. */
  assignType(type: TypeValue, meter: ExecutionMeter): void {
    meter.checkpoint(); this.#type = type;
  }

  mutateDictionary(value: DictionaryValue | InstanceValue | undefined, values: RuntimeValues, meter: ExecutionMeter): void {
    meter.checkpoint();
    if (this.#dictionary === undefined) throw Error("instance layout has no dictionary storage");
    if(value!==undefined&&runtimeDictionaryPayload(value)===undefined)throw Error("instance dictionary requires owned dictionary storage");
    const replacement = value ?? (typeof this.#dictionary==="function"?this.#dictionary():values.dictionary(this.dictionary!.items.emptyCopy()));
    meter.checkpoint(); this.#dictionary = replacement;
  }
}
