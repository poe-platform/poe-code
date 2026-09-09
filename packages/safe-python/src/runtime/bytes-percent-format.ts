import type { ExecutionMeter } from "./execution-budget.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import { formatPercent } from "./percent-format-output.js";
import type { PercentFormatBindingContext } from "./percent-format-bind.js";
import { bytesPercentField, type BytesPercentContext } from "./bytes-percent-field.js";

/** Whole bytes percent expression. Construct an exact bytes result only after
 * binding and surplus checks succeed. The factory owns small-bytes caching;
 * unchanged storage never implies reuse of a source/operand guest object. */
export function bytesPercentFormat<Value>(source: Value, arguments_: Value, context: BytesPercentContext<Value> & PercentFormatBindingContext<Value> & { bytesValue(storage: ImmutableBytes): Value }, meter: ExecutionMeter): Value {
  meter.checkpoint(1, 512);
  const storage = context.byteString(source); meter.checkpoint();
  if (storage === undefined) throw new TypeError("bytes percent source has no bytes storage");
  const output = formatPercent(storage, arguments_, {
    tupleItems: context.tupleItems.bind(context),
    isMapping: context.isMapping.bind(context),
    mappingItem: context.mappingItem.bind(context),
    integer: context.integer.bind(context),
    convert: field => bytesPercentField(field, context, meter)
  }, meter);
  meter.checkpoint();
  const result = context.bytesValue(output); meter.checkpoint();
  return result;
}
