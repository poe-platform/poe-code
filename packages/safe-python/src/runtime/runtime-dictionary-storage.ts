import type { DictionaryStorageOptions } from "./ordered-key-map.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Shared native dictionary layout policy. Guest string subclasses are not
 * exact strings; set tables and transient keyword merge groups do not opt in.
 * Identity is shared so compatible native maps can transfer owned storage.
 */
export const runtimeDictionaryStorage: DictionaryStorageOptions<RuntimeValue> = Object.freeze({
  isExactString: (key: RuntimeValue) => key.kind === "str"
});
