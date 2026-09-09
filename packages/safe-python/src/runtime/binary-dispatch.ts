import type { ExecutionMeter } from "./execution-budget.js";

export interface BinaryDispatch<Value> {
  /** Concrete type/MRO relationship, not virtual subclass checks. */
  readonly relation: "same" | "right-subtype" | "other";
  readonly notImplemented: Value;
  /** Resolve/bind the appropriate type special method when called, invoke it
   * with the other operand, and return NotImplemented if the method is absent.
   * Non-callable methods raise their call error; they are not missing methods.
   */
  readonly forward: () => Value;
  readonly reflected: () => Value;
  /** Determine whether the subtype overrides the reflected implementation.
   * Guest attribute access/comparison may execute here; do not reduce this to
   * host callback identity. Called only for a strict right-hand subtype.
   */
  readonly reflectedIsOverridden: () => boolean;
}

/** Binary numeric special-method negotiation. The caller owns special-method
 * lookup, callback metering, built-in slot adaptation, sequence fallbacks and
 * unsupported-operand diagnostics. Rich comparison has different ordering rules.
 */
export function dispatchBinaryOperation<Value>(
  options: BinaryDispatch<Value>, meter?: ExecutionMeter
): Value {
  meter?.checkpoint();
  let triedReflected = false;
  if (options.relation === "right-subtype") {
    meter?.checkpoint();
    if (options.reflectedIsOverridden()) {
      meter?.checkpoint();
      const result = options.reflected();
      if (result !== options.notImplemented) return result;
      triedReflected = true;
    }
  }
  meter?.checkpoint();
  const result = options.forward();
  if (result !== options.notImplemented) return result;
  if (options.relation !== "same" && !triedReflected) {
    meter?.checkpoint();
    return options.reflected();
  }
  return options.notImplemented;
}
