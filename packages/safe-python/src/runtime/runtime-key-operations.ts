import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { KeyOperations } from "./ordered-key-map.js";
import { runtimeHash, type RuntimeHashContext } from "./runtime-hash.js";
import { createRuntimeHashContext } from "./runtime-hash-context.js";
import { createRuntimeSearchEquality } from "./runtime-search-equality.js";
import type { BuiltinInvocationContext, RuntimeValue } from "./runtime-values.js";

/** One hash domain and rich-equality policy for execution-owned collections.
 * Share this policy across collections that exchange cached hashes. Guest slots
 * remain live; identity shortcuts and mutation retries belong to storage.
 * Hash provenance is retained for each container's diagnostic boundary.
 */
export function createRuntimeKeyOperations(values: ConstantValues, base: RuntimeHashContext, meter: ExecutionMeter, invocation?: BuiltinInvocationContext): KeyOperations<RuntimeValue> {
  meter.checkpoint(0, 64);
  const hash = createRuntimeHashContext(base, meter, invocation);
  const equal = createRuntimeSearchEquality(values, meter, invocation);
  return { hash: value => runtimeHash(value, hash, meter), equal };
}
