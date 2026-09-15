import type { ExecutionMeter } from "./execution-budget.js";
import type { IntegerProgression } from "./integer-sequence.js";
import type { ConstantValues } from "./constant-values.js";
import { constantHash, type ConstantHashContext } from "./constant-hash.js";

/** Hash the canonical (length, start-or-None, step-or-None) key using the
 * shared numeric/tuple hash implementation. Empty and singleton ranges omit
 * attributes that do not affect equality. The value factory and meter must
 * belong to the same runtime; None identity comes from its hash context.
 * Guest range registration and full bigint/host allocation accounting remain
 * external. The three-slot key is fixed-size even for enormous ranges.
 */
export function rangeHash(range: IntegerProgression, values: ConstantValues, context: ConstantHashContext, meter: ExecutionMeter): bigint {
  meter.checkpoint(1, 32);
  const { length, start, step } = range;
  const key = values.tuple(3, index => {
    if (index === 0) return values.integer(length);
    if (length === 0n || (index === 2 && length === 1n)) return values.none;
    return values.integer(index === 1 ? start : step);
  });
  return constantHash(key, context, meter);
}
