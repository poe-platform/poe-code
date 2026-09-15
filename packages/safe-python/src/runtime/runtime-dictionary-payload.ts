import type { DictionaryValue, RuntimeValue } from "./runtime-values.js";

/** Trusted dictionary storage lookup, without guest attribute access. */
export function runtimeDictionaryPayload(value: RuntimeValue): DictionaryValue | undefined {
  return value.kind === "dict" ? value : value.kind === "instance" && value.native?.kind === "dict" ? value.native : undefined;
}
