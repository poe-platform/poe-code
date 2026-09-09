import type { ExecutionMeter } from "./execution-budget.js";

export interface RichComparisonDispatch<Value> {
  /** Concrete strict subtype relationship, not virtual subclass membership. */
  readonly rightIsStrictSubtype: boolean;
  readonly notImplemented: Value;
  /** Resolve/bind and invoke type special methods on demand. Missing methods
   * return NotImplemented; non-callable methods must raise their call errors.
   * Reflected lookup swaps operands and the comparison (< with >, <= with >=;
   * == and != reflect to themselves). Callback execution is caller-metered.
   */
  readonly forward: () => Value;
  readonly reflected: () => Value;
}

/** Negotiate rich comparison without truth conversion or identity shortcuts.
 * If both methods decline, the caller implements ==/!= identity fallback or
 * an unsupported-ordering error. object.__ne__ delegation belongs to its slot,
 * not this dispatcher, and containment's identity shortcut is a separate rule.
 */
export function dispatchRichComparison<Value>(
  options: RichComparisonDispatch<Value>, meter?: ExecutionMeter
): Value {
  meter?.checkpoint();
  if (options.rightIsStrictSubtype) {
    meter?.checkpoint();
    const result = options.reflected();
    if (result !== options.notImplemented) return result;
  }
  meter?.checkpoint();
  const result = options.forward();
  if (result !== options.notImplemented) return result;
  if (!options.rightIsStrictSubtype) {
    meter?.checkpoint();
    return options.reflected();
  }
  return options.notImplemented;
}
