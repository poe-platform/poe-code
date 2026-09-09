import { CodePointString } from "./code-point-string.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { exhaustAllocation, type ExecutionMeter } from "./execution-budget.js";
import { bindPercentFormat, type BoundPercentFormatEvent, type PercentFormatBindingContext } from "./percent-format-bind.js";

type Storage = CodePointString | ImmutableBytes;
export interface PercentOutputContext<Value, Output extends Storage> extends PercentFormatBindingContext<Value> {
  /** Convert and fully render one bound field, including its width/precision.
   * Dispatch, guest protocols and unsupported-code diagnostics belong here. */
  convert(field: Extract<BoundPercentFormatEvent<Value>, { kind: "conversion" }>): Output;
}

/** Assemble in source order, joining once instead of repeated concatenation.
 * Immutable storage aliases are permitted; guest object identity and small-value
 * canonicalization belong to the runtime wrapper, not this storage operation. */
export function formatPercent<Value>(source: CodePointString, arguments_: Value, context: PercentOutputContext<Value, CodePointString>, meter: ExecutionMeter): CodePointString;
export function formatPercent<Value>(source: ImmutableBytes, arguments_: Value, context: PercentOutputContext<Value, ImmutableBytes>, meter: ExecutionMeter): ImmutableBytes;
export function formatPercent<Value>(source: Storage, arguments_: Value, context: PercentOutputContext<Value, Storage>, meter: ExecutionMeter): Storage {
  meter.checkpoint(1, 128);
  const parts: Storage[] = [], byteOutput = source instanceof ImmutableBytes;
  let length = 0;
  for (const field of bindPercentFormat(source, arguments_, context, meter)) {
    const part = field.kind === "literal"
      ? source.slice(BigInt(field.start), BigInt(field.end), null, meter)
      : context.convert(field);
    meter.checkpoint();
    if (byteOutput ? !(part instanceof ImmutableBytes) : !(part instanceof CodePointString)) throw new TypeError("percent converter returned incompatible storage");
    length += part.length;
    if (length > 0xffffffff) exhaustAllocation(meter);
    // Reserve reference capacity conservatively for a growable parts array.
    meter.checkpoint(0, 16);
    parts.push(part);
  }
  meter.checkpoint();
  if (parts.length === 0) return source;
  if (parts.length === 1) return parts[0];
  const separator = source.slice(0n, 0n, null, meter);
  // Every literal and converted part was checked against the source storage.
  return separator instanceof ImmutableBytes
    ? separator.join(parts as ImmutableBytes[], meter)
    : separator.join(parts as CodePointString[], meter);
}
