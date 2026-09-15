import type { FrozenSetValue, RuntimeValue, SetValue } from "./runtime-values.js";

/** Native storage inspection only, without guest attributes or overridden slots. */
export function runtimeSetPayload(value: RuntimeValue): SetValue | FrozenSetValue | undefined {
  const payload = value.kind === "instance" ? value.native : value;
  return payload?.kind === "set" || payload?.kind === "frozenset" ? payload : undefined;
}
