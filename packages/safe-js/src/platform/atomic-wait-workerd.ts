import type { Budget } from "../interp/budget.js";
import { nativeTypedArrayView } from "../interp/typed-array.js";
export async function waitForAtomicValue(view: Int32Array | BigInt64Array, index: number,
  expected: number | bigint, timeout: number, _budget: Budget
): Promise<{ async: false; value: string } | { async: true; value: Promise<string>; startedAt: number }> {
  const startedAt = performance.now();
  const wait = Reflect.get(Atomics, "waitAsync");
  if (typeof wait !== "function") throw new TypeError("This host does not support Atomics.waitAsync.");
  const result = Reflect.apply(wait, Atomics, [nativeTypedArrayView(view), index, expected, timeout]);
  return result.async ? { ...result, startedAt } : result;
}
