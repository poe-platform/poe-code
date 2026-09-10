import type { ExecutionMeter } from "./execution-budget.js";
import { lookupRuntimeSpecialMethod, type RuntimeSpecialMethodContext } from "./runtime-special-method.js";
import { resolveRuntimeTypeAttribute } from "./runtime-type-layout.js";
import type { MultiplicationContext } from "./runtime-multiplication.js";
import type { BuiltinInvocationContext, RuntimeValue, RuntimeValues, TypeValue } from "./runtime-values.js";

/** Opaque values use the supplied type policy; exact native payloads do not. */
function usesGuestSlots(value: RuntimeValue): boolean {
  switch (value.kind) {
    case "cell": case "type": case "function": case "method":
    case "builtin_function_or_method": case "getset_descriptor": case "iterator": return true;
    default: return false;
  }
}

/** Prepare one pair, keeping method lookup live until dispatch. Native pairs
 * retain kernel fast paths. Mixed native/opaque pairs decline native numeric
 * slots before sequence fallback. Native-subclass payload adaptation and
 * metaclass attribute overrides remain separate object-layer responsibilities. */
export function createRuntimeMultiplicationContext(left: RuntimeValue, right: RuntimeValue, values: RuntimeValues, meter: ExecutionMeter, special: RuntimeSpecialMethodContext, invocation: BuiltinInvocationContext): MultiplicationContext | undefined {
  meter.checkpoint();
  const leftGuest = usesGuestSlots(left), rightGuest = usesGuestSlots(right);
  if (!leftGuest && !rightGuest) return undefined;
  const leftType = leftGuest ? special.typeOf(left) : undefined; meter.checkpoint();
  const rightType = rightGuest ? special.typeOf(right) : undefined; meter.checkpoint();
  let relation: "same" | "right-subtype" | "other" = "other";
  if (leftType !== undefined && rightType !== undefined) {
    if (leftType === rightType) relation = "same";
    else for (const ancestor of rightType.value.mro) {
      meter.checkpoint();
      if (ancestor === leftType.value) { relation = "right-subtype"; break; }
    }
  }
  meter.checkpoint(0, 512);
  const call = (receiver: RuntimeValue, other: RuntimeValue, type: TypeValue | undefined, name: string): RuntimeValue => {
    if (type === undefined) return values.notImplemented;
    const method = lookupRuntimeSpecialMethod(receiver, type, values.string(name), special, values, meter);
    meter.checkpoint();
    if (method === undefined) return values.notImplemented;
    meter.checkpoint(0, 16);
    const result = invocation.call(method, [other]); meter.checkpoint(); return result;
  };
  const classMethod = (type: TypeValue): RuntimeValue | undefined => {
    const found = resolveRuntimeTypeAttribute(type.value, values.string("__rmul__"), special, values, meter);
    if (found === undefined) return undefined;
    const attribute = found.attribute;
    const result = attribute.slots?.get === undefined ? attribute.value : attribute.slots.get(null, type);
    meter.checkpoint(); return result;
  };
  return {
    leftHasSequenceTable: leftType?.value.hasSequenceTable,
    numeric: {
      relation, notImplemented: values.notImplemented,
      forward: () => call(left, right, leftType, "__mul__"),
      reflected: () => call(right, left, rightType, "__rmul__"),
      reflectedIsOverridden() {
        const b = classMethod(rightType!);
        if (b === undefined) return false;
        const a = classMethod(leftType!);
        if (a === undefined) return true;
        if (a === b) return false;
        if (invocation.compareTruth === undefined) throw Error("numeric override comparison requires a comparison policy");
        const result = invocation.compareTruth("!=", a, b); meter.checkpoint(); return result;
      }
    },
    get integerIndex() { return invocation.integerIndex; },
    typeName(value) {
      if (usesGuestSlots(value)) { const type = special.typeOf(value); meter.checkpoint(); return type.value.name; }
      return value.kind === "none" ? "NoneType" : value.kind === "not-implemented" ? "NotImplementedType" : value.kind;
    }
  };
}
