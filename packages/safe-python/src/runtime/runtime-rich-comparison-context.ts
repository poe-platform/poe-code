import type { ExecutionMeter } from "./execution-budget.js";
import { runtimeComparison, type RuntimeComparisonContext } from "./runtime-comparison.js";
import { usesRuntimeGuestNumericSlots } from "./runtime-numeric-slots.js";
import type { RuntimeRichComparisonContext } from "./runtime-rich-comparison.js";
import { lookupRuntimeSpecialMethod, runtimeActualType, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { runtimeTruth } from "./runtime-truth.js";
import { runtimeIntegerPayload } from "./runtime-integer-payload.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

const methods: ReadonlyMap<string, readonly [string, string]> = new Map([
  ["==", ["__eq__", "=="]], ["!=", ["__ne__", "!="]],
  ["<", ["__lt__", ">"]], ["<=", ["__le__", ">="]], [">", ["__gt__", "<"]], [">=", ["__ge__", "<="]]
]);

const nativeContainerKinds = new Set(["dict", "list", "tuple", "set", "frozenset", "int"]);

/** Live type-MRO comparison dispatch. Strict subtypes reflect first even when
 * they inherit the method; same-type operands still get both attempts. Opaque
 * cell/type object defaults use identity, not their backing payload equality.
 * Native-subclass payload adaptation remains an object-layer responsibility. */
export function createRuntimeRichComparisonContext(operator: string, left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation: BuiltinInvocationContext): RuntimeRichComparisonContext | undefined {
  meter.checkpoint();
  const leftGuest = usesRuntimeGuestNumericSlots(left), rightGuest = usesRuntimeGuestNumericSlots(right);
  if (!leftGuest && !rightGuest) return undefined;
  const names = methods.get(operator);
  if (names === undefined) throw Error(`unsupported rich comparison operator: ${operator}`);
  const leftType = leftGuest || nativeContainerKinds.has(left.kind) ? runtimeActualType(left, special, meter) : undefined; meter.checkpoint();
  const rightType = rightGuest || nativeContainerKinds.has(right.kind) ? runtimeActualType(right, special, meter) : undefined; meter.checkpoint();
  let rightIsStrictSubtype = false;
  if (leftType !== undefined && rightType !== undefined && leftType !== rightType) {
    for (const ancestor of rightType.value.mro) {
      meter.checkpoint();
      if (ancestor === leftType.value) { rightIsStrictSubtype = true; break; }
    }
  }
  meter.checkpoint(0, 512);
  const native: RuntimeComparisonContext = {
    declineUnsupported: true,
    comparison(op, a, b) {
      if (!usesRuntimeGuestNumericSlots(a) && !usesRuntimeGuestNumericSlots(b)) return undefined;
      if (invocation.compare === undefined) throw Error("delegated comparison requires a comparison policy");
      const result = invocation.compare(op, a, b); meter.checkpoint(); return result;
    },
    truth: invocation.truth?.bind(invocation)
  };
  const call = (op: string, receiver: RuntimeValue, other: RuntimeValue, type: TypeValue | undefined): RuntimeValue => {
    if (type === undefined) return runtimeComparison(op, receiver, runtimeIntegerPayload(other) ?? other, values, meter, 1000, native);
    const method = lookupRuntimeSpecialMethod(receiver, type, values.string(methods.get(op)![0]), special, values, meter);
    meter.checkpoint();
    if (method !== undefined) {
      meter.checkpoint(0, 16);
      const result = invocation.call(method, [other]); meter.checkpoint(); return result;
    }
    if (op === "!=") {
      const equal = call("==", receiver, other, type);
      if (equal === values.notImplemented) return equal;
      const truth = invocation.truth === undefined ? runtimeTruth(equal, meter) : invocation.truth(equal);
      meter.checkpoint(); return values.boolean(!truth);
    }
    if (receiver.kind !== "instance" && receiver.kind !== "cell" && receiver.kind !== "type") return runtimeComparison(op, receiver, other, values, meter, 1000, native);
    return op === "==" && receiver === other ? values.true : values.notImplemented;
  };
  return {
    slots: { rightIsStrictSubtype, notImplemented: values.notImplemented,
      forward: () => call(operator, left, right, leftType),
      reflected: () => call(names[1], right, left, rightType)
    },
    typeName(value) {
      if (usesRuntimeGuestNumericSlots(value)) { const type = runtimeActualType(value, special, meter); meter.checkpoint(); return type.value.name; }
      return value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
    }
  };
}
