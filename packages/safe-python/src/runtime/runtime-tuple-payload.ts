import type { TupleConstant } from "./constant-values.js";
import type { RuntimeValue } from "./runtime-values.js";

/** Owned native storage, never guest attribute lookup or protocol dispatch. */
export function runtimeTuplePayload(value: RuntimeValue): TupleConstant<RuntimeValue> | undefined {
  const payload = value.kind === "instance" ? value.native : value;
  return payload?.kind === "tuple" ? payload : undefined;
}
