import type { ExecutionMeter } from "./execution-budget.js";
import { formatPercent } from "./percent-format-output.js";
import type { PercentFormatBindingContext } from "./percent-format-bind.js";
import { textPercentField, type TextPercentContext } from "./text-percent-field.js";

/** Whole text percent expression over runtime-supplied capabilities. Immutable
 * storage sharing alone is not object identity: track the source or last field
 * object, and preserve it only when assembly returns exactly that storage.
 * Combined output is wrapped only after all binding and surplus checks succeed.
 */
export function textPercentFormat<Value>(source: Value, arguments_: Value, context: TextPercentContext<Value> & PercentFormatBindingContext<Value>, meter: ExecutionMeter): Value {
  meter.checkpoint(1, 512);
  const storage = context.string(source); meter.checkpoint();
  if (storage === undefined) throw new TypeError("text percent source has no string storage");
  let identity = source, identityStorage = storage;
  const output = formatPercent(storage, arguments_, {
    tupleItems: context.tupleItems.bind(context),
    isMapping: context.isMapping.bind(context),
    mappingItem: context.mappingItem.bind(context),
    integer: context.integer.bind(context),
    convert(field) {
      const value = textPercentField(field, context, meter);
      const result = context.string(value); meter.checkpoint();
      if (result === undefined) throw new TypeError("text percent field has no string storage");
      identity = value; identityStorage = result;
      return result;
    }
  }, meter);
  meter.checkpoint();
  if (output === identityStorage) return identity;
  const result = context.stringPoints(output); meter.checkpoint();
  return result;
}
