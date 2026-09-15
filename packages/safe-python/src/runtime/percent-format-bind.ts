import type { CodePointString } from "./code-point-string.js";
import { PythonRuntimeError } from "./error.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { ImmutableBytes } from "./immutable-bytes.js";
import { scanPercentFormat, type PercentFormatEvent } from "./percent-format-scan.js";

type Source = CodePointString | ImmutableBytes;
type Flags = Omit<Extract<PercentFormatEvent, { kind: "flags" }>, "kind">;

export interface PercentFormatBindingContext<Value> {
  /** Exact tuple/subclass storage only; mapped tuple values are never expanded. */
  tupleItems(value: Value): readonly Value[] | undefined;
  /** Mapping-slot eligibility with the text/bytes-specific sequence exclusions. */
  isMapping(value: Value, source: Source): boolean;
  mappingItem(mapping: Value, source: Source, start: number, end: number): Value;
  /** Int/bool/subclass payload only, not a guest __index__ conversion. */
  integer(value: Value): bigint | undefined;
}

export type BoundPercentFormatEvent<Value> =
  | { readonly kind: "literal"; readonly start: number; readonly end: number }
  | { readonly kind: "conversion"; readonly argument: Value; readonly code: number; readonly offset: number;
      readonly flags: Flags; readonly width: bigint; readonly precision: bigint | null };

/** Incremental operand binding, separate from representation/output construction.
 * Mapping/star callbacks run at scanner boundaries; each raw conversion consumes
 * its argument before consumer-side code validation. Surplus checking waits for
 * the final conversion to be processed. No guest tuple/key/value copying. */
export function* bindPercentFormat<Value>(source: Source, arguments_: Value, context: PercentFormatBindingContext<Value>, meter: ExecutionMeter): Generator<BoundPercentFormatEvent<Value>> {
  meter.checkpoint(1, 192);
  let items = context.tupleItems(arguments_); meter.checkpoint();
  const mapping = items === undefined && context.isMapping(arguments_, source); meter.checkpoint();
  let current = arguments_, index = 0, count = items?.length ?? 1;
  const take = (): Value => {
    meter.checkpoint();
    if (index >= count) throw new PythonRuntimeError("TypeError", "not enough arguments for format string");
    const offset = index++;
    return items === undefined ? current : items[offset];
  };
  const star = (kind: "width" | "precision"): bigint => {
    const argument = take(), value = context.integer(argument); meter.checkpoint();
    if (value === undefined) throw new PythonRuntimeError("TypeError", "* wants int");
    const bound = kind === "width" ? 1n << 63n : 1n << 31n;
    if (value < -bound || value >= bound) throw new PythonRuntimeError("OverflowError", `Python int too large to convert to C ${kind === "width" ? "ssize_t" : "int"}`);
    return value;
  };
  let flags: Flags | undefined, left = false, width = 0n, precision: bigint | null = null;
  for (const event of scanPercentFormat(source, meter)) {
    meter.checkpoint();
    switch (event.kind) {
      case "literal": yield event; break;
      case "begin": flags = undefined; left = false; width = 0n; precision = null; break;
      case "mapping-start":
        if (!mapping) throw new PythonRuntimeError("TypeError", "format requires a mapping");
        break;
      case "mapping-key": {
        const value = context.mappingItem(arguments_, source, event.start, event.end); meter.checkpoint();
        current = value; items = undefined; index = 0; count = 1;
        break;
      }
      case "flags": flags = event; left = event.left; break;
      case "width":
        width = event.value === "*" ? star("width") : event.value;
        if (width < 0n) { left = true; width = width === -(1n << 63n) ? 0n : -width; }
        break;
      case "precision":
        precision = event.value === "*" ? star("precision") : event.value;
        if (precision < 0n) precision = 0n;
        break;
      case "conversion": {
        const argument = take();
        meter.checkpoint(1, 160);
        yield { kind: "conversion", argument, code: event.code, offset: event.offset, width, precision,
          flags: { alternate: flags!.alternate, zero: flags!.zero, left, space: flags!.space, sign: flags!.sign } };
        break;
      }
    }
  }
  if (!mapping && index < count) throw new PythonRuntimeError("TypeError", `not all arguments converted during ${source instanceof ImmutableBytes ? "bytes" : "string"} formatting`);
}
